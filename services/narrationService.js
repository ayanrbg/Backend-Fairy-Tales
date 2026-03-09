const pool = require('../db');
const crypto = require('crypto');

function generateJobId() {
  return crypto.randomUUID();
}

async function createJob(userId, taleSlug, totalPages) {
  const jobId = generateJobId();
  const { rows } = await pool.query(
    `INSERT INTO narration_jobs (job_id, user_id, tale_slug, status, pages_ready, total_pages)
     VALUES ($1, $2, $3, 'processing', 0, $4)
     RETURNING job_id, status`,
    [jobId, userId, taleSlug, totalPages]
  );
  return rows[0];
}

async function getJob(userId, taleSlug) {
  const { rows } = await pool.query(
    `SELECT job_id, status, pages_ready, total_pages
     FROM narration_jobs
     WHERE user_id = $1 AND tale_slug = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, taleSlug]
  );
  return rows[0] || null;
}

async function updateJobProgress(jobId, pagesReady) {
  await pool.query(
    `UPDATE narration_jobs SET pages_ready = $2 WHERE job_id = $1`,
    [jobId, pagesReady]
  );
}

async function completeJob(jobId) {
  await pool.query(
    `UPDATE narration_jobs SET status = 'done', pages_ready = total_pages WHERE job_id = $1`,
    [jobId]
  );
}

async function failJob(jobId) {
  await pool.query(
    `UPDATE narration_jobs SET status = 'error' WHERE job_id = $1`,
    [jobId]
  );
}

module.exports = { createJob, getJob, updateJobProgress, completeJob, failJob };
