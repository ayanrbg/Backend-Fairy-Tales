const express = require('express');
const adminKey = require('../middleware/adminKey');
const ent = require('../services/entitlements');

const router = express.Router();
router.use(adminKey);

// GET /api/admin/subscriptions?active=true&limit=&offset=&q=
router.get('/', async (req, res) => {
  try {
    const rows = await ent.listEntitlements({
      activeOnly: req.query.active === 'true',
      q: req.query.q || null,
      limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
      offset: parseInt(req.query.offset, 10) || 0,
    });
    res.json(rows);
  } catch (e) {
    console.error(`[ADMIN] list subscriptions error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/admin/subscriptions/:userId — entitlement + event history + last snapshot.
router.get('/:userId', async (req, res) => {
  try {
    res.json(await ent.getEntitlementDetail(req.params.userId));
  } catch (e) {
    console.error(`[ADMIN] subscription detail error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/subscriptions/:userId/grant — { days } | { until } | lifetime.
router.post('/:userId/grant', async (req, res) => {
  try {
    const { days, until } = req.body || {};
    let expiresAt = null;
    if (until) {
      expiresAt = new Date(until);
      if (isNaN(expiresAt)) return res.status(400).json({ error: 'invalid until' });
    } else if (days != null) {
      expiresAt = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
    }
    const e = await ent.adminGrant(req.params.userId, expiresAt);
    console.log(`[ADMIN] grant user=${req.params.userId} expiresAt=${expiresAt ? expiresAt.toISOString() : 'lifetime'}`);
    res.json(ent.statusResponse(e));
  } catch (e) {
    console.error(`[ADMIN] grant error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/subscriptions/:userId/revoke
router.post('/:userId/revoke', async (req, res) => {
  try {
    const e = await ent.adminRevoke(req.params.userId);
    if (!e) return res.status(404).json({ error: 'no entitlement for user' });
    console.log(`[ADMIN] revoke user=${req.params.userId}`);
    res.json(ent.statusResponse(e));
  } catch (e) {
    console.error(`[ADMIN] revoke error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/subscriptions/:userId/extend — { days }
router.post('/:userId/extend', async (req, res) => {
  try {
    const days = Number((req.body || {}).days);
    if (!days || isNaN(days)) return res.status(400).json({ error: 'days required' });
    const e = await ent.adminExtend(req.params.userId, days);
    if (!e) return res.status(404).json({ error: 'no entitlement for user' });
    console.log(`[ADMIN] extend user=${req.params.userId} days=${days}`);
    res.json(ent.statusResponse(e));
  } catch (e) {
    console.error(`[ADMIN] extend error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
