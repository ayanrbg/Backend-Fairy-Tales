const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const adminKey = require('../middleware/adminKey');

const optionalAuth = auth.optional;
const router = express.Router();

// Cap how much a single request can insert so a misbehaving client can't
// hammer the DB. GA4 itself batches ~25 events per request.
const MAX_BATCH = 50;
const MAX_NAME_LEN = 64;

// Accept both a single event and a batch. Shape:
//   { session, platform, appVersion, events: [ { name, ts, params } ] }
//   or a single { name|ev, ts, params, session, platform, appVersion }
function normalizeEvents(b) {
  const list = Array.isArray(b.events) ? b.events : [b];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const name = String(e.name || e.ev || '').trim().slice(0, MAX_NAME_LEN);
    if (!name) continue;
    let params = e.params != null ? e.params : null;
    if (params != null && typeof params !== 'object') params = { value: params };
    out.push({
      name,
      params,
      clientTs: e.ts ? new Date(e.ts) : (b.ts ? new Date(b.ts) : null),
    });
    if (out.length >= MAX_BATCH) break;
  }
  return out;
}

// POST /api/analytics/event — our own copy of client GA4 events (§3C).
// No auth required (events may flow before login); a valid JWT overrides the
// body's userId. Always 200, fire-and-forget — analytics must never break the app.
router.post('/event', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const userId = req.userId || b.userId || null;
    const events = normalizeEvents(b);
    if (events.length) {
      // Single multi-row INSERT.
      const values = [];
      const params = [];
      events.forEach((e, i) => {
        const o = i * 7;
        values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`);
        params.push(
          userId, b.session || null, b.platform || null, b.appVersion || null,
          e.name, e.params != null ? JSON.stringify(e.params) : null, e.clientTs
        );
      });
      await pool.query(
        `INSERT INTO analytics_events
           (user_id, session, platform, app_version, name, params, client_ts)
         VALUES ${values.join(', ')}`,
        params
      );
    }
  } catch (e) {
    console.error(`[ANALYTICS] event ingest error: ${e.message}`);
  }
  return res.json({});
});

// GET /api/analytics/events?name=&userId=&session=&since=&limit= — reader (admin).
router.get('/events', adminKey, async (req, res) => {
  try {
    const { name, userId, session, since } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const where = [];
    const params = [];
    if (name)    { params.push(name);    where.push(`name = $${params.length}`); }
    if (userId)  { params.push(userId);  where.push(`user_id = $${params.length}`); }
    if (session) { params.push(session); where.push(`session = $${params.length}`); }
    if (since)   { params.push(new Date(since)); where.push(`received_at >= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, user_id, session, platform, app_version, name, params, client_ts, received_at
         FROM analytics_events ${whereSql}
         ORDER BY received_at DESC
         LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(`[ANALYTICS] events read error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/analytics/summary?since= — per-event counts (admin), quick sanity view.
router.get('/summary', adminKey, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { rows } = await pool.query(
      `SELECT name, COUNT(*)::int AS count, MAX(received_at) AS last_seen
         FROM analytics_events
        WHERE received_at >= $1
        GROUP BY name
        ORDER BY count DESC`,
      [since]
    );
    res.json({ since, events: rows });
  } catch (e) {
    console.error(`[ANALYTICS] summary error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
