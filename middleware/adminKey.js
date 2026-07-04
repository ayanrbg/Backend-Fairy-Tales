// Admin authorization — separate from the user JWT. Guards /api/admin/* routes.
// Set ADMIN_KEY in the environment; clients send it as `X-Admin-Key`.
const ADMIN_KEY = process.env.ADMIN_KEY;

function adminKeyMiddleware(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ error: 'Admin key not configured' });
  }
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  next();
}

module.exports = adminKeyMiddleware;
