const express = require('express');
const adminKey = require('../middleware/adminKey');
const alerts = require('../services/alerts');

const router = express.Router();
router.use(adminKey);

// GET /api/admin/alerts?limit=50&unreadOnly=true — activity feed + unread count.
router.get('/', async (req, res) => {
  try {
    const data = await alerts.listAlerts({
      limit: parseInt(req.query.limit, 10) || 50,
      unreadOnly: req.query.unreadOnly === 'true',
    });
    res.json(data);
  } catch (e) {
    console.error(`[ADMIN] alerts list error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/alerts/read — body { ids: [..] } marks those; empty = mark all.
router.post('/read', async (req, res) => {
  try {
    await alerts.markRead((req.body && req.body.ids) || null);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[ADMIN] alerts read error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
