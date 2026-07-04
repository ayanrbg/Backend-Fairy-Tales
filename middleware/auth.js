const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token not provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Like authMiddleware but never rejects: sets req.userId when a valid token is
// present, otherwise continues anonymously. For fire-and-forget endpoints
// (sync, debug logs) that may run before login.
function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.userId = jwt.verify(authHeader.split(' ')[1], JWT_SECRET).userId;
    } catch (_) { /* ignore invalid token, stay anonymous */ }
  }
  next();
}

module.exports = authMiddleware;
module.exports.optional = optionalAuthMiddleware;
