const express = require('express');
const pool = require('../db');
const adminKey = require('../middleware/adminKey');
const segments = require('../services/pushSegments');
const sender = require('../services/pushSender');
const tokens = require('../services/pushTokens');

const router = express.Router();
router.use(adminKey);

// Admin push API (Phase 1 of DEV_PLAN_PUSH_NOTIFICATIONS.md). Proxied from the
// bala-stories site with X-Admin-Key; X-Admin-Actor carries who did it.
// Scheduling (schedule_at + worker) and automations are Phases 2–3.

const CAMPAIGN_COLS =
  'id, title, status, audience, content, deeplink, schedule_at, stats, created_by, created_at, sent_at';

function actor(req) {
  return req.headers['x-admin-actor'] || null;
}

// Validate/normalize the multilang content block. Requires at least one language
// with a title or body, and a `default` that points at a present language.
function normalizeContent(content) {
  if (!content || typeof content !== 'object') return { error: 'content required' };
  const langs = Object.keys(content).filter((k) => k !== 'default');
  const present = langs.filter((l) => content[l] && (content[l].title || content[l].body));
  if (!present.length) return { error: 'content needs at least one language with title/body' };
  const def = content.default && present.includes(content.default) ? content.default : present[0];
  return { content: { ...content, default: def } };
}

