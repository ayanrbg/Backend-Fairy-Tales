const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const pool = require('../db');

const router = express.Router();

const PROMO_API_URL = process.env.PROMO_API_URL || 'https://promocode-stories.apiapp.kz/api/promo';
const PROMO_API_KEY = process.env.PROMO_API_KEY;

// POST /api/promo/check
router.post('/check', auth, async (req, res) => {
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
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': PROMO_API_KEY,
      },
      timeout: 10000,
    });

    const data = response.data;

    // Премиум-промокод — сразу активируем подписку
    if (data.type === 'premium') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + data.durationDays);

      await pool.query(
        `INSERT INTO subscriptions (user_id, product_id, original_transaction_id, expires_at, platform, updated_at)
         VALUES ($1, 'promo_premium', $2, $3, 'promo', NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET product_id = 'promo_premium',
             original_transaction_id = $2,
             expires_at = GREATEST(subscriptions.expires_at, $3),
             platform = 'promo',
             updated_at = NOW()`,
        [userId, `promo_${code}`, expiresAt]
      );

      return res.json({
        type: 'premium',
        durationDays: data.durationDays,
        expiresAt,
        message: `Премиум активирован на ${data.durationDays} дней`,
      });
    }

    // Блогер-промокод — возвращаем инфо клиенту
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
});

// POST /api/promo/purchase
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
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': PROMO_API_KEY,
      },
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
