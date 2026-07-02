const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const ent = require('../services/entitlements');

const router = express.Router();

const PROMO_API_URL = process.env.PROMO_API_URL || 'https://promocode-stories.apiapp.kz/api/promo';
const PROMO_API_KEY = process.env.PROMO_API_KEY;

// Shared handler: validate a promo code against the external promo service and,
// for premium codes, write the grant into `entitlements` (source='promo').
async function handlePromoCheck(req, res) {
  try {
    const { code } = req.body;
    const userId = req.userId;

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }
    if (!PROMO_API_KEY) {
      return res.status(503).json({ error: 'Promo service not configured' });
    }

    const response = await axios.post(`${PROMO_API_URL}/check`, {
      code,
      externalUserId: String(userId),
      app: 'BALA_STORIES',
    }, {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': PROMO_API_KEY },
      timeout: 10000,
    });

    const data = response.data;

    // Premium promo — activate the entitlement on the server.
    if (data.type === 'premium') {
      // durationDays present -> temporary; absent/null -> lifetime (expires_at null).
      const expiresAt = data.durationDays
        ? new Date(Date.now() + data.durationDays * 24 * 60 * 60 * 1000)
        : null;

      const e = await ent.upsertEntitlement({
        userId,
        source: 'promo',
        productId: null,
        expiresAt,
      });
      ent.logEvent(userId, 'promo', data, 'promo');
      console.log(`[IAP] GRANTED promo user=${userId} code=${code} expiresAt=${expiresAt ? expiresAt.toISOString() : 'lifetime'}`);

      return res.json({
        type: 'premium',
        durationDays: data.durationDays,
        expiresAt: e.expires_at,
        message: data.durationDays
          ? `Премиум активирован на ${data.durationDays} дней`
          : 'Премиум активирован',
      });
    }

    // Blogger promo — return info to the client.
    if (data.type === 'blogger') {
      return res.json({
        type: 'blogger',
        bloggerName: data.bloggerName,
        message: `Промокод блогера ${data.bloggerName} применён`,
      });
    }

    return res.json(data);
  } catch (e) {
    if (e.response) {
      return res.status(e.response.status).json(e.response.data);
    }
    console.error('Promo check error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/promo/check (legacy) and POST /api/promo (spec §5) — same behaviour.
router.post('/check', auth, handlePromoCheck);
router.post('/', auth, handlePromoCheck);

// POST /api/promo/purchase — proxy to the external promo service (unchanged).
router.post('/purchase', auth, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.userId;

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }
    if (!PROMO_API_KEY) {
      return res.status(503).json({ error: 'Promo service not configured' });
    }

    const response = await axios.post(`${PROMO_API_URL}/purchase`, {
      code,
      externalUserId: String(userId),
      app: 'BALA_STORIES',
    }, {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': PROMO_API_KEY },
      timeout: 10000,
    });

    return res.json(response.data);
  } catch (e) {
    if (e.response) {
      return res.status(e.response.status).json(e.response.data);
    }
    console.error('Promo purchase error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
