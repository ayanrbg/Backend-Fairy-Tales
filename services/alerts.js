const pool = require('../db');

// On-site admin activity feed. Each meaningful subscription event becomes one
// row; dedup_key keeps repeated validate calls / S2S retries from duplicating.

function buildMessage(kind, { source, productId, environment, userId }) {
  const env = environment ? `, ${environment}` : '';
  switch (kind) {
    case 'purchase': return `Новая покупка: ${productId || '—'} (${source}${env})`;
    case 'renewal':  return `Продление подписки: ${productId || '—'} (${source})`;
    case 'refund':   return `Возврат/отмена: ${productId || '—'} (${source})`;
    case 'expire':   return `Подписка истекла: ${productId || '—'} (${source})`;
    case 'promo':    return `Активирован промокод (${source})`;
    case 'admin':    return `Ручной грант администратора`;
    default:         return String(kind);
  }
}

async function emitAlert({ kind, userId = null, source = null, productId = null, environment = null, expiresAt = null, message = null, dedupKey = null }) {
  try {
    const key = dedupKey
      || [kind, source, userId, productId, expiresAt ? new Date(expiresAt).toISOString() : ''].join('|');
    const msg = message || buildMessage(kind, { source, productId, environment, userId });
    const r = await pool.query(
      `INSERT INTO admin_alerts (kind, user_id, source, product_id, environment, message, dedup_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
      [kind, userId, source, productId, environment, msg, key]
    );
    if (r.rowCount) console.log(`[ALERT] ${kind} user=${userId} source=${source} product=${productId} — stored id=${r.rows[0].id}`);
    else console.log(`[ALERT] ${kind} user=${userId} — deduped (${key})`);
  } catch (e) {
    // Never let alerting break the main flow.
    console.error(`[ALERT] emit failed (${kind}): ${e.message}`);
  }
}

async function listAlerts({ limit = 50, unreadOnly = false } = {}) {
  const where = unreadOnly ? 'WHERE read_at IS NULL' : '';
  const [rows, unread] = await Promise.all([
    pool.query(
      `SELECT id, kind, user_id, source, product_id, environment, message, read_at, created_at
         FROM admin_alerts ${where} ORDER BY created_at DESC LIMIT $1`,
      [Math.min(limit, 200)]
    ),
    pool.query('SELECT count(*)::int AS c FROM admin_alerts WHERE read_at IS NULL'),
  ]);
  return { alerts: rows.rows, unread: unread.rows[0].c };
}

async function markRead(ids) {
  if (Array.isArray(ids) && ids.length) {
    await pool.query('UPDATE admin_alerts SET read_at = now() WHERE id = ANY($1) AND read_at IS NULL', [ids]);
  } else {
    await pool.query('UPDATE admin_alerts SET read_at = now() WHERE read_at IS NULL');
  }
}

module.exports = { emitAlert, listAlerts, markRead };
