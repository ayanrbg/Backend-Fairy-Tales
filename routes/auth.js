const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// POST /api/auth/login
// Body: { userId: "unique_device_or_user_id" }
router.post('/login', (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

  res.json({ token });
});

module.exports = router;
