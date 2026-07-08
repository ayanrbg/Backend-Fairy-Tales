const pool = require('../db');

// FCM sender (Phase 1 of DEV_PLAN_PUSH_NOTIFICATIONS.md).
// Lazily initializes firebase-admin from FIREBASE_SERVICE_ACCOUNT (path or raw
// JSON) — same pattern as the optional Google/Apple deps. The whole subsystem
// deploys fine without the key; sending simply reports "not configured" until
// the service account is dropped in.

const FCM_BATCH = 500;           // FCM hard limit per sendEach call
// Errors that mean the token is permanently dead → soft-disable it.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

let messagingCache = null; // { messaging } | { error }

function getMessaging() {
  if (messagingCache) return messagingCache;
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
    // firebase-admin v13 exposes a modular API via subpaths.
    const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    let creds;
    try {
      creds = raw.trim().startsWith('{') ? JSON.parse(raw) : require(raw);
    } catch (e) {
      throw new Error(`bad FIREBASE_SERVICE_ACCOUNT: ${e.message}`);
    }
    // Reuse an already-initialized default app if present (e.g. hot reload).
    const app = getApps().length ? getApp() : initializeApp({ credential: cert(creds) });
    messagingCache = { messaging: getMessaging(app) };
  } catch (e) {
    messagingCache = { error: e.message };
  }
  return messagingCache;
}

function isConfigured() {
  return !!getMessaging().messaging;
}

// Pick the best content for a recipient's language, falling back to the
// campaign's default lang, then to any language present.
function pickContent(content, lang) {
  if (!content || typeof content !== 'object') return null;
  const langs = Object.keys(content).filter((k) => k !== 'default');
  const chosenLang =
    (lang && content[lang]) ? lang
    : (content.default && content[content.default]) ? content.default
    : langs[0];
  const c = chosenLang ? content[chosenLang] : null;
  return c ? { lang: chosenLang, ...c } : null;
}

// Deep-link + campaign id go in the `data` payload (client contract in
// CLIENT_TICKET_PUSH.md). All values must be strings for FCM.
function buildData(deeplink, campaignId) {
  const data = { campaignId: String(campaignId) };
  if (deeplink && typeof deeplink === 'object') {
    if (deeplink.type) data.type = String(deeplink.type);
    if (deeplink.taleId) data.taleId = String(deeplink.taleId);
    if (deeplink.url) data.url = String(deeplink.url);
  }
  return data;
}

function buildMessage(recipient, campaign) {
  const c = pickContent(campaign.content, recipient.lang);
  if (!c || !c.title && !c.body) return null; // nothing to say in any language
  const msg = {
    token: recipient.token,
    notification: { title: c.title || '', body: c.body || '' },
    data: buildData(campaign.deeplink, campaign.id),
  };
  if (c.image) msg.notification.image = c.image;
  return { message: msg, langUsed: c.lang };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Send a resolved recipient list for one campaign. Records a push_deliveries row
// per token, soft-disables dead tokens, and returns aggregate stats.
// Idempotent per (campaign, token) via the unique index (ON CONFLICT DO NOTHING).
async function sendToRecipients(campaign, recipients) {
  const { messaging, error } = getMessaging();
  if (!messaging) {
    console.error(`[PUSH] send aborted — FCM not configured: ${error}`);
    throw new Error('fcm_not_configured');
  }

  // Build messages, dropping recipients with no usable content.
  const built = [];
  for (const r of recipients) {
    const m = buildMessage(r, campaign);
    if (m) built.push({ recipient: r, ...m });
  }

  let sent = 0, failed = 0;
  const deadTokens = [];

  for (const group of chunk(built, FCM_BATCH)) {
    let resp;
    try {
      resp = await messaging.sendEach(group.map((g) => g.message));
    } catch (e) {
      // Whole-batch transport failure — count all as failed, keep going.
      console.error(`[PUSH] campaign=${campaign.id} batch send error: ${e.message}`);
      failed += group.length;
      await recordDeliveries(campaign.id, group.map((g) => ({
        recipient: g.recipient, langUsed: g.langUsed, status: 'failed', error: e.message,
      })));
      continue;
    }

    const rows = resp.responses.map((res, i) => {
      const g = group[i];
      if (res.success) {
        sent++;
        return { recipient: g.recipient, langUsed: g.langUsed, status: 'sent', messageId: res.messageId };
      }
      failed++;
      const code = res.error && res.error.code ? res.error.code : 'unknown';
      if (DEAD_TOKEN_CODES.has(code)) deadTokens.push(g.recipient.token);
      return { recipient: g.recipient, langUsed: g.langUsed, status: 'failed', error: code };
    });
    await recordDeliveries(campaign.id, rows);
    console.log(`[PUSH] campaign=${campaign.id} batch sent=${resp.successCount} failed=${resp.failureCount}`);
  }

  if (deadTokens.length) {
    await pool.query(
      'UPDATE push_tokens SET disabled_at = now() WHERE token = ANY($1) AND disabled_at IS NULL',
      [deadTokens]
    );
    console.log(`[PUSH] campaign=${campaign.id} disabled ${deadTokens.length} dead token(s)`);
  }

  return { targeted: recipients.length, sent, failed };
}

// One multi-row insert per batch. ON CONFLICT keeps a worker retry from
// duplicating rows for the same (campaign, token).
async function recordDeliveries(campaignId, rows) {
  if (!rows.length) return;
  const values = rows.map((_, i) => {
    const o = i * 7;
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
  });
  const params = rows.flatMap((r) => [
    campaignId, r.recipient.user_id || null, r.recipient.token,
    r.langUsed || null, r.status, r.messageId || null, r.error || null,
  ]);
  await pool.query(
    `INSERT INTO push_deliveries
       (campaign_id, user_id, token, lang_used, status, fcm_message_id, error)
     VALUES ${values.join(', ')}
     ON CONFLICT (campaign_id, token) DO NOTHING`,
    params
  );
}

// Low-level passthrough for the admin test endpoint (no DB side effects).
async function rawSendEach(messages) {
  const { messaging, error } = getMessaging();
  if (!messaging) throw new Error(error || 'fcm_not_configured');
  return messaging.sendEach(messages);
}

module.exports = { sendToRecipients, isConfigured, pickContent, buildMessage, rawSendEach };
