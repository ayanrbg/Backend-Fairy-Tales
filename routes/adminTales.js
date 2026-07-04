const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const multer = require('multer');
const AdmZip = require('adm-zip');
const pool = require('../db');
const adminKey = require('../middleware/adminKey');
const imageUpload = require('../middleware/imageUpload');
const talesService = require('../services/talesService');

const router = express.Router();
router.use(adminKey);

// Scenario upload: a JSON file per language, same shape as data/tales/{lang}/{slug}.json.
const scenarioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// Zip of illustrations — written to a temp file (avoids buffering big archives in RAM).
const zipUpload = multer({ storage: multer.diskStorage({}), limits: { fileSize: 1024 * 1024 * 1024 } });

// Conform an uploaded illustration to the on-server format: auto-orient, cap at
// 2048px wide (like existing tales), re-encode as JPEG (mozjpeg q82 ≈ 300–440KB).
const ILLUSTRATION_MAX_WIDTH = 2048;
function conformImage(input) {
  return sharp(input).rotate().resize({ width: ILLUSTRATION_MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true });
}

const isSafeId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);

const DATA_DIR = path.join(__dirname, '..', 'data');
const ILLUSTRATIONS_DIR = path.join(DATA_DIR, 'illustrations');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
// Order matters: findAsset (serving) prefers .webp then .jpg then .png, so on
// upload/delete we clear ALL sibling extensions to avoid a stale one winning.
const IMG_EXTS = ['.webp', '.jpg', '.jpeg', '.png'];

function removeSiblings(dir, base) {
  let removed = 0;
  for (const ext of IMG_EXTS) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); removed++; } catch (e) { console.error(`[ADMIN] unlink failed ${p}: ${e.message}`); }
    }
  }
  return removed;
}

// GET /api/admin/tales — full catalog incl. hidden/removed, one entry per slug.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug AS id,
              jsonb_object_agg(lang, title) AS titles,
              COALESCE(array_agg(lang ORDER BY lang) FILTER (WHERE jsonb_array_length(pages) > 0), '{}') AS langs,
              bool_or(COALESCE(free,false))  AS free,
              max(status)                    AS status,
              bool_or(coming_soon)           AS coming_soon,
              max(content_version)           AS content_version,
              min(created_at)                AS created_at,
              max(updated_at)                AS updated_at
         FROM tales GROUP BY slug ORDER BY min(created_at) ASC, slug`
    );
    res.json(rows.map((t) => ({
      id: t.id, titles: t.titles, langs: t.langs, free: t.free,
      status: t.status, comingSoon: t.coming_soon,
      contentVersion: t.content_version,
      createdAt: t.created_at ? new Date(t.created_at).toISOString() : null,
      updatedAt: t.updated_at ? new Date(t.updated_at).toISOString() : null,
    })));
  } catch (e) {
    console.error(`[ADMIN] tales list error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/admin/tales/:id — full detail for the editor: meta + text per language
// + which assets exist. (More specific GETs like /content-check are separate paths.)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT lang, title, pages, COALESCE(free,false) AS free, status,
              coming_soon, sort_order, content_version
         FROM tales WHERE slug = $1 ORDER BY lang`,
      [id]
    );
    const titles = {};
    const pagesByLang = {};
    for (const r of rows) { titles[r.lang] = r.title; pagesByLang[r.lang] = r.pages; }
    const meta = rows[0] || {};

    const dir = path.join(ILLUSTRATIONS_DIR, id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const variants = {};
    for (const f of files) {
      const m = f.match(/^page_(\d+)(?:_(boy|girl))?\.(webp|jpe?g|png)$/i);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      const g = m[2] ? m[2].toLowerCase() : 'plain';
      (variants[n] = variants[n] || {})[g] = true;
    }
    const cover = IMG_EXTS.some((e) => fs.existsSync(path.join(COVERS_DIR, id + e)));

    res.json({
      id,
      exists: rows.length > 0,
      titles,
      langs: rows.map((r) => r.lang),
      free: !!meta.free,
      status: meta.status || 'active',
      comingSoon: !!meta.coming_soon,
      sortOrder: meta.sort_order || 0,
      contentVersion: meta.content_version || 1,
      pagesByLang,
      cover,
      illustrations: Object.keys(variants).map(Number).sort((a, b) => a - b)
        .map((n) => ({ page: n, ...variants[n] })),
    });
  } catch (e) {
    console.error(`[ADMIN] tale detail error id=${id}: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/tales — create a tale (one DB row per language).
