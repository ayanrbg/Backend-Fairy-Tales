const express = require('express');
const jwt = require('jsonwebtoken');
const usersService = require('../services/usersService');

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

// POST /api/auth/register
// Body: { userId, name, gender, lang }
router.post('/register', async (req, res) => {
  try {
    const { userId, name, gender, lang } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const profile = await usersService.registerUser(userId, name, gender, lang);
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, profile });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Failed to register' });
  }
});

module.exports = router;
