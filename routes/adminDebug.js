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

// ── Remote log mirror kill-switch (SERVER_LOG_MIRROR_SPEC §2) ──
// The global policy is the row user_id='*'; a real userId is a per-tester override.

// GET /api/admin/debug/log-config — list all policy rows (global + overrides).
router.get('/log-config', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, enabled, level, flush_sec, batch_max, updated_at
         FROM debug_log_config ORDER BY (user_id <> '*'), user_id`
    );
    res.json(rows);
  } catch (e) {
    console.error(`[ADMIN] log-config read error: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

// PUT /api/admin/debug/log-config — upsert a policy row.
// Body: { userId?, enabled?, level?, flushSec?, batchMax? }. Omit userId to set
// the global default. This is how we flip enabled:false without a client update.
router.put('/log-config', async (req, res) => {
  try {
    const b = req.body || {};
    const userId = b.userId || '*';
    if (b.level != null && b.level !== 'all' && b.level !== 'warn') {
      return res.status(400).json({ error: 'level must be "all" or "warn"' });
    }
    const { rows } = await pool.query(
      `INSERT INTO debug_log_config (user_id, enabled, level, flush_sec, batch_max, updated_at)
         VALUES ($1, COALESCE($2, TRUE), COALESCE($3, 'all'), $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET
         enabled    = COALESCE($2, debug_log_config.enabled),
         level      = COALESCE($3, debug_log_config.level),
         flush_sec  = COALESCE($4, debug_log_config.flush_sec),
         batch_max  = COALESCE($5, debug_log_config.batch_max),
         updated_at = now()
       RETURNING user_id, enabled, level, flush_sec, batch_max, updated_at`,
      [
        userId,
        typeof b.enabled === 'boolean' ? b.enabled : null,
        b.level != null ? b.level : null,
        b.flushSec != null ? parseInt(b.flushSec, 10) : null,
        b.batchMax != null ? parseInt(b.batchMax, 10) : null,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(`[ADMIN] log-config write error: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

// DELETE /api/admin/debug/log-config?userId=<id> — drop a per-user override
// (falls back to the global policy). Refuses to delete the global row.
router.delete('/log-config', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId || userId === '*') {
      return res.status(400).json({ error: 'specify a per-user userId (cannot delete global)' });
    }
    const { rowCount } = await pool.query('DELETE FROM debug_log_config WHERE user_id = $1', [userId]);
    res.json({ deleted: rowCount });
  } catch (e) {
    console.error(`[ADMIN] log-config delete error: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

module.exports = router;
