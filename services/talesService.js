const pool = require('../db');

async function getTalesList(lang) {
  let query = 'SELECT slug AS id, title, lang FROM tales';
  const params = [];

  if (lang) {
    query += ' WHERE lang = $1';
    params.push(lang);
  }

  query += ' ORDER BY title';

  const { rows } = await pool.query(query, params);
  return rows;
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