// GET /api/admin/push/campaigns — list with status + stats.
router.get('/campaigns', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const { rows } = await pool.query(
      `SELECT ${CAMPAIGN_COLS} FROM push_campaigns ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (e) {
    console.error(`[PUSH] list campaigns error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/admin/push/campaigns/:id — detail + delivery breakdown.
router.get('/campaigns/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${CAMPAIGN_COLS} FROM push_campaigns WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const breakdown = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM push_deliveries WHERE campaign_id = $1 GROUP BY status`,
      [req.params.id]
    );
    const errors = await pool.query(
      `SELECT error, COUNT(*)::int AS count FROM push_deliveries
        WHERE campaign_id = $1 AND status = 'failed' AND error IS NOT NULL
        GROUP BY error ORDER BY count DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ ...rows[0], deliveries: breakdown.rows, errors: errors.rows });
  } catch (e) {
    console.error(`[PUSH] campaign detail error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/push/campaigns — create a draft.
router.post('/campaigns', async (req, res) => {
  try {
    const b = req.body || {};
    const norm = normalizeContent(b.content);
    if (norm.error) return res.status(400).json({ error: norm.error });
    const { rows } = await pool.query(
      `INSERT INTO push_campaigns (title, status, audience, content, deeplink, schedule_at, created_by)
       VALUES ($1, 'draft', $2, $3, $4, $5, $6) RETURNING ${CAMPAIGN_COLS}`,
      [b.title || null, b.audience || {}, norm.content, b.deeplink || null,
       b.scheduleAt ? new Date(b.scheduleAt) : null, actor(req)]
    );
    console.log(`[PUSH] campaign created id=${rows[0].id} by=${actor(req) || '?'}`);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(`[PUSH] create campaign error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// PUT /api/admin/push/campaigns/:id — edit a draft/scheduled campaign only.
router.put('/campaigns/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await pool.query('SELECT status FROM push_campaigns WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'not_found' });
    if (!['draft', 'scheduled'].includes(cur.rows[0].status)) {
      return res.status(409).json({ error: `cannot edit a ${cur.rows[0].status} campaign` });
    }
    let content;
    if (b.content !== undefined) {
      const norm = normalizeContent(b.content);
      if (norm.error) return res.status(400).json({ error: norm.error });
      content = norm.content;
    }
    const { rows } = await pool.query(
      `UPDATE push_campaigns SET
         title       = COALESCE($2, title),
         audience    = COALESCE($3, audience),
         content     = COALESCE($4, content),
         deeplink    = COALESCE($5, deeplink),
         schedule_at = $6
       WHERE id = $1 RETURNING ${CAMPAIGN_COLS}`,
      [req.params.id, b.title ?? null, b.audience ?? null, content ?? null,
       b.deeplink ?? null, b.scheduleAt ? new Date(b.scheduleAt) : null]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(`[PUSH] update campaign error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/push/preview-audience — reach for a given audience (no send).
router.post('/preview-audience', async (req, res) => {
  try {
    const counts = await segments.previewAudience((req.body || {}).audience || {});
    res.json(counts);
  } catch (e) {
    console.error(`[PUSH] preview-audience error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/push/campaigns/:id/send — send now.
router.post('/campaigns/:id/send', async (req, res) => {
  if (!sender.isConfigured()) return res.status(503).json({ error: 'fcm_not_configured' });
  const id = req.params.id;
  try {
    // Claim the campaign atomically so a double-click can't send it twice.
    const claim = await pool.query(
      `UPDATE push_campaigns SET status = 'sending'
        WHERE id = $1 AND status IN ('draft', 'scheduled') RETURNING ${CAMPAIGN_COLS}`,
      [id]
    );
    if (!claim.rows.length) {
      const cur = await pool.query('SELECT status FROM push_campaigns WHERE id = $1', [id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'not_found' });
      return res.status(409).json({ error: `campaign is ${cur.rows[0].status}` });
    }
    const campaign = claim.rows[0];
    const recipients = await segments.resolveRecipients(campaign.audience || {});
    console.log(`[PUSH] campaign=${id} sending to ${recipients.length} token(s)`);

    const stats = await sender.sendToRecipients(campaign, recipients);
    const { rows } = await pool.query(
      `UPDATE push_campaigns SET status = 'sent', sent_at = now(), stats = $2
        WHERE id = $1 RETURNING ${CAMPAIGN_COLS}`,
      [id, JSON.stringify(stats)]
    );
    console.log(`[PUSH] campaign=${id} done targeted=${stats.targeted} sent=${stats.sent} failed=${stats.failed}`);
    res.json(rows[0]);
  } catch (e) {
    console.error(`[PUSH] send campaign=${id} error: ${e.message}`);
    await pool.query(`UPDATE push_campaigns SET status = 'failed' WHERE id = $1`, [id]).catch(() => {});
    res.status(500).json({ error: 'send_failed', detail: e.message });
  }
});

// POST /api/admin/push/campaigns/:id/cancel — cancel a draft/scheduled campaign.
router.post('/campaigns/:id/cancel', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE push_campaigns SET status = 'canceled'
        WHERE id = $1 AND status IN ('draft', 'scheduled') RETURNING ${CAMPAIGN_COLS}`,
      [req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'not cancelable' });
    res.json(rows[0]);
  } catch (e) {
    console.error(`[PUSH] cancel campaign error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/push/test — send a one-off to a single userId (or raw token).
// Does not create a campaign row; for "does my copy look right on my phone".
router.post('/test', async (req, res) => {
  if (!sender.isConfigured()) return res.status(503).json({ error: 'fcm_not_configured' });
  try {
    const b = req.body || {};
    const norm = normalizeContent(b.content);
    if (norm.error) return res.status(400).json({ error: norm.error });

    let recipients;
    if (b.token) {
      recipients = [{ user_id: null, token: b.token, platform: null, lang: b.lang || null }];
    } else if (b.userId) {
      recipients = await segments.resolveRecipients({ userId: b.userId });
    } else {
      return res.status(400).json({ error: 'userId or token required' });
    }
    if (!recipients.length) return res.status(404).json({ error: 'no active tokens for target' });

    // Ephemeral campaign object (negative id → never collides with a real row;
    // deliveries are not persisted for tests).
    const campaign = { id: `test-${Date.now()}`, content: norm.content, deeplink: b.deeplink || null };
    // Send inline without recording deliveries (test id isn't a real FK).
    const stats = await sendTestOnly(campaign, recipients);
    res.json({ ok: true, ...stats });
  } catch (e) {
    console.error(`[PUSH] test error: ${e.message}`);
    res.status(500).json({ error: 'internal_error', detail: e.message });
  }
});

// Minimal FCM send for the test endpoint — no DB writes, no token disabling.
async function sendTestOnly(campaign, recipients) {
  const built = recipients
    .map((r) => sender.buildMessage(r, campaign))
    .filter(Boolean);
  if (!built.length) return { targeted: recipients.length, sent: 0, failed: recipients.length };
  const resp = await sender.rawSendEach(built.map((b) => b.message));
  console.log(`[PUSH] test sent=${resp.successCount} failed=${resp.failureCount}`);
  return { targeted: recipients.length, sent: resp.successCount, failed: resp.failureCount };
}

// GET /api/admin/push/tokens/stats — token health (active/disabled by platform).
router.get('/tokens/stats', async (req, res) => {
  try {
    res.json({ configured: sender.isConfigured(), platforms: await tokens.tokenStats() });
  } catch (e) {
    console.error(`[PUSH] tokens stats error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
