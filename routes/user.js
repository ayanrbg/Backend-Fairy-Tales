const express = require('express');

const auth = require('../middleware/auth');
const usersService = require('../services/usersService');

const router = express.Router();

// GET /api/user/profile
router.get('/profile', auth, async (req, res) => {
  try {
    const profile = await usersService.getProfile(req.userId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found. Register first.' });
    }
    res.json(profile);
  } catch (err) {
    console.error('Get profile error:', err.message);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /api/user/profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, gender, lang } = req.body;
    const profile = await usersService.updateProfile(req.userId, { name, gender, lang });
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found. Register first.' });
    }
    res.json({ profile });
  } catch (err) {
    console.error('Update profile error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
