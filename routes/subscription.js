const express = require('express');
const auth = require('../middleware/auth');
const optionalAuth = auth.optional;
const ent = require('../services/entitlements');
const alerts = require('../services/alerts');

const router = express.Router();

// POST /api/subscription/validate — client calls after purchase / restore.
router.post('/validate', auth, async (req, res) => {
  const userId = req.userId;
  try {
    const { receipt, platform } = req.body;
    const bodyPlatform = (platform || 'apple').toLowerCase();

    console.log(
      `[IAP] validate user=${userId} platform=${bodyPlatform} ` +
      `receiptType=${typeof receipt} receiptLen=${receipt ? String(receipt).length : 0}`
    );

    // ── Apple ──
    if (bodyPlatform === 'apple') {
      if (!ent.SHARED_SECRET) {
        console.error('[IAP] APPLE_SHARED_SECRET is not configured');
        return res.status(503).json({ active: false, error: 'iap_not_configured' });
      }
      const receiptData = ent.extractReceiptData(receipt);
      if (!receiptData) {
        console.error(`[IAP] bad receipt format user=${userId}: ${String(receipt).slice(0, 200)}`);
        return res.json({ active: false, error: 'bad_receipt_format' });
      }

      const result = await ent.verifyAppleReceipt(receiptData);
      ent.logEvent(userId, 'apple', result.raw, 'validate');

      if (result.transient) {
        console.error(`[IAP] Apple temporarily unavailable user=${userId} (${result.reason})`);
        return res.status(503).json({ active: false, error: result.reason });
      }
      if (!result.valid) {
        console.error(`[IAP] Apple NOT granted user=${userId} reason=${result.reason} ${result.label || ''}`);
        return res.json({ active: false, error: result.reason });
      }

      const e = await ent.upsertEntitlement({
        userId,
        source: 'apple',
        productId: result.productId,
        originalTransactionId: result.originalTransactionId,
        expiresAt: result.expiresAt,
        environment: result.environment,
      }, { protectManual: true });
      console.log(`[IAP] GRANTED apple user=${userId} product=${result.productId} expiresAt=${result.expiresAt.toISOString()} env=${result.environment}`);
      alerts.emitAlert({
        kind: 'purchase', userId, source: 'apple', productId: result.productId,
        environment: result.environment, expiresAt: result.expiresAt,
        dedupKey: `purchase|apple|${result.originalTransactionId}|${result.expiresAt.toISOString()}`,
      });
      return res.json(ent.statusResponse(e));
    }

    // ── Google ──
    if (bodyPlatform === 'google') {
      const { productId } = req.body;
      if (!productId) {
        return res.json({ active: false, error: 'productId_required' });
      }
      const result = await ent.verifyGooglePurchase(receipt, productId);
      ent.logEvent(userId, 'google', result.raw, 'validate');

      if (result.notConfigured) {
        console.error('[IAP] Google not configured');
        return res.status(503).json({ active: false, error: 'google_not_configured' });
      }
      if (!result.valid) {
        console.error(`[IAP] Google NOT granted user=${userId} reason=${result.reason}`);
        return res.json({ active: false, error: result.reason });
      }

      const e = await ent.upsertEntitlement({
        userId,
        source: 'google',
        productId: result.productId,
        purchaseToken: receipt,
        expiresAt: result.expiresAt,
        autoRenew: result.autoRenew,
        environment: result.environment,
      }, { protectManual: true });
      console.log(`[IAP] GRANTED google user=${userId} product=${result.productId} expiresAt=${result.expiresAt.toISOString()}`);
      alerts.emitAlert({
        kind: 'purchase', userId, source: 'google', productId: result.productId,
        expiresAt: result.expiresAt,
        dedupKey: `purchase|google|${receipt}|${result.expiresAt.toISOString()}`,
      });
      return res.json(ent.statusResponse(e));
    }

    return res.json({ active: false, error: 'unsupported_platform' });
  } catch (e) {
    console.error(`[IAP] validate error user=${userId}: ${e.message}`);
    return res.status(500).json({ active: false, error: 'internal_error' });
  }
});

// GET /api/subscription/status — client calls on every launch.
router.get('/status', auth, async (req, res) => {
  const userId = req.userId;
  try {
    let e = await ent.getEntitlement(userId);

    // Lazy re-validation for Google (we store the purchase_token). Apple relies
    // on S2S notifications since verifyReceipt needs the original receipt.
    if (e && e.source === 'google' && e.purchase_token && !ent.isActive(e)) {
      try {
        const r = await ent.verifyGooglePurchase(e.purchase_token, e.product_id);
        if (r.valid) {
          e = await ent.upsertEntitlement({
            userId, source: 'google', productId: r.productId,
            purchaseToken: e.purchase_token, expiresAt: r.expiresAt,
            autoRenew: r.autoRenew, environment: r.environment,
          }, { protectManual: true });
        }
      } catch (reErr) {
        console.error(`[IAP] lazy google revalidate failed user=${userId}: ${reErr.message}`);
      }
    }

    const resp = ent.statusResponse(e);
    console.log(`[IAP] status user=${userId} active=${resp.active} source=${resp.source} expiresAt=${resp.expiresAt}`);
    return res.json(resp);
  } catch (e) {
    console.error(`[IAP] status error user=${userId}: ${e.message}`);
    return res.json({ active: false, expiresAt: null, source: null, productId: null });
  }
});

// POST /api/subscription/sync — full client-state snapshot for monitoring (§9b).
// JWT optional; userId comes from the token when present, else from the body.
router.post('/sync', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const userId = req.userId || b.userId || null;
    await ent.saveSnapshot({
      userId,
      platform: b.platform,
      appVersion: b.appVersion,
      context: b.context,
      cachedPremium: b.cachedPremium,
      products: b.products,
      clientTs: b.ts,
    });
    console.log(`[IAP] sync user=${userId} context=${b.context} cachedPremium=${b.cachedPremium}`);
  } catch (e) {
    console.error(`[IAP] sync error: ${e.message}`);
  }
  // Fire-and-forget from the client's perspective — always 200.
  return res.json({});
});

module.exports = router;
