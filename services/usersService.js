const pool = require('../db');

async function getUser(userId) {
  const { rows } = await pool.query(
    'SELECT user_id, voice_id, cloned_at, name, gender, lang FROM users WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

async function registerUser(userId, name, gender, lang) {
  const { rows } = await pool.query(
    `INSERT INTO users (user_id, name, gender, lang)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
     SET name = EXCLUDED.name, gender = EXCLUDED.gender, lang = EXCLUDED.lang
     RETURNING user_id, name, gender, lang`,
    [userId, name || null, gender || null, lang || 'ru']
  );
  return rows[0];
}

async function getProfile(userId) {
  const { rows } = await pool.query(
    'SELECT name, gender, lang FROM users WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

async function updateProfile(userId, fields) {
  const sets = [];
  const params = [];
  let idx = 1;

  for (const key of ['name', 'gender', 'lang']) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      params.push(fields[key]);
      idx++;
    }
  }

  if (sets.length === 0) return getProfile(userId);

  params.push(userId);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${idx} RETURNING name, gender, lang`,
    params
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

module.exports = { getUser, registerUser, getProfile, updateProfile, saveVoice, deleteVoice };
