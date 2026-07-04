const fs = require('fs');
const path = require('path');
const pool = require('../db');

// Inspect the Apple S2S root certificates directory.
function certsInfo() {
  const dir = process.env.APPLE_ROOT_CERTS_DIR || path.join(__dirname, '..', 'certs', 'apple');
  try {
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => /\.(cer|der|pem|crt)$/i.test(f))
      : [];
    return { dir, count: files.length, files };
  } catch (e) {
    return { dir, count: 0, files: [], error: e.message };
  }
}

async function dbPing() {
  try {
    const r = await pool.query('SELECT now() AS t');
    return { ok: true, time: r.rows[0].t };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// A single object describing every integration's config state — used by both
// the startup banner and GET /api/admin/debug/config.
function configStatus() {
  const g = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let googleFile = false;
  if (g) googleFile = g.trim().startsWith('{') ? 'inline-json' : (fs.existsSync(g) ? 'file-ok' : 'file-missing');
  return {
    apple: {
      sharedSecret: !!process.env.APPLE_SHARED_SECRET,
      bundleId: process.env.APPLE_BUNDLE_ID || null,
      appAppleId: process.env.APPLE_APP_APPLE_ID || null,
      s2sCerts: certsInfo(),
    },
    google: {
      serviceAccount: googleFile,
      packageName: process.env.GOOGLE_PACKAGE_NAME || null,
    },
    adminKey: !!process.env.ADMIN_KEY,
    promo: !!process.env.PROMO_API_KEY,
    debugHttp: process.env.DEBUG_HTTP !== '0',
    node: process.version,
  };
}

// Human-readable config banner on boot — misconfig is obvious immediately.
async function printStartupBanner(port) {
  const c = configStatus();
  const yn = (v) => (v ? 'YES' : 'no ');
  const db = await dbPing();
  const lines = [
    '',
    '════════════════ Fairy backend — config self-check ════════════════',
    `  port           : ${port}  node ${c.node}`,
    `  DB             : ${db.ok ? `OK (${new Date(db.time).toISOString()})` : `FAIL — ${db.error}`}`,
    `  Apple secret   : ${yn(c.apple.sharedSecret)}   bundle=${c.apple.bundleId}  appAppleId=${c.apple.appAppleId || 'MISSING'}`,
    `  Apple S2S certs: ${c.apple.s2sCerts.count} in ${c.apple.s2sCerts.dir}${c.apple.s2sCerts.count ? ` (${c.apple.s2sCerts.files.join(', ')})` : '  ← NONE, S2S disabled'}`,
    `  Google Play    : SA=${c.google.serviceAccount}  package=${c.google.packageName || 'MISSING'}`,
    `  Admin key      : ${yn(c.adminKey)}`,
    `  Promo service  : ${yn(c.promo)}`,
    `  HTTP debug log : ${c.debugHttp ? 'ON (verbose; set DEBUG_HTTP=0 to quiet)' : 'off'}`,
    '═══════════════════════════════════════════════════════════════════',
    '',
  ];
  console.log(lines.join('\n'));
  if (!db.ok) console.error('[BOOT] DATABASE UNREACHABLE — most endpoints will fail until DB is back.');
  if (!c.apple.appAppleId) console.warn('[BOOT] APPLE_APP_APPLE_ID missing — Apple S2S notifications will not verify.');
  if (c.apple.s2sCerts.count === 0) console.warn('[BOOT] No Apple root certs — S2S signature verification disabled.');
}

// Periodic cleanup so verbose tables do not grow unbounded during the debug window.
async function cleanupOldRows() {
  try {
    const d = await pool.query("DELETE FROM debug_logs WHERE received_at < now() - interval '14 days'");
    const s = await pool.query("DELETE FROM subscription_snapshots WHERE received_at < now() - interval '30 days'");
    if (d.rowCount || s.rowCount) {
      console.log(`[CLEANUP] removed ${d.rowCount} debug_logs, ${s.rowCount} snapshots`);
    }
  } catch (e) {
    console.error(`[CLEANUP] failed: ${e.message}`);
  }
}

function startCleanupTimer() {
  cleanupOldRows();
  // Run daily; unref so the timer never keeps the process alive on its own.
  setInterval(cleanupOldRows, 24 * 60 * 60 * 1000).unref();
}

module.exports = { configStatus, dbPing, certsInfo, printStartupBanner, cleanupOldRows, startCleanupTimer };
