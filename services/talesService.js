const fs = require('fs');
const path = require('path');
const pool = require('../db');

// Tales bundled into the Unity client — illustrations are shipped with the app
const BUNDLED_TALES = new Set(['golden_egg', 'farhad']);

const ILLUSTRATIONS_DIR = path.join(__dirname, '..', 'data', 'illustrations');

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

  return rows.map(tale => {
    const bundled = BUNDLED_TALES.has(tale.id);
    const result = {
      ...tale,
      coverUrl: `/api/tales/${tale.id}/cover`,
      bundled,
    };
    if (!bundled) {
      result.downloadSize = getDownloadSize(tale.id);
    }
    return result;
  });
}

async function getTaleById(id, lang) {
  let query, params;

  if (lang) {
    query = 'SELECT slug AS id, title, lang, pages, COALESCE(free, false) AS free FROM tales WHERE slug = $1 AND lang = $2';
    params = [id, lang];
  } else {
    query = 'SELECT slug AS id, title, lang, pages, COALESCE(free, false) AS free FROM tales WHERE slug = $1 LIMIT 1';
    params = [id];
  }

  const { rows } = await pool.query(query, params);

  if (!rows[0]) return null;

  const tale = rows[0];
  tale.totalPages = tale.pages.length;
  tale.bundled = BUNDLED_TALES.has(tale.id);
  if (!tale.bundled) {
    tale.downloadSize = getDownloadSize(tale.id);
  }
  return tale;
}

module.exports = { getTalesList, getTaleById };
