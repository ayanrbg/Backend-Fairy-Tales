const pool = require('../db');

// Device push-token store (Phase 0 of DEV_PLAN_PUSH_NOTIFICATIONS.md).
// The client posts its FCM token here; segments/sender (Phase 1) read the
// active rows. Everything here is idempotent — the client re-registers on
// every launch and on every FCM token refresh.

const PLATFORMS = new Set(['ios', 'android']);
const MAX_TOKEN_LEN = 4096; // FCM tokens are ~160 chars; cap defends the column.

// upsert by token. A token can migrate between users (device handed over,
// account re-init) — so on conflict we also refresh user_id. Registering (or
// re-registering) always clears disabled_at: the device just proved it's alive.
async function registerToken({ userId, token, platform, appVersion, lang }) {
  const { rows } = await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform, app_version, lang, last_seen_at, disabled_at)
     VALUES ($1, $2, $3, $4, $5, now(), NULL)
     ON CONFLICT (token) DO UPDATE
       SET user_id      = EXCLUDED.user_id,
           platform     = COALESCE(EXCLUDED.platform, push_tokens.platform),
           app_version  = COALESCE(EXCLUDED.app_version, push_tokens.app_version),
           lang         = COALESCE(EXCLUDED.lang, push_tokens.lang),
           last_seen_at = now(),
           disabled_at  = NULL
     RETURNING id, (xmax = 0) AS inserted`,
    [userId || null, token, platform || null, appVersion || null, lang || null]
  );
  return rows[0]; // { id, inserted }
}

// Soft-disable a token (user turned off notifications, logged out, or FCM
// reported it dead). Idempotent; never deletes so the audit trail survives.
async function disableToken(token) {
  const { rowCount } = await pool.query(
    'UPDATE push_tokens SET disabled_at = now() WHERE token = $1 AND disabled_at IS NULL',
    [token]
  );
  return rowCount > 0;
}

// Active-token stats for the admin "token health" view (Phase 1 UI).
async function tokenStats() {
  const { rows } = await pool.query(
    `SELECT COALESCE(platform, '?') AS platform,
            COUNT(*) FILTER (WHERE disabled_at IS NULL)::int AS active,
            COUNT(*) FILTER (WHERE disabled_at IS NOT NULL)::int AS disabled
       FROM push_tokens
      GROUP BY 1 ORDER BY 2 DESC`
  );
  return rows;
}

module.exports = { registerToken, disableToken, tokenStats, PLATFORMS, MAX_TOKEN_LEN };
