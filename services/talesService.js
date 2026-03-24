const fs = require('fs');
const path = require('path');
const pool = require('../db');

const DATA_DIR = path.join(__dirname, '..', 'data');

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
    const narrationDir = path.join(DATA_DIR, 'narration', 'default', tale.id, tale.lang);
    const hasDefaultNarration = fs.existsSync(narrationDir) &&
      fs.readdirSync(narrationDir).some(f => /^page_\d+\.mp3$/.test(f));

    return {
      ...tale,
      hasDefaultNarration,
      coverUrl: `/api/tales/${tale.id}/cover`,
    };
  });
}

async function getTaleById(id, lang) {
  let query, params;

  if (lang) {
    query = 'SELECT slug AS id, title, lang, pages FROM tales WHERE slug = $1 AND lang = $2';
    params = [id, lang];
  } else {
    query = 'SELECT slug AS id, title, lang, pages FROM tales WHERE slug = $1 LIMIT 1';
    params = [id];
  }

  const { rows } = await pool.query(query, params);

  if (!rows[0]) return null;

  const tale = rows[0];
  tale.totalPages = tale.pages.length;
  return tale;
}

module.exports = { getTalesList, getTaleById };
