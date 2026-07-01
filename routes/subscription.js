const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const pool = require('../db');

const router = express.Router();

const APPLE_VERIFY_PRODUCTION = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';
const SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

// Human-readable Apple verifyReceipt status codes (for logging)
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

/**
 * The client may send the receipt in several shapes:
 *   - a raw base64 string
 *   - a JSON string / object wrapping it under Payload / payload / receipt-data / receiptData / data
 * Return the base64 receipt string, or null if nothing usable was found.
 */
function extractReceiptData(receipt) {
  if (!receipt) return null;

  let obj = receipt;
  if (typeof receipt === 'string') {
    const trimmed = receipt.trim();
    // Try to parse as JSON; if it isn't JSON, assume it's already the base64 receipt.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        obj = JSON.parse(trimmed);
      } catch (_) {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }

  if (obj && typeof obj === 'object') {
    const candidate =
      obj.Payload ||
      obj.payload ||
      obj['receipt-data'] ||
      obj.receiptData ||
      obj.data;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }

  return null;
}

async function callApple(url, body) {
  const res = await axios.post(url, body, { timeout: 15000 });
  return res.data;
}

async function validateAppleReceipt(receiptData) {
  const body = {
    'receipt-data': receiptData,
    'password': SHARED_SECRET,
    'exclude-old-transactions': false,
  };

  let data = await callApple(APPLE_VERIFY_PRODUCTION, body);

  // 21007 = sandbox receipt sent to production endpoint -> retry on sandbox.
  if (data.status === 21007) {
    console.log('[IAP] sandbox receipt, retrying on sandbox endpoint');
    data = await callApple(APPLE_VERIFY_SANDBOX, body);
  }
  // 21008 = production receipt sent to sandbox (shouldn't happen here, but be safe).
  if (data.status === 21008) {
    data = await callApple(APPLE_VERIFY_PRODUCTION, body);
  }

  if (data.status !== 0) {
    const label = APPLE_STATUS[data.status] || 'unknown status';
    console.error(`[IAP] Apple verify FAILED status=${data.status} (${label})`);
    return { valid: false, reason: `apple_status_${data.status}` };
  }

  const latestInfo = data.latest_receipt_info || data.receipt?.in_app;
  if (!latestInfo || latestInfo.length === 0) {
    console.error('[IAP] Apple returned status=0 but no latest_receipt_info / in_app entries');
    return { valid: false, reason: 'no_transactions' };
  }

  // Pick the entry with the furthest expiry (order is not guaranteed).
  let best = null;
  for (const entry of latestInfo) {
    const ms = parseInt(entry.expires_date_ms || '0', 10);
    if (!best || ms > best.expiresMs) {
      best = {
        expiresMs: ms,
        productId: entry.product_id,
        originalTransactionId: entry.original_transaction_id,
      };
    }
  }

  const now = Date.now();
  const valid = best.expiresMs > now;
  if (!valid) {
    console.error(
      `[IAP] Receipt valid but subscription EXPIRED product=${best.productId} ` +
      `expiresAt=${new Date(best.expiresMs).toISOString()}`
    );
    return { valid: false, reason: 'expired', ...best, expiresAt: new Date(best.expiresMs) };
  }

  return {
    valid: true,
    expiresAt: new Date(best.expiresMs),
    productId: best.productId,
    originalTransactionId: best.originalTransactionId,
  };
}

// POST /api/subscription/validate
router.post('/validate', auth, async (req, res) => {
  const userId = req.userId;
  try {
    const { receipt, platform } = req.body;

    console.log(
      `[IAP] validate request user=${userId} platform=${platform} ` +
      `receiptType=${typeof receipt} receiptLen=${receipt ? String(receipt).length : 0}`
    );

    if (platform && platform !== 'apple') {
      console.error(`[IAP] unsupported platform=${platform} user=${userId}`);
      return res.json({ success: false, error: 'unsupported_platform' });
    }

    if (!SHARED_SECRET) {
      console.error('[IAP] APPLE_SHARED_SECRET is not configured');
      return res.status(503).json({ success: false, error: 'IAP not configured' });
    }

    const receiptData = extractReceiptData(receipt);
    if (!receiptData) {
      console.error(
        `[IAP] could not extract receipt-data user=${userId}. ` +
        `Raw receipt (first 300 chars): ${String(receipt).slice(0, 300)}`
      );
      return res.json({ success: false, error: 'bad_receipt_format' });
    }

    const result = await validateAppleReceipt(receiptData);

    if (result.valid) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, product_id, original_transaction_id, expires_at, platform, updated_at)
         VALUES ($1, $2, $3, $4, 'apple', NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET product_id = $2,
             original_transaction_id = $3,
             expires_at = GREATEST(subscriptions.expires_at, $4),
             platform = 'apple',
             updated_at = NOW()`,
        [userId, result.productId, result.originalTransactionId, result.expiresAt]
      );
      console.log(
        `[IAP] GRANTED user=${userId} product=${result.productId} ` +
        `expiresAt=${result.expiresAt.toISOString()}`
      );
      return res.json({ success: true, expiresAt: result.expiresAt });
    }

    console.error(`[IAP] NOT granted user=${userId} reason=${result.reason}`);
    return res.json({ success: false, error: result.reason });
  } catch (e) {
    console.error(`[IAP] Receipt validation error user=${userId}: ${e.message}`);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
});

// GET /api/subscription/status
router.get('/status', auth, async (req, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      'SELECT expires_at FROM subscriptions WHERE user_id = $1',
      [userId]
    );

    const active = result.rows.length > 0
      && new Date(result.rows[0].expires_at) > new Date();

    return res.json({
      active,
      expiresAt: result.rows.length > 0 ? result.rows[0].expires_at : null,
    });
  } catch (e) {
    console.error('Status check error:', e.message);
    return res.json({ active: false });
  }
});

module.exports = router;
