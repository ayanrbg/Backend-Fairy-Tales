const express = require('express');
const apiKey = require('../middleware/apiKey');
const pool = require('../db');

const router = express.Router();

// POST /api/promo/check
router.post('/check', apiKey, async (req, res) => {
  try {
    const { code, externalUserId } = req.body;

    if (!code || !externalUserId) {
      return res.status(400).json({ error: 'code and externalUserId are required' });
    }

    const result = await pool.query(
      'SELECT code, type, blogger_name, duration_days, used_by FROM promo_codes WHERE code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Промокод не найден' });
    }

    const promo = result.rows[0];

    if (promo.type === 'blogger') {
      return res.json({ type: 'blogger', bloggerName: promo.blogger_name });
    }

    if (promo.type === 'premium') {
      if (promo.used_by) {
        return res.status(410).json({ error: 'Промокод уже использован' });
      }

      await pool.query(
        'UPDATE promo_codes SET used_by = $1, used_at = NOW() WHERE code = $2',
        [externalUserId, code]
      );

      return res.json({ type: 'premium', durationDays: promo.duration_days });
    }
  } catch (e) {
    console.error('Promo check error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/promo/purchase
router.post('/purchase', apiKey, async (req, res) => {
  try {
    const { code, externalUserId } = req.body;

    if (!code || !externalUserId) {
      return res.status(400).json({ error: 'code and externalUserId are required' });
    }

    const result = await pool.query(
      'SELECT type FROM promo_codes WHERE code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Промокод не найден' });
    }

    if (result.rows[0].type !== 'blogger') {
      return res.status(400).json({ error: 'Purchase tracking is only for blogger promo codes' });
    }

    await pool.query(
      'INSERT INTO promo_purchases (code, external_user_id) VALUES ($1, $2)',
      [code, externalUserId]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error('Promo purchase error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
