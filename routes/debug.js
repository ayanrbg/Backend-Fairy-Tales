const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const adminKey = require('../middleware/adminKey');

const optionalAuth = auth.optional;
const router = express.Router();

// POST /api/debug/log — remote purchase/IAP logs from the client (§9a).
// No auth required (logs must flow even before login); if a valid JWT is
// present we trust its userId over the body. Always 200, fire-and-forget.
router.post('/log', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const userId = req.userId || b.userId || null;
    await pool.query(
      `INSERT INTO debug_logs (user_id, session, platform, app_version, ev, data, client_ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, b.session, b.platform, b.appVersion, b.ev,
       b.data != null ? String(b.data) : null,
       b.ts ? new Date(b.ts) : null]
    );
  } catch (e) {
    console.error(`[IAP] debug/log error: ${e.message}`);
  }
  return res.json({});
});

// Built-in fallback when no config row exists at all. Matches the client's own
// default (ON, capture everything) so mirroring works before anyone touches the
// admin switch. See SERVER_LOG_MIRROR_SPEC "Notes" for the recommended steady state.
const DEFAULT_CONFIG = { enabled: true, level: 'all', flushSec: 4, batchMax: 40 };

// Resolve the logging policy for a userId: per-user row wins, else the global
// '*' row, else DEFAULT_CONFIG.
async function resolveConfig(userId) {
  const keys = userId ? [userId, '*'] : ['*'];
  const { rows } = await pool.query(
    `SELECT user_id, enabled, level, flush_sec, batch_max
       FROM debug_log_config WHERE user_id = ANY($1)`,
    [keys]
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.user_id, r]));
  const row = (userId && byKey[userId]) || byKey['*'];
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    enabled: row.enabled,
    level: row.level || 'all',
    flushSec: row.flush_sec != null ? row.flush_sec : DEFAULT_CONFIG.flushSec,
    batchMax: row.batch_max != null ? row.batch_max : DEFAULT_CONFIG.batchMax,
  };
}

// POST /api/debug/logs — receive a batch of mirrored Unity log LINES (§1).
// Fire-and-forget: always 200 so the client never treats logging as a hard
// dependency. No auth required; a valid JWT (if present) overrides body userId.
router.post('/logs', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const userId = req.userId || b.userId || null;
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length) {
      // Bulk insert: one multi-row VALUES statement instead of N round-trips.
      const params = [];
      const tuples = lines.map((ln, i) => {
        const base = i * 8;
        params.push(
          userId,
          b.session || null,
          b.platform || null,
          b.appVersion || null,
          ln && ln.ts ? new Date(ln.ts) : null,
          ln && ln.level ? String(ln.level) : null,
          ln && ln.message != null ? String(ln.message) : null,
          ln && ln.stack ? String(ln.stack) : null
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      });
      await pool.query(
        `INSERT INTO debug_log_lines
           (user_id, session, platform, app_version, client_ts, level, message, stack)
         VALUES ${tuples.join(', ')}`,
        params
      );
    }
  } catch (e) {
    console.error(`[LOGMIRROR] logs error: ${e.message}`);
    // Still fall through to a 200 with no config — a 5xx just makes the client
    // re-queue and retry, inflating duplicates for no gain.
    return res.json({ hasConfig: false });
  }

  // Piggyback the current policy so a globally pushed enabled:false reaches
  // clients without waiting for their next app start (§3).
  try {
    const userId = req.userId || (req.body && req.body.userId) || null;
    const cfg = await resolveConfig(userId);
    return res.json({ hasConfig: true, ...cfg });
  } catch (_) {
    return res.json({ hasConfig: false });
  }
});

// GET /api/debug/config?userId=<id> — the kill-switch (§2). Called on every app
// start. hasConfig:true is REQUIRED or the client ignores the body (§3).
router.get('/config', optionalAuth, async (req, res) => {
  try {
    const userId = req.userId || req.query.userId || null;
    const cfg = await resolveConfig(userId);
    return res.json({ hasConfig: true, ...cfg });
  } catch (e) {
    console.error(`[LOGMIRROR] config error: ${e.message}`);
    // Without hasConfig:true the client keeps its cached policy — safe on error.
    return res.json({ hasConfig: false });
  }
});

// GET /api/debug/logs?userId=&session=&level=&limit= — admin reader for a
// purchase flow, oldest→newest so it reads top-to-bottom.
router.get('/logs', adminKey, async (req, res) => {
  try {
    const { userId, session, level } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
    const where = [];
    const params = [];
    if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
    if (session) { params.push(session); where.push(`session = $${params.length}`); }
    if (level) { params.push(level); where.push(`level = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, user_id, session, platform, app_version, level, message, stack, client_ts, received_at
         FROM debug_log_lines ${whereSql}
         ORDER BY COALESCE(client_ts, received_at) ASC, id ASC
         LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(`[LOGMIRROR] logs read error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/debug/log?userId=&session=&limit= — reader for us (admin only).
router.get('/log', adminKey, async (req, res) => {
  try {
    const { userId, session } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const where = [];
    const params = [];
    if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
    if (session) { params.push(session); where.push(`session = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, user_id, session, platform, app_version, ev, data, client_ts, received_at
         FROM debug_logs ${whereSql}
         ORDER BY received_at DESC
         LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(`[IAP] debug/log read error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
