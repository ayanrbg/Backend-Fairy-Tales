const API_KEY = process.env.API_KEY;

function apiKeyMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];

  if (!API_KEY) {
    return res.status(503).json({ error: 'API key not configured' });
  }

  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
}

module.exports = apiKeyMiddleware;
