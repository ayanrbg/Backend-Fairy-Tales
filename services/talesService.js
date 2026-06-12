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

async function getTalesList(lang) {
  let query = 'SELECT slug AS id, title, lang, COALESCE(free, false) AS free FROM tales';
  const params = [];

  if (lang) {
    query += ' WHERE lang = $1';
    params.push(lang);
  }

  query += ' ORDER BY title';

  const { rows } = await pool.query(query, params);

  const list = rows.map(tale => {
    const bundled = BUNDLED_TALES.has(tale.id);
    const result = {
      ...tale,
      coverUrl: `/api/tales/${tale.id}/cover`,
      bundled,
      comingSoon: false,
    };
    if (!bundled) {
      result.downloadSize = getDownloadSize(tale.id);
    }
    return result;
  });

  // Append "coming soon" tales. When a lang filter is set, only show those
  // that have a title for that language (mirrors how DB tales are filtered).
  for (const cs of loadComingSoon()) {
    if (lang && !cs.titles[lang]) continue;
    list.push(comingSoonEntry(cs, lang));
  }

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

module.exports = { getTalesList, getTaleById };
