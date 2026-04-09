const pool = require('../db');

async function listDrafts(userId) {
  const { rows } = await pool.query(
    `SELECT id, narrator_name AS "narratorName", tale_id AS "taleId",
            last_page AS "lastPage", voice_id AS "voiceId", created_at AS "createdAt"
     FROM drafts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function createDraft(userId, narratorName, taleId) {
  const { rows } = await pool.query(
    `INSERT INTO drafts (user_id, narrator_name, tale_id)
     VALUES ($1, $2, $3)
     RETURNING id, narrator_name AS "narratorName", tale_id AS "taleId",
               last_page AS "lastPage", voice_id AS "voiceId", created_at AS "createdAt"`,
    [userId, narratorName, taleId]
  );
  return rows[0];
}

async function getDraft(userId, draftId) {
  const { rows } = await pool.query(
    `SELECT id, narrator_name AS "narratorName", tale_id AS "taleId",
            last_page AS "lastPage", voice_id AS "voiceId"
     FROM drafts WHERE id = $1 AND user_id = $2`,
    [draftId, userId]
  );
  return rows[0] || null;
}

async function deleteDraft(userId, draftId) {
  const { rowCount } = await pool.query(
    'DELETE FROM drafts WHERE id = $1 AND user_id = $2',
    [draftId, userId]
  );
  return rowCount > 0;
}

async function updateDraft(userId, draftId, fields) {
  const { rows } = await pool.query(
    `UPDATE drafts SET voice_id = $3
     WHERE id = $1 AND user_id = $2
     RETURNING id, narrator_name AS "narratorName", tale_id AS "taleId",
               last_page AS "lastPage", voice_id AS "voiceId", created_at AS "createdAt"`,
    [draftId, userId, fields.voiceId]
  );
  return rows[0] || null;
}

module.exports = { listDrafts, createDraft, getDraft, deleteDraft, updateDraft };