// Body: { id, titles:{lang:title}, pages:{lang:[...]}?, free?, comingSoon?, sortOrder? }
// Illustrations/covers are uploaded to storage separately (see spec §4).
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!isSafeId(b.id)) return res.status(400).json({ error: 'invalid id' });
  if (!b.titles || Object.keys(b.titles).length === 0) {
    return res.status(400).json({ error: 'titles required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [lang, title] of Object.entries(b.titles)) {
      const pages = (b.pages && b.pages[lang]) || [];
      await client.query(
        `INSERT INTO tales (slug, title, lang, pages, free, coming_soon, sort_order, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',now())
         ON CONFLICT (slug, lang) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
        [b.id, title, lang, JSON.stringify(pages), !!b.free, !!b.comingSoon, b.sortOrder || 0]
      );
    }
    await client.query('COMMIT');
    res.json({ id: b.id, created: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`[ADMIN] create tale error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// Update slug-level columns across all of a slug's language rows.
async function updateSlug(id, sets) {
  const cols = Object.keys(sets);
  const params = cols.map((c) => sets[c]);
  const assigns = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const r = await pool.query(
    `UPDATE tales SET ${assigns}, updated_at = now() WHERE slug = $1 RETURNING slug`,
    [id, ...params]
  );
  return r.rowCount > 0;
}

// PATCH /api/admin/tales/:id — free, comingSoon, status, sortOrder, titles.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  const b = req.body || {};
  try {
    const sets = {};
    if (b.free != null) sets.free = !!b.free;
    if (b.comingSoon != null) sets.coming_soon = !!b.comingSoon;
    if (b.sortOrder != null) sets.sort_order = Number(b.sortOrder);
    if (b.status != null) {
      if (!['active', 'hidden', 'removed'].includes(b.status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      sets.status = b.status;
    }
    let touched = false;
    if (Object.keys(sets).length) touched = await updateSlug(id, sets);

    // Per-language title edits.
    if (b.titles && typeof b.titles === 'object') {
      for (const [lang, title] of Object.entries(b.titles)) {
        const r = await pool.query(
          'UPDATE tales SET title = $3, updated_at = now() WHERE slug = $1 AND lang = $2',
          [id, lang, title]
        );
        touched = touched || r.rowCount > 0;
      }
    }
    if (!touched) return res.status(404).json({ error: 'tale not found' });
    res.json({ id, updated: true });
  } catch (e) {
    console.error(`[ADMIN] patch tale error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/tales/:id/coming-soon — { value: true }
router.post('/:id/coming-soon', async (req, res) => {
  const ok = await updateSlug(req.params.id, { coming_soon: !!(req.body || {}).value });
  return ok ? res.json({ id: req.params.id, comingSoon: !!req.body.value })
            : res.status(404).json({ error: 'tale not found' });
});

// POST /api/admin/tales/:id/publish — comingSoon=false, status='active'
router.post('/:id/publish', async (req, res) => {
  const ok = await updateSlug(req.params.id, { coming_soon: false, status: 'active' });
  return ok ? res.json({ id: req.params.id, published: true })
            : res.status(404).json({ error: 'tale not found' });
});

// POST /api/admin/tales/:id/reorder — { sortOrder: 5 }
router.post('/:id/reorder', async (req, res) => {
  const order = Number((req.body || {}).sortOrder);
  if (isNaN(order)) return res.status(400).json({ error: 'sortOrder required' });
  const ok = await updateSlug(req.params.id, { sort_order: order });
  return ok ? res.json({ id: req.params.id, sortOrder: order })
            : res.status(404).json({ error: 'tale not found' });
});

// DELETE /api/admin/tales/:id — soft delete (status='removed'); the client
// purges its local cache while the row is still returned during retention.
router.delete('/:id', async (req, res) => {
  const ok = await updateSlug(req.params.id, { status: 'removed' });
  return ok ? res.json({ id: req.params.id, removed: true })
            : res.status(404).json({ error: 'tale not found' });
});

// ─────────────────────────── content: text pages ───────────────────────────

// PUT /api/admin/tales/:id/pages?lang=ru — replace the page text for one language.
router.put('/:id/pages', async (req, res) => {
  const { id } = req.params;
  const lang = req.query.lang;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  if (!lang) return res.status(400).json({ error: 'lang query required' });
  const { pages } = req.body || {};
  if (!Array.isArray(pages)) return res.status(400).json({ error: 'pages array required' });
  try {
    const r = await pool.query(
      'UPDATE tales SET pages = $3, updated_at = now() WHERE slug = $1 AND lang = $2 RETURNING slug',
      [id, lang, JSON.stringify(pages)]
    );
    if (!r.rowCount) {
      return res.status(404).json({ error: 'tale/lang not found — create the tale first (POST /api/admin/tales)' });
    }
    console.log(`[ADMIN] pages update id=${id} lang=${lang} count=${pages.length}`);
    res.json({ id, lang, pages: pages.length });
  } catch (e) {
    console.error(`[ADMIN] pages update error id=${id}: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/tales/:id/scenario?lang=ru  (multipart field "file")
// Upload the tale scenario as a JSON file — same format as the server's
// data/tales/{lang}/{slug}.json: { id, title, lang, pages: [...] }. One file per
// language. Creates the language row if missing (keeping a form-set title).
router.post('/:id/scenario', scenarioUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field "file")' });

  let parsed;
  try {
    parsed = JSON.parse(req.file.buffer.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'invalid JSON file: ' + e.message });
  }

  const lang = String(req.query.lang || parsed.lang || '').trim();
  if (!lang) return res.status(400).json({ error: 'lang required (query ?lang= or "lang" field in the file)' });

  const pages = parsed.pages;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'file must contain a non-empty "pages" array of strings' });
  }
  const fileTitle = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : null;

  try {
    // Keep an existing (form-set) title; use the file title only when creating.
    await pool.query(
      `INSERT INTO tales (slug, title, lang, pages, status, updated_at)
       VALUES ($1, $2, $3, $4, 'active', now())
       ON CONFLICT (slug, lang) DO UPDATE SET
         pages = EXCLUDED.pages,
         title = COALESCE(NULLIF(tales.title, ''), EXCLUDED.title),
         updated_at = now()`,
      [id, fileTitle || id, lang, JSON.stringify(pages)]
    );
    const mismatch = (parsed.lang && req.query.lang && parsed.lang !== req.query.lang)
      ? `warning: file lang="${parsed.lang}" differs from selected "${req.query.lang}" — saved under "${lang}"`
      : undefined;
    console.log(`[ADMIN] scenario upload id=${id} lang=${lang} pages=${pages.length} title="${fileTitle || ''}"${mismatch ? ' (' + mismatch + ')' : ''}`);
    res.json({ id, lang, pages: pages.length, title: fileTitle || undefined, warning: mismatch });
  } catch (e) {
    console.error(`[ADMIN] scenario upload error id=${id}: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

// ─────────────────────── content: cover & illustrations ────────────────────

// POST /api/admin/tales/:id/cover  (multipart field "file") — upload/replace cover.
router.post('/:id/cover', imageUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field "file")' });
  try {
    fs.mkdirSync(COVERS_DIR, { recursive: true });
    removeSiblings(COVERS_DIR, id);
    const out = path.join(COVERS_DIR, `${id}.png`);
    // Covers are stored and served as PNG (keeps transparency), capped at 1024px.
    const info = await sharp(req.file.buffer).rotate()
      .resize({ width: 1024, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(out);
    console.log(`[ADMIN] cover upload id=${id} in=${req.file.size}b (${req.file.mimetype}) out=${info.size}b ${info.width}x${info.height}`);
    res.json({ id, cover: true, bytes: info.size, width: info.width, height: info.height });
  } catch (e) {
    console.error(`[ADMIN] cover upload error id=${id}: ${e.message}`);
    res.status(500).json({ error: 'upload_failed', detail: e.message });
  }
});

// POST /api/admin/tales/:id/illustration/:page?gender=boy|girl  (multipart "file")
// No gender → plain page_N. Stored as JPEG to match existing content.
router.post('/:id/illustration/:page', imageUpload.single('file'), async (req, res) => {
  const { id, page } = req.params;
  const gender = req.query.gender;
  const p = parseInt(page, 10);
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  if (isNaN(p) || p < 0) return res.status(400).json({ error: 'invalid page' });
  if (gender && gender !== 'boy' && gender !== 'girl') return res.status(400).json({ error: 'gender must be boy or girl' });
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field "file")' });
  try {
    const dir = path.join(ILLUSTRATIONS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const base = gender ? `page_${p}_${gender}` : `page_${p}`;
    removeSiblings(dir, base);
    const out = path.join(dir, `${base}.jpg`);
    const info = await conformImage(req.file.buffer).toFile(out);
    talesService.invalidateDownloadSize(id);
    console.log(`[ADMIN] illustration upload id=${id} page=${p} gender=${gender || 'plain'} out=${info.size}b ${info.width}x${info.height}`);
    res.json({ id, page: p, gender: gender || null, bytes: info.size, width: info.width, height: info.height });
  } catch (e) {
    console.error(`[ADMIN] illustration upload error id=${id} page=${page}: ${e.message}`);
    res.status(500).json({ error: 'upload_failed', detail: e.message });
  }
});

// DELETE /api/admin/tales/:id/illustration/:page?gender=boy|girl
router.delete('/:id/illustration/:page', (req, res) => {
  const { id, page } = req.params;
  const gender = req.query.gender;
  const p = parseInt(page, 10);
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  if (isNaN(p) || p < 0) return res.status(400).json({ error: 'invalid page' });
  if (gender && gender !== 'boy' && gender !== 'girl') return res.status(400).json({ error: 'gender must be boy or girl' });
  const dir = path.join(ILLUSTRATIONS_DIR, id);
  const base = gender ? `page_${p}_${gender}` : `page_${p}`;
  const removed = removeSiblings(dir, base);
  talesService.invalidateDownloadSize(id);
  console.log(`[ADMIN] illustration delete id=${id} page=${p} gender=${gender || 'plain'} removed=${removed}`);
  res.json({ id, page: p, gender: gender || null, removed });
});

// POST /api/admin/tales/:id/illustrations-zip  (multipart field "file")
// Batch upload illustrations as a zip. Entries must be named page_N[_boy|_girl]
// .(jpg|png|webp); each is conformed to the server format (2048px JPEG). Nested
// folders are fine (only the basename matters). Non-matching entries are skipped.
const ILL_NAME_RE = /^page_(\d+)(?:_(boy|girl))?\.(jpe?g|png|webp)$/i;
router.post('/:id/illustrations-zip', zipUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field "file")' });

  const zipPath = req.file.path;
  try {
    let entries;
    try {
      entries = new AdmZip(zipPath).getEntries();
    } catch (e) {
      return res.status(400).json({ error: 'invalid zip: ' + e.message });
    }

    const dir = path.join(ILLUSTRATIONS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });

    const uploaded = [];
    const skipped = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const base = path.basename(entry.entryName);
      if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;
      const m = base.match(ILL_NAME_RE);
      if (!m) { skipped.push(base); continue; }
      const page = parseInt(m[1], 10);
      const gender = m[2] ? m[2].toLowerCase() : null;
      const outBase = gender ? `page_${page}_${gender}` : `page_${page}`;
      try {
        removeSiblings(dir, outBase);
        const info = await conformImage(entry.getData()).toFile(path.join(dir, outBase + '.jpg'));
        uploaded.push({ page, gender: gender || 'plain', width: info.width, height: info.height, bytes: info.size });
      } catch (e) {
        skipped.push(base + ' (' + e.message + ')');
      }
    }

    talesService.invalidateDownloadSize(id);
    console.log(`[ADMIN] illustrations-zip id=${id} uploaded=${uploaded.length} skipped=${skipped.length}`);
    res.json({ id, uploaded, skipped, downloadSize: talesService.getDownloadSize(id) });
  } catch (e) {
    console.error(`[ADMIN] illustrations-zip error id=${id}: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  } finally {
    fs.unlink(zipPath, () => {});
  }
});

// GET /api/admin/tales/:id/content-check — pre-publish validation. Catches the
// traps from SERVER_LIBRARY_SPEC §4 (missing page_0, unpaired gendered pages).
router.get('/:id/content-check', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    // Text rows per language.
    const { rows } = await pool.query(
      'SELECT lang, jsonb_array_length(pages) AS pages FROM tales WHERE slug = $1 ORDER BY lang',
      [id]
    );
    const langs = rows.map((r) => ({ lang: r.lang, pages: r.pages }));

    // Illustration files → per-page variant map.
    const dir = path.join(ILLUSTRATIONS_DIR, id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const variants = {}; // page -> { plain, boy, girl }
    for (const f of files) {
      const m = f.match(/^page_(\d+)(?:_(boy|girl))?\.(webp|jpe?g|png)$/i);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      const g = m[2] ? m[2].toLowerCase() : 'plain';
      (variants[n] = variants[n] || {})[g] = true;
    }
    const illustratedPages = Object.keys(variants).map(Number).sort((a, b) => a - b);
    const coverExists = IMG_EXTS.some((e) => fs.existsSync(path.join(COVERS_DIR, id + e)));

    const bundled = talesService.isBundled(id);
    const issues = [];
    const warnings = [];
    if (langs.length === 0) issues.push('no text rows in DB — create the tale first (POST /api/admin/tales)');

    // Asset presence (cover / page_0 / gendered pairs). For bundled tales these
    // ship inside the client, so a server-side gap is expected → warnings, not
    // blocking issues.
    const assetProblems = [];
    if (!variants[0]) assetProblems.push('page_0 illustration missing (any variant) — client would treat the tale as not downloaded and re-download in a loop');
    for (const n of illustratedPages) {
      const v = variants[n];
      if ((v.boy || v.girl) && !(v.boy && v.girl)) {
        assetProblems.push(`page_${n} has only ${v.boy ? 'boy' : 'girl'} — gendered pages need BOTH boy and girl`);
      }
    }
    if (!coverExists) assetProblems.push('cover missing');

    if (bundled) {
      if (assetProblems.length) warnings.push('bundled tale — assets ship with the client; server-side asset checks are informational');
      warnings.push(...assetProblems);
    } else {
      issues.push(...assetProblems);
    }

    // Compare only languages that actually have text (a title-only language is
    // fine — translations are optional).
    const withText = langs.filter((l) => l.pages > 0);
    const pageCounts = new Set(withText.map((l) => l.pages));
    if (pageCounts.size > 1) {
      warnings.push(`page count differs across languages: ${withText.map((l) => `${l.lang}=${l.pages}`).join(', ')}`);
    }
    // Illustrations for pages beyond the text length: the client never requests
    // them (it fetches pages 0..totalPages-1), but they still inflate downloadSize.
    const maxText = langs.length ? Math.max(...langs.map((l) => l.pages || 0)) : 0;
    const extraPages = maxText ? illustratedPages.filter((p) => p >= maxText) : [];
    if (extraPages.length) {
      warnings.push(`лишних иллюстраций: ${extraPages.length} (страниц текста ${maxText}, есть картинки для стр. ${extraPages.slice(0, 20).join(', ')}${extraPages.length > 20 ? '…' : ''}) — клиент их не скачивает, но они увеличивают downloadSize`);
    }

    const downloadSize = talesService.getDownloadSize(id);
    console.log(`[ADMIN] content-check id=${id} ok=${issues.length === 0} issues=${issues.length} warnings=${warnings.length}`);
    res.json({
      id,
      ok: issues.length === 0,
      bundled,
      issues,
      warnings,
      cover: coverExists,
      langs,
      illustratedPages,
      downloadSize,
    });
  } catch (e) {
    console.error(`[ADMIN] content-check error id=${id}: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

module.exports = router;
