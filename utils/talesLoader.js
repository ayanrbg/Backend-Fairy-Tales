const fs = require('fs');
const path = require('path');

const TALES_DIR = path.join(__dirname, '..', 'data', 'tales');
const INDEX_PATH = path.join(TALES_DIR, 'index.json');

/**
 * Get the tales catalog, optionally filtered by language.
 */
function getTalesList(lang) {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));

  if (lang) {
    return index.filter((tale) => tale.lang === lang);
  }

  return index;
}

/**
 * Get a single tale by ID (with full text).
 */
function getTaleById(id) {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  const entry = index.find((tale) => tale.id === id);

  if (!entry) return null;

  const filePath = path.join(TALES_DIR, entry.file);
  const tale = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  return tale;
}

module.exports = { getTalesList, getTaleById };
