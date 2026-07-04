const express = require('express');
const fs = require('fs');
const path = require('path');
const ent = require('../services/entitlements');
const alerts = require('../services/alerts');

const router = express.Router();

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID;
const APP_APPLE_ID = process.env.APPLE_APP_APPLE_ID ? Number(process.env.APPLE_APP_APPLE_ID) : undefined;
const CERTS_DIR = process.env.APPLE_ROOT_CERTS_DIR || path.join(__dirname, '..', 'certs', 'apple');

// notificationType -> how it affects the entitlement.
// premium=true keeps/extends access (expiresDate governs actual activity),
// premium=false revokes immediately.
const REVOKE = new Set(['REFUND', 'REVOKE']);
const EXPIRE = new Set(['EXPIRED', 'GRACE_PERIOD_EXPIRED']);

let verifiersCache = null; // { verifiers: [...], error: string|null }

function buildVerifiers() {
  if (verifiersCache) return verifiersCache;
  try {
    if (!BUNDLE_ID) throw new Error('APPLE_BUNDLE_ID not set');
    // Optional dependency — only required once S2S is configured.
    const { SignedDataVerifier, Environment } = require('@apple/app-store-server-library');

    if (!fs.existsSync(CERTS_DIR)) throw new Error(`Apple root certs dir missing: ${CERTS_DIR}`);
    const roots = fs.readdirSync(CERTS_DIR)
      .filter((f) => /\.(cer|der|pem|crt)$/i.test(f))
      .map((f) => fs.readFileSync(path.join(CERTS_DIR, f)));
    if (roots.length === 0) throw new Error('no Apple root certs found');

    // Notifications may arrive for either environment; try both.
    const verifiers = [Environment.PRODUCTION, Environment.SANDBOX].map(
      (env) => new SignedDataVerifier(roots, true, env, BUNDLE_ID, APP_APPLE_ID)
    );
    verifiersCache = { verifiers, error: null };
  } catch (e) {
    verifiersCache = { verifiers: null, error: e.message };
  }
  return verifiersCache;
}

async function verifyNotification(verifiers, signedPayload) {
  let lastErr;
  for (const v of verifiers) {
    try {
      return await v.verifyAndDecodeNotification(signedPayload);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function verifyTransaction(verifiers, signedTransaction) {
  let lastErr;
  for (const v of verifiers) {
    try {
      return await v.verifyAndDecodeTransaction(signedTransaction);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// POST /api/apple/notifications — App Store Server Notifications v2.
router.post('/notifications', async (req, res) => {
  const { signedPayload } = req.body || {};
  if (!signedPayload) {
    return res.status(400).json({ error: 'signedPayload required' });
  }

  const { verifiers, error } = buildVerifiers();
  if (!verifiers) {
    console.error(`[IAP] S2S not configured: ${error}`);
    return res.status(503).json({ error: 'notifications_not_configured' });
  }

  let payload;
  try {
    payload = await verifyNotification(verifiers, signedPayload);
  } catch (e) {
    console.error(`[IAP] S2S signature verification FAILED: ${e.message}`);
    return res.status(401).json({ error: 'invalid_signature' });
  }

  try {
    const notificationType = payload.notificationType;
    const subtype = payload.subtype;
    const data = payload.data || {};
    ent.logEvent(null, 'apple', { notificationType, subtype, environment: data.environment }, 's2s');

    if (!data.signedTransactionInfo) {
      console.log(`[IAP] S2S ${notificationType}/${subtype || ''} — no transaction info, ignored`);
      return res.status(200).json({ ok: true });
    }

    const tx = await verifyTransaction(verifiers, data.signedTransactionInfo);
    const originalTransactionId = tx.originalTransactionId;
    const productId = tx.productId;
    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate) : null;
    const environment = (data.environment || '').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';

    let premium;
    if (REVOKE.has(notificationType)) premium = false;
    else if (EXPIRE.has(notificationType)) premium = false;
    else premium = !expiresAt || expiresAt.getTime() > Date.now();

    const userId = await ent.applyAppleNotification({
      originalTransactionId, premium, expiresAt, productId, environment,
    });

    // Richer audit row now that the transaction is decoded.
    ent.logEvent(userId, 'apple', {
      notificationType, subtype, originalTransactionId, productId,
      premium, expiresAt, environment, matched: !!userId,
    }, 's2s');

    if (userId) {
      console.log(`[IAP] S2S ${notificationType}/${subtype || ''} applied user=${userId} tx=${originalTransactionId} product=${productId} premium=${premium} expiresAt=${expiresAt ? expiresAt.toISOString() : 'null'} env=${environment}`);
      // On-site admin alert for meaningful transitions.
      let alertKind = null;
      if (REVOKE.has(notificationType)) alertKind = 'refund';
      else if (EXPIRE.has(notificationType)) alertKind = 'expire';
      else if (notificationType === 'DID_RENEW') alertKind = 'renewal';
      if (alertKind) {
        alerts.emitAlert({
          kind: alertKind, userId, source: 'apple', productId, environment, expiresAt,
          dedupKey: `${alertKind}|apple|${originalTransactionId}|${notificationType}|${expiresAt ? expiresAt.toISOString() : ''}`,
        });
      }
    } else {
      console.log(`[IAP] S2S ${notificationType}/${subtype || ''} tx=${originalTransactionId} product=${productId} — no matching entitlement, ignored`);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(`[IAP] S2S processing error: ${e.message}`);
    // 500 so Apple retries later.
    return res.status(500).json({ error: 'processing_error' });
  }
});

module.exports = router;
