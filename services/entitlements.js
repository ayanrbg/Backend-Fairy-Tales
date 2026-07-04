const axios = require('axios');
const pool = require('../db');

const APPLE_VERIFY_PRODUCTION = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';
const SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

const OUR_PRODUCTS = new Set(['fairytales_monthly', 'fairytales_yearly']);

const APPLE_STATUS = {
  21000: 'App Store could not read the JSON',
  21002: 'receipt-data malformed or missing',
  21003: 'receipt could not be authenticated',
  21004: 'shared secret does not match',
  21005: 'receipt server temporarily unavailable',
  21007: 'sandbox receipt sent to production',
  21008: 'production receipt sent to sandbox',
  21010: 'account not found / deleted',
};

// ─────────────────────────── core helpers ───────────────────────────

function isActive(e) {
  return !!e && e.premium && (e.expires_at === null || new Date(e.expires_at) > new Date());
}

function statusResponse(e) {
  if (!e) return { active: false, expiresAt: null, source: null, productId: null };
  return {
    active: isActive(e),
    expiresAt: e.expires_at ? new Date(e.expires_at).toISOString() : null,
    source: e.source,
    productId: e.product_id,
  };
}

async function getEntitlement(userId) {
  const r = await pool.query('SELECT * FROM entitlements WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

async function logEvent(userId, source, raw, kind) {
  try {
    await pool.query(
      'INSERT INTO subscription_events (user_id, source, raw, kind) VALUES ($1, $2, $3, $4)',
      [userId, source, raw ? JSON.stringify(raw) : null, kind]
    );
  } catch (e) {
    console.error('[IAP] failed to log subscription_event:', e.message);
  }
}

/** A manual grant (admin/promo) that is still active must not be clobbered. */
function isProtectedManual(e) {
  return !!e && (e.source === 'admin' || e.source === 'promo')
    && (e.expires_at === null || new Date(e.expires_at) > new Date());
}

/**
 * Upsert an entitlement for `userId`. If the same store transaction (Apple
 * originalTransactionId / Google purchaseToken) is currently attached to a
 * different user (reinstall → new GUID), we move it to `userId` (merge, §4).
 *
 * `opts.protectManual` (used by the store validate/revalidate paths) leaves an
 * active admin/promo grant untouched: the store may add/extend its own record
 * but must never strip a manual grant (§9c). Admin/promo writes pass it falsey
 * so they can overwrite a store record.
 */
async function upsertEntitlement(fields, opts = {}) {
  const {
    userId, source, productId = null, originalTransactionId = null,
    purchaseToken = null, expiresAt = null, autoRenew = null, environment = null,
  } = fields;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (opts.protectManual) {
      const existing = await client.query(
        'SELECT * FROM entitlements WHERE user_id = $1 FOR UPDATE', [userId]
      );
      if (isProtectedManual(existing.rows[0])) {
        await client.query('COMMIT');
        console.log(`[IAP] store validate for user=${userId} kept manual grant source=${existing.rows[0].source} (not downgraded)`);
        return existing.rows[0];
      }
    }

    // Merge: detach this store transaction from any other user.
    if (originalTransactionId) {
      const moved = await client.query(
        'DELETE FROM entitlements WHERE original_transaction_id = $1 AND user_id <> $2 RETURNING user_id',
        [originalTransactionId, userId]
      );
      if (moved.rows.length) {
        console.log(`[IAP] merge: moved apple tx ${originalTransactionId} from user=${moved.rows[0].user_id} to user=${userId}`);
      }
    }
    if (purchaseToken) {
      const moved = await client.query(
        'DELETE FROM entitlements WHERE purchase_token = $1 AND user_id <> $2 RETURNING user_id',
        [purchaseToken, userId]
      );
      if (moved.rows.length) {
        console.log(`[IAP] merge: moved google token from user=${moved.rows[0].user_id} to user=${userId}`);
      }
    }

    const r = await client.query(
      `INSERT INTO entitlements
         (user_id, premium, source, product_id, original_transaction_id, purchase_token, expires_at, auto_renew, environment, updated_at)
       VALUES ($1, TRUE, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (user_id) DO UPDATE SET
         premium = TRUE,
         source = EXCLUDED.source,
         product_id = EXCLUDED.product_id,
         original_transaction_id = COALESCE(EXCLUDED.original_transaction_id, entitlements.original_transaction_id),
         purchase_token = COALESCE(EXCLUDED.purchase_token, entitlements.purchase_token),
         expires_at = EXCLUDED.expires_at,
         auto_renew = EXCLUDED.auto_renew,
         environment = EXCLUDED.environment,
         updated_at = now()
       RETURNING *`,
      [userId, source, productId, originalTransactionId, purchaseToken, expiresAt, autoRenew, environment]
    );

    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────── Apple ───────────────────────────

/**
 * The client may send the receipt as a raw base64 string or wrapped in JSON
 * under Payload / payload / receipt-data / receiptData / data.
 */
function extractReceiptData(receipt) {
  if (!receipt) return null;
  let obj = receipt;
  if (typeof receipt === 'string') {
    const trimmed = receipt.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { obj = JSON.parse(trimmed); } catch (_) { return trimmed; }
    } else {
      return trimmed;
    }
  }
  if (obj && typeof obj === 'object') {
    const c = obj.Payload || obj.payload || obj['receipt-data'] || obj.receiptData || obj.data;
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

async function callApple(url, body) {
  const res = await axios.post(url, body, { timeout: 15000 });
  return res.data;
}

/**
 * Validate an Apple receipt. Always production first, fall back to sandbox on
 * 21007 (and the reverse on 21008). Returns a normalized result.
 */
async function verifyAppleReceipt(receiptData) {
  const body = {
    'receipt-data': receiptData,
    'password': SHARED_SECRET,
    'exclude-old-transactions': false,
  };

  let data = await callApple(APPLE_VERIFY_PRODUCTION, body);
  if (data.status === 21007) {
    data = await callApple(APPLE_VERIFY_SANDBOX, body);
  }
  if (data.status === 21008) {
    data = await callApple(APPLE_VERIFY_PRODUCTION, body);
  }

  if (data.status !== 0) {
    const label = APPLE_STATUS[data.status] || 'unknown status';
    // 21005 = Apple temporarily unavailable -> caller should return 503.
    return { valid: false, transient: data.status === 21005, reason: `apple_status_${data.status}`, label, raw: data };
  }

  const info = data.latest_receipt_info || data.receipt?.in_app;
  if (!info || info.length === 0) {
    return { valid: false, reason: 'no_transactions', raw: data };
  }

  // Prefer our known products; pick the entry with the furthest expiry.
  let best = null;
  for (const e of info) {
    if (e.product_id && OUR_PRODUCTS.size && !OUR_PRODUCTS.has(e.product_id)) {
      // still consider it, but only if we find nothing better
    }
    const ms = parseInt(e.expires_date_ms || '0', 10);
    const preferred = e.product_id && OUR_PRODUCTS.has(e.product_id);
    if (!best || ms > best.ms || (preferred && !best.preferred)) {
      best = {
        ms,
        preferred,
        productId: e.product_id,
        originalTransactionId: e.original_transaction_id,
      };
    }
  }

  const environment = (data.environment || '').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const expiresAt = new Date(best.ms);
  const valid = best.ms > Date.now();

  return {
    valid,
    reason: valid ? null : 'expired',
    expiresAt,
    productId: best.productId,
    originalTransactionId: best.originalTransactionId,
    environment,
    autoRenew: null,
    raw: data,
  };
}

// ─────────────────────────── Google ───────────────────────────

const GOOGLE_PACKAGE_NAME = process.env.GOOGLE_PACKAGE_NAME;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

let googleAuthClient = null;
function getGoogleAuth() {
  if (googleAuthClient) return googleAuthClient;
  if (!GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  // Lazy require so the dependency is optional until Google is configured.
  const { GoogleAuth } = require('google-auth-library');
  let creds;
  try {
    // Accept either raw JSON or a path to the key file.
    creds = GOOGLE_SERVICE_ACCOUNT_JSON.trim().startsWith('{')
      ? JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON)
      : require(GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    console.error('[IAP] bad GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
    return null;
  }
  googleAuthClient = new GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  return googleAuthClient;
}

async function verifyGooglePurchase(purchaseToken, productId) {
  const auth = getGoogleAuth();
  if (!auth || !GOOGLE_PACKAGE_NAME) {
    return { valid: false, notConfigured: true, reason: 'google_not_configured' };
  }
  const token = await (await auth.getClient()).getAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/subscriptions/${productId}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token.token || token}` },
    timeout: 15000,
  });
  const d = res.data;
  const expiresMs = parseInt(d.expiryTimeMillis || '0', 10);
  const paymentOk = d.paymentState === 1 || d.paymentState === 2; // received | trial
  const valid = expiresMs > Date.now() && paymentOk;

  // Acknowledge the purchase if not yet acknowledged.
  if (d.acknowledgementState === 0) {
    try {
      await axios.post(`${url}:acknowledge`, {}, {
        headers: { Authorization: `Bearer ${token.token || token}` }, timeout: 15000,
      });
    } catch (e) {
      console.error('[IAP] google acknowledge failed:', e.message);
    }
  }

  return {
    valid,
    reason: valid ? null : 'expired_or_unpaid',
    expiresAt: new Date(expiresMs),
    productId,
    autoRenew: d.autoRenewing ?? null,
    environment: 'production',
    raw: d,
  };
}

/**
 * Apply an App Store Server Notification (S2S) to an existing apple entitlement,
 * matched by originalTransactionId. Promo grants (source='promo') are never
 * touched. Returns the affected user_id, or null if we have no such row.
 */
async function applyAppleNotification({ originalTransactionId, premium, expiresAt = null, autoRenew = null, productId = null, environment = null }) {
  const r = await pool.query(
    `UPDATE entitlements SET
       premium = $2,
       expires_at = COALESCE($3, expires_at),
       auto_renew = COALESCE($4, auto_renew),
       product_id = COALESCE($5, product_id),
       environment = COALESCE($6, environment),
       updated_at = now()
     WHERE original_transaction_id = $1 AND source = 'apple'
     RETURNING user_id`,
    [originalTransactionId, premium, expiresAt, autoRenew, productId, environment]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
}

// ─────────────────────────── snapshots (§9b) ───────────────────────────

async function saveSnapshot({ userId, platform, appVersion, context, cachedPremium, products, clientTs }) {
  await pool.query(
    `INSERT INTO subscription_snapshots
       (user_id, platform, app_version, context, cached_premium, products, client_ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, platform, appVersion, context,
     typeof cachedPremium === 'boolean' ? cachedPremium : null,
     products ? JSON.stringify(products) : null,
     clientTs ? new Date(clientTs) : null]
  );
}

// ─────────────────────────── admin control (§9c) ───────────────────────────

async function listEntitlements({ activeOnly = false, q = null, limit = 100, offset = 0 }) {
  const where = [];
  const params = [];
  if (activeOnly) {
    where.push('premium = TRUE AND (expires_at IS NULL OR expires_at > now())');
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`user_id ILIKE $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit); const limIdx = params.length;
  params.push(offset); const offIdx = params.length;
  const { rows } = await pool.query(
    `SELECT user_id, premium, source, product_id, expires_at, environment, updated_at
       FROM entitlements ${whereSql}
       ORDER BY updated_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );
  return rows.map((e) => ({
    userId: e.user_id,
    active: isActive(e),
    premium: e.premium,
    source: e.source,
    productId: e.product_id,
    expiresAt: e.expires_at ? new Date(e.expires_at).toISOString() : null,
    environment: e.environment,
    updatedAt: e.updated_at ? new Date(e.updated_at).toISOString() : null,
  }));
}

async function getEntitlementDetail(userId) {
  const entitlement = statusResponse(await getEntitlement(userId));
  const [events, snap] = await Promise.all([
    pool.query(
      'SELECT id, source, kind, created_at FROM subscription_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [userId]
    ),
    pool.query(
      'SELECT platform, app_version, context, cached_premium, products, client_ts, received_at FROM subscription_snapshots WHERE user_id = $1 ORDER BY received_at DESC LIMIT 1',
      [userId]
    ),
  ]);
  return {
    userId,
    entitlement,
    events: events.rows,
    lastSnapshot: snap.rows[0] || null,
  };
}

/**
 * Manual admin grant — highest authority. Overwrites any store record and is
 * immune to later store validation / S2S (source='admin', §9c).
 * `expiresAt=null` → lifetime.
 */
async function adminGrant(userId, expiresAt) {
  const e = await upsertEntitlement({
    userId, source: 'admin', productId: null, expiresAt,
  });
  await logEvent(userId, 'admin', { expiresAt }, 'admin_grant');
  return e;
}

async function adminRevoke(userId) {
  const r = await pool.query(
    `UPDATE entitlements SET premium = FALSE, updated_at = now()
     WHERE user_id = $1 RETURNING *`,
    [userId]
  );
  await logEvent(userId, 'admin', null, 'admin_revoke');
  return r.rows[0] || null;
}

async function adminExtend(userId, days) {
  const r = await pool.query(
    `UPDATE entitlements SET
       premium = TRUE,
       expires_at = COALESCE(expires_at, now()) + ($2 || ' days')::interval,
       updated_at = now()
     WHERE user_id = $1 RETURNING *`,
    [userId, String(days)]
  );
  await logEvent(userId, 'admin', { days }, 'admin_extend');
  return r.rows[0] || null;
}

module.exports = {
  isActive,
  statusResponse,
  getEntitlement,
  logEvent,
  upsertEntitlement,
  saveSnapshot,
  listEntitlements,
  getEntitlementDetail,
  adminGrant,
  adminRevoke,
  adminExtend,
  applyAppleNotification,
  extractReceiptData,
  verifyAppleReceipt,
  verifyGooglePurchase,
  SHARED_SECRET,
  OUR_PRODUCTS,
};
