/**
 * Seed script: creates tables and populates tales from JSON files.
 *
 * Usage: node db/seed.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./index');

const TALES_DIR = path.join(__dirname, '..', 'data', 'tales');

async function seed() {
  // 1. Create tables
  const initSQL = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');
  await pool.query(initSQL);
  console.log('Tables created.');

  // 2. Read tales index
  const index = JSON.parse(
    fs.readFileSync(path.join(TALES_DIR, 'index.json'), 'utf-8')
  );

  // 3. Insert tales
  for (const entry of index) {
    const filePath = path.join(TALES_DIR, entry.file);
    const tale = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    await pool.query(
      `INSERT INTO tales (slug, title, lang, text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE
       SET title = EXCLUDED.title, lang = EXCLUDED.lang, text = EXCLUDED.text`,
      [tale.id, tale.title, tale.lang, tale.text]
    );

    console.log(`  Seeded: ${tale.id} (${tale.lang})`);
  }

  // 4. Migrate existing users.json if present
  const usersPath = path.join(__dirname, '..', 'data', 'users.json');
  if (fs.existsSync(usersPath)) {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));

    for (const [userId, data] of Object.entries(users)) {
      if (data.voiceId) {
        await pool.query(
          `INSERT INTO users (user_id, voice_id, cloned_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE
           SET voice_id = EXCLUDED.voice_id, cloned_at = EXCLUDED.cloned_at`,
          [userId, data.voiceId, data.clonedAt || new Date().toISOString()]
        );
        console.log(`  Migrated user: ${userId}`);
      }
    }
  }

  console.log('Seed complete.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
