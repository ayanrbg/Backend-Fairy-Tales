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

async function getTaleById(id) {
  const { rows } = await pool.query(
    'SELECT slug AS id, title, lang, pages FROM tales WHERE slug = $1',
    [id]
  );

  if (!rows[0]) return null;

  const tale = rows[0];
  tale.totalPages = tale.pages.length;
  return tale;
}

module.exports = { getTalesList, getTaleById };
