const express = require('express');
const pool = require('../db');
const adminKey = require('../middleware/adminKey');

const router = express.Router();
router.use(adminKey);

const isSafeId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);

// GET /api/admin/tales — full catalog incl. hidden/removed, one entry per slug.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug AS id,
              jsonb_object_agg(lang, title) AS titles,
              array_agg(lang ORDER BY lang)  AS langs,
              bool_or(COALESCE(free,false))  AS free,
              max(status)                    AS status,
              bool_or(coming_soon)           AS coming_soon,
              max(sort_order)                AS sort_order,
              max(content_version)           AS content_version,
              max(updated_at)                AS updated_at
         FROM tales GROUP BY slug ORDER BY max(sort_order), slug`
    );
    res.json(rows.map((t) => ({
      id: t.id, titles: t.titles, langs: t.langs, free: t.free,
      status: t.status, comingSoon: t.coming_soon, sortOrder: t.sort_order,
      contentVersion: t.content_version,
      updatedAt: t.updated_at ? new Date(t.updated_at).toISOString() : null,
    })));
  } catch (e) {
    console.error(`[ADMIN] tales list error: ${e.message}`);
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

module.exports = router;
