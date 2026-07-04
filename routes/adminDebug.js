const express = require('express');
const pool = require('../db');
const adminKey = require('../middleware/adminKey');
const diag = require('../utils/diagnostics');

const router = express.Router();
router.use(adminKey);

// GET /api/admin/debug/config — integration config + DB reachability.
router.get('/config', async (req, res) => {
  res.json({ config: diag.configStatus(), db: await diag.dbPing() });
});

// GET /api/admin/debug/overview — one-stop health/activity view (no SSH needed).
// ?limit= caps each recent list (default 25).
router.get('/overview', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);
  try {
    const [db, counts, events, snaps, logs, failedLogs] = await Promise.all([
      diag.dbPing(),
      pool.query(
        `SELECT source,
                count(*)                                                              AS total,
                count(*) FILTER (WHERE premium AND (expires_at IS NULL OR expires_at > now())) AS active
           FROM entitlements GROUP BY source ORDER BY source`
      ),
      pool.query('SELECT id, user_id, source, kind, created_at FROM subscription_events ORDER BY created_at DESC LIMIT $1', [limit]),
      pool.query('SELECT user_id, platform, app_version, context, cached_premium, client_ts, received_at FROM subscription_snapshots ORDER BY received_at DESC LIMIT $1', [limit]),
      pool.query('SELECT id, user_id, session, platform, app_version, ev, data, received_at FROM debug_logs ORDER BY received_at DESC LIMIT $1', [limit]),
      pool.query("SELECT id, user_id, session, ev, data, received_at FROM debug_logs WHERE ev ILIKE '%fail%' OR data ILIKE '%error%' OR data ILIKE '%granted=false%' ORDER BY received_at DESC LIMIT $1", [limit]),
    ]);
    res.json({
      config: diag.configStatus(),
      db,
      entitlementCounts: counts.rows,
      recentEvents: events.rows,
      recentSnapshots: snaps.rows,
      recentLogs: logs.rows,
      recentFailures: failedLogs.rows,
    });
  } catch (e) {
    console.error(`[ADMIN] debug overview error: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

module.exports = router;
