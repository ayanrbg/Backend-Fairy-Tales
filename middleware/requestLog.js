const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Body keys whose values must never hit the logs (receipts, tokens, secrets).
const SECRET_KEYS = new Set([
  'receipt', 'receiptData', 'receipt-data', 'password', 'purchaseToken',
  'token', 'signedPayload', 'code', 'adminKey', 'jwt', 'authorization',
]);

// Routes we want full-body visibility on (the IAP / admin surface).
const VERBOSE_PREFIXES = ['/api/subscription', '/api/promo', '/api/apple', '/api/admin', '/api/debug'];
// High-frequency asset reads — only logged when they error, to keep signal high.
const ASSET_RE = /\/(illustration|cover|narration)(\/|$)/;

// Replace secret values with a length marker, and truncate long strings, so the
// log shows shape without leaking anything or exploding in size.
function redact(value, key, depth = 0) {
  if (key && SECRET_KEYS.has(key)) {
    const len = value == null ? 0 : String(value).length;
    return `<redacted len=${len}>`;
  }
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 200) return `${value.slice(0, 200)}…(${value.length})`;
    return value;
  }
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, null, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redact(v, k, depth + 1);
  return out;
}

function userIdFromAuth(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try { return jwt.verify(h.split(' ')[1], JWT_SECRET).userId; } catch (_) { return 'bad-token'; }
  }
  return null;
}

// Global request logger. Logs method/path/user/status/duration; adds a redacted
// body for the IAP/admin surface. Skips 2xx asset reads to avoid noise. Set
// DEBUG_HTTP=0 to log only errors (>=400).
function requestLog(req, res, next) {
  const quiet = process.env.DEBUG_HTTP === '0';
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const isAsset = ASSET_RE.test(req.path);
    const isError = res.statusCode >= 400;
    if (isAsset && !isError) return;                 // skip successful image/audio fetches
    if (quiet && !isError) return;                   // quiet mode: errors only

    const user = userIdFromAuth(req);
    const verbose = VERBOSE_PREFIXES.some((p) => req.path.startsWith(p));
    let bodyStr = '';
    if (verbose && req.body && Object.keys(req.body).length) {
      try { bodyStr = ` body=${JSON.stringify(redact(req.body))}`; } catch (_) { bodyStr = ' body=<unserializable>'; }
    }
    const tag = isError ? 'HTTP!' : 'HTTP';
    console.log(`[${tag}] ${req.method} ${req.originalUrl} user=${user || '-'} -> ${res.statusCode} ${ms}ms${bodyStr}`);
  });
  next();
}

module.exports = requestLog;
module.exports.redact = redact;
