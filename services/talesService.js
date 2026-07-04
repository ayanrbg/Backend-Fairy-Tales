const fs = require('fs');
const path = require('path');
const pool = require('../db');

// Tales bundled into the Unity client — illustrations are shipped with the app
const BUNDLED_TALES = new Set(['golden_egg', 'farhad']);

const ILLUSTRATIONS_DIR = path.join(__dirname, '..', 'data', 'illustrations');
const COMING_SOON_FILE = path.join(__dirname, '..', 'data', 'coming-soon.json');

/**
 * Load "coming soon" tales (in development, not yet playable) from config.
 * These have a per-language title and a cover, but no pages/text.
 * Read fresh each time so edits to the JSON take effect without a restart.
 */
function loadComingSoon() {
  try {
    if (!fs.existsSync(COMING_SOON_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(COMING_SOON_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    // Only keep entries with an id and at least one title
    return raw.filter(
      (t) => t && typeof t.id === 'string' && t.titles && Object.keys(t.titles).length > 0
    );
  } catch (err) {
    console.error('Failed to load coming-soon.json:', err.message);
    return [];
  }
}

// Build a single list entry for a coming-soon tale in the requested language.
function comingSoonEntry(tale, lang) {
  const titles = tale.titles || {};
  const title = titles[lang] || titles.ru || Object.values(titles)[0] || tale.id;
  return {
    id: tale.id,
    title,
    titles,
    lang: titles[lang] ? lang : (titles.ru ? 'ru' : Object.keys(titles)[0]),
    free: !!tale.free,
    coverUrl: `/api/tales/${tale.id}/cover`,
    bundled: false,
    comingSoon: true,
  };
}

function getComingSoonById(id) {
  return loadComingSoon().find((t) => t.id === id) || null;
}

// Cache for computed download sizes (bytes) — illustrations are static
const downloadSizeCache = new Map();

/**
 * Compute total illustration file size for a tale (both genders).
 * Images are pre-compressed, so file size = download size.
 */
function getDownloadSize(taleId) {
  if (downloadSizeCache.has(taleId)) return downloadSizeCache.get(taleId);

  const dir = path.join(ILLUSTRATIONS_DIR, taleId);
  if (!fs.existsSync(dir)) {
    downloadSizeCache.set(taleId, 0);
    return 0;
  }

  let total = 0;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(file)) {
      total += fs.statSync(path.join(dir, file)).size;
    }
  }

  downloadSizeCache.set(taleId, total);
  return total;
}

// How long a soft-deleted tale keeps being returned (with status:"removed") so
// clients get a chance to purge their local cache (SERVER_LIBRARY_SPEC §2).
const REMOVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Catalog list. The DB holds one row per (slug, lang); here we collapse to one
 * entry per slug so the response carries the WHOLE catalog with localized
 * `titles` — even tales not translated into `lang`. That is required for the
 * client's cache-reconcile: it must see an explicit status:"removed", never
 * infer deletion from a tale missing in one language (spec §2).
 */
async function getTalesList(lang) {
  const { rows } = await pool.query(
    `SELECT slug AS id,
            jsonb_object_agg(lang, title) AS titles,
            array_agg(lang ORDER BY lang)  AS langs,
            bool_or(COALESCE(free, false)) AS free,
            max(status)                    AS status,
            bool_or(coming_soon)           AS coming_soon,
            max(sort_order)                AS sort_order,
            max(content_version)           AS content_version,
            max(updated_at)                AS updated_at
       FROM tales
       GROUP BY slug`
  );

  const now = Date.now();
  const list = [];
  for (const t of rows) {
    // Drop removed tales once the retention window has elapsed.
    if (t.status === 'removed' && t.updated_at
        && now - new Date(t.updated_at).getTime() > REMOVED_RETENTION_MS) {
      continue;
    }

    const titles = t.titles || {};
    const displayTitle = titles[lang] || titles.ru || Object.values(titles)[0] || t.id;
    const bundled = BUNDLED_TALES.has(t.id);
    const entry = {
      id: t.id,
      title: displayTitle,
      titles,
      lang: titles[lang] ? lang : (titles.ru ? 'ru' : Object.keys(titles)[0]),
      langs: t.langs,
      free: t.free,
      coverUrl: `/api/tales/${t.id}/cover`,
      bundled,
      comingSoon: t.coming_soon,
      status: t.status,
      sortOrder: t.sort_order,
      contentVersion: t.content_version,
    };
    if (!bundled) entry.downloadSize = getDownloadSize(t.id);
    list.push(entry);
  }

  // Append file-based "coming soon" placeholders that have no DB row yet.
  const dbIds = new Set(list.map((e) => e.id));
  for (const cs of loadComingSoon()) {
    if (dbIds.has(cs.id)) continue;
    list.push({ ...comingSoonEntry(cs, lang), status: 'active', sortOrder: 0 });
  }

  // Order by sort_order (lower = higher); the client re-sorts by availability.
  list.sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.title).localeCompare(String(b.title)));
  return list;
}

async function getTaleById(id, lang) {
  const cols = 'SELECT slug AS id, title, lang, pages, COALESCE(free, false) AS free FROM tales';

  let rows;

  // Try the requested language first.
  if (lang) {
    ({ rows } = await pool.query(`${cols} WHERE slug = $1 AND lang = $2`, [id, lang]));
  }

  // Fallback: requested translation is missing → prefer the Russian (default)
  // version, otherwise any available one. The returned `lang` reflects the
  // REAL language of the version served (never an echo of the requested one),
  // so the client can tell whether the translation actually exists.
  if (!rows || !rows[0]) {
    ({ rows } = await pool.query(
      `${cols} WHERE slug = $1 ORDER BY (lang = 'ru') DESC LIMIT 1`,
      [id]
    ));
  }

  if (!rows[0]) {
    // Not a real tale — maybe it's a "coming soon" placeholder.
    const cs = getComingSoonById(id);
    if (cs) {
      const entry = comingSoonEntry(cs, lang);
      return { ...entry, totalPages: 0, pages: [], genderedPages: [] };
    }
    return null;
  }

  const tale = rows[0];
  tale.totalPages = tale.pages.length;
  tale.bundled = BUNDLED_TALES.has(tale.id);
  if (!tale.bundled) {
    tale.downloadSize = getDownloadSize(tale.id);
  }

  // List of languages this tale is actually translated into, so the client
  // can fetch only the translations that exist.
  const { rows: langRows } = await pool.query(
    'SELECT lang FROM tales WHERE slug = $1 ORDER BY lang',
    [id]
  );
  tale.langs = langRows.map((r) => r.lang);

  return tale;
}

// Drop the cached illustration size for a tale so the next list recomputes it.
// Call after any illustration upload/delete for that tale.
function invalidateDownloadSize(taleId) {
  downloadSizeCache.delete(taleId);
}

// Bundled tales ship their illustrations/cover inside the Unity client, so the
// server legitimately has no assets for them.
function isBundled(taleId) {
  return BUNDLED_TALES.has(taleId);
}

module.exports = { getTalesList, getTaleById, getDownloadSize, invalidateDownloadSize, isBundled };
