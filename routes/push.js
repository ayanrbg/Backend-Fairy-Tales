const express = require('express');
const auth = require('../middleware/auth');
const tokens = require('../services/pushTokens');

const optionalAuth = auth.optional;
const router = express.Router();

// Client-facing push endpoints (Phase 0 of DEV_PLAN_PUSH_NOTIFICATIONS.md).
// A valid JWT wins over the body's userId; but tokens may register before login
// (permission prompt shown early), so auth is optional — mirrors analytics.

// POST /api/push/register — the device stores/refreshes its FCM token.
// Called on launch, on every FCM token refresh, and on language change.
// Idempotent; always 200 so a registration hiccup never blocks the app.
router.post('/register', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    if (!token || token.length > tokens.MAX_TOKEN_LEN) {
      console.warn(`[PUSH] register rejected: ${token ? 'token too long' : 'no token'}`);
      return res.status(400).json({ error: 'token required' });
    }
    const userId = req.userId || b.userId || null;
    const platform = tokens.PLATFORMS.has(b.platform) ? b.platform : null;
    const lang = typeof b.lang === 'string' ? b.lang.slice(0, 8) : null;
    const appVersion = typeof b.appVersion === 'string' ? b.appVersion.slice(0, 32) : null;

    const row = await tokens.registerToken({ userId, token, platform, appVersion, lang });
    console.log(
      `[PUSH] register ${row.inserted ? 'NEW' : 'refresh'} user=${userId || 'anon'} ` +
      `platform=${platform || '?'} v${appVersion || '?'} lang=${lang || '?'} id=${row.id}`
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error(`[PUSH] register error: ${e.message}`);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/push/unregister — device opted out of notifications / logged out.
router.post('/unregister', optionalAuth, async (req, res) => {
  try {
    const token = typeof (req.body || {}).token === 'string' ? req.body.token.trim() : '';
    if (!token) return res.status(400).json({ error: 'token required' });
    const disabled = await tokens.disableToken(token);
    console.log(`[PUSH] unregister ${disabled ? 'disabled' : 'noop'} user=${req.userId || 'anon'}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error(`[PUSH] unregister error: ${e.message}`);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/push/opened — client reports a push tap (open-rate). Fire-and-forget:
// always 200 so analytics never breaks the app. campaignId is numeric for real
// campaigns; test pushes carry a non-numeric id and are simply ignored.
router.post('/opened', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const campaignId = String(b.campaignId || '').trim();
    const userId = req.userId || b.userId || null;
    if (/^\d+$/.test(campaignId) && userId) {
      const n = await tokens.recordOpen(campaignId, userId);
      if (n) console.log(`[PUSH] opened campaign=${campaignId} user=${userId}`);
    }
  } catch (e) {
    console.error(`[PUSH] opened error: ${e.message}`);
  }
  return res.json({ ok: true });
});

module.exports = router;
