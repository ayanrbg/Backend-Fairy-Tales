const pool = require('../db');

// Audience resolver (Phase 1 of DEV_PLAN_PUSH_NOTIFICATIONS.md).
// Turns a campaign's `audience` JSON into a SQL query over active tokens.
// Only ever targets live tokens (push_tokens.disabled_at IS NULL).
//
// audience shape (all optional, AND-combined):
//   { userId }                         → direct addressing (ignores every other filter)
//   { premium: "paid" | "free" }
//   { langs: ["ru","kz"] }             → matches users.lang OR the token's own lang
//   { genders: ["boy","girl"] }
//   { platforms: ["ios","android"] }
//   { appVersions: ["1.2.3"] }
//   { inactiveDays: 3 }                → no analytics event in the last N days
//   { taleRead: { taleId, read: true|false } }  → completed / not-yet-completed a tale

const ACTIVE_PREMIUM = `e.premium = TRUE AND (e.expires_at IS NULL OR e.expires_at > now())`;

// Build the WHERE clause + params from an audience object. Returns { where, params }.
function buildWhere(audience = {}) {
  const where = ['pt.disabled_at IS NULL'];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  // Direct addressing short-circuits segmentation.
  if (audience.userId) {
    where.push(`pt.user_id = ${add(String(audience.userId))}`);
    return { where: where.join(' AND '), params };
  }

  if (audience.premium === 'paid') {
    where.push(`(${ACTIVE_PREMIUM})`);
  } else if (audience.premium === 'free') {
    // No active entitlement: never bought, or lapsed.
    where.push(`(e.user_id IS NULL OR e.premium = FALSE OR (e.expires_at IS NOT NULL AND e.expires_at <= now()))`);
  }

  if (Array.isArray(audience.langs) && audience.langs.length) {
    where.push(`COALESCE(u.lang, pt.lang) = ANY(${add(audience.langs)})`);
  }
  if (Array.isArray(audience.genders) && audience.genders.length) {
    where.push(`u.gender = ANY(${add(audience.genders)})`);
  }
  if (Array.isArray(audience.platforms) && audience.platforms.length) {
    where.push(`pt.platform = ANY(${add(audience.platforms)})`);
  }
  if (Array.isArray(audience.appVersions) && audience.appVersions.length) {
    where.push(`pt.app_version = ANY(${add(audience.appVersions)})`);
  }
  if (Number.isFinite(audience.inactiveDays) && audience.inactiveDays > 0) {
    const days = add(String(Math.floor(audience.inactiveDays)));
    where.push(`NOT EXISTS (
      SELECT 1 FROM analytics_events a
       WHERE a.user_id = pt.user_id
         AND a.received_at > now() - (${days} || ' days')::interval)`);
  }
  if (audience.taleRead && audience.taleRead.taleId) {
    const tale = add(String(audience.taleRead.taleId));
    const exists = `EXISTS (
      SELECT 1 FROM analytics_events a
       WHERE a.user_id = pt.user_id
         AND a.name = 'tale_complete'
         AND a.params->>'tale_id' = ${tale})`;
    where.push(audience.taleRead.read === false ? `NOT ${exists}` : exists);
  }

  return { where: where.join(' AND '), params };
}

const FROM = `
  FROM push_tokens pt
  LEFT JOIN users u        ON u.user_id = pt.user_id
  LEFT JOIN entitlements e ON e.user_id = pt.user_id`;

// Count reach without pulling every row — for the "show audience" preview.
async function previewAudience(audience) {
  const { where, params } = buildWhere(audience);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS tokens,
            COUNT(DISTINCT pt.user_id)::int AS users
       ${FROM} WHERE ${where}`,
    params
  );
  return rows[0]; // { tokens, users }
}

// Resolve the actual recipient tokens for sending.
async function resolveRecipients(audience) {
  const { where, params } = buildWhere(audience);
  const { rows } = await pool.query(
    `SELECT pt.user_id, pt.token, pt.platform,
            COALESCE(u.lang, pt.lang) AS lang
       ${FROM} WHERE ${where}`,
    params
  );
  return rows; // [{ user_id, token, platform, lang }]
}

module.exports = { previewAudience, resolveRecipients, buildWhere };
