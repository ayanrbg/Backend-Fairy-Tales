const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const pool = require('../db');

const router = express.Router();

const APPLE_VERIFY_PRODUCTION = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';
const SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

async function validateAppleReceipt(receiptPayload) {
  const body = {
    'receipt-data': receiptPayload,
    'password': SHARED_SECRET,
    'exclude-old-transactions': true,
  };

  let res = await axios.post(APPLE_VERIFY_PRODUCTION, body);

  // 21007 = sandbox receipt sent to production endpoint
  if (res.data.status === 21007) {
    res = await axios.post(APPLE_VERIFY_SANDBOX, body);
  }

  if (res.data.status !== 0) {
    console.error('Apple verify status:', res.data.status);
    return { valid: false, expiresAt: null };
  }

  const latestInfo = res.data.latest_receipt_info;
  if (!latestInfo || latestInfo.length === 0) {
    return { valid: false, expiresAt: null };
  }

  const latest = latestInfo[latestInfo.length - 1];
  const expiresMs = parseInt(latest.expires_date_ms);
  const expiresAt = new Date(expiresMs);

  return {
    valid: expiresMs > Date.now(),
    expiresAt,
    productId: latest.product_id,
    originalTransactionId: latest.original_transaction_id,
  };
}

// POST /api/subscription/validate
router.post('/validate', auth, async (req, res) => {
  try {
    const { receipt, platform } = req.body;
    const userId = req.userId;

    if (platform !== 'apple') {
      return res.json({ success: false });
    }

    if (!SHARED_SECRET) {
      console.error('APPLE_SHARED_SECRET is not configured');
      return res.status(503).json({ success: false, error: 'IAP not configured' });
    }

    const parsed = JSON.parse(receipt);
    const result = await validateAppleReceipt(parsed.Payload);

    if (result.valid) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, product_id, original_transaction_id, expires_at, platform, updated_at)
         VALUES ($1, $2, $3, $4, 'apple', NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET product_id = $2, original_transaction_id = $3, expires_at = $4, updated_at = NOW()`,
        [userId, result.productId, result.originalTransactionId, result.expiresAt]
      );
    }

    return res.json({ success: result.valid });
  } catch (e) {
    console.error('Receipt validation error:', e.message);
    return res.status(500).json({ success: false });
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

    return res.json({ active });
  } catch (e) {
    console.error('Status check error:', e.message);
    return res.json({ active: false });
  }
});

module.exports = router;
