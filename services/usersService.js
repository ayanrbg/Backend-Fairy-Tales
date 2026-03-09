const pool = require('../db');

async function getUser(userId) {
  const { rows } = await pool.query(
    'SELECT user_id, voice_id, cloned_at FROM users WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

async function saveVoice(userId, voiceId) {
  await pool.query(
    `INSERT INTO users (user_id, voice_id, cloned_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET voice_id = EXCLUDED.voice_id, cloned_at = NOW()`,
    [userId, voiceId]
  );
}

async function deleteVoice(userId) {
  await pool.query(
    'UPDATE users SET voice_id = NULL, cloned_at = NULL WHERE user_id = $1',
    [userId]
  );
}

module.exports = { getUser, saveVoice, deleteVoice };
