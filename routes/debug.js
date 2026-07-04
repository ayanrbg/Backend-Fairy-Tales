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
