const express = require('express');

const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const { cloneVoice, deleteVoice: deleteElevenLabsVoice } = require('../services/elevenlabs');
const usersService = require('../services/usersService');

const router = express.Router();

// POST /api/voice/clone
// Upload a voice sample and clone the voice via ElevenLabs.
// If the user already has a cloned voice, the old one is deleted first.
router.post('/clone', auth, upload.single('voiceSample'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'voiceSample file is required' });
    }

    const user = await usersService.getUser(req.userId);

    // Delete old cloned voice if exists
    if (user && user.voice_id) {
      try {
        await deleteElevenLabsVoice(user.voice_id);
      } catch (e) {
        console.warn('Failed to delete old voice:', e.message);
      }
    }

    const voiceId = await cloneVoice(req.file.buffer, req.file.originalname, req.userId);
    await usersService.saveVoice(req.userId, voiceId);

    res.json({ voiceId, status: 'cloned' });
  } catch (err) {
    console.error('Voice clone error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: 'Failed to clone voice',
      details: err.response?.data || err.message,
    });
  }
});

// DELETE /api/voice
// Delete the user's cloned voice.
router.delete('/', auth, async (req, res) => {
  try {
    const user = await usersService.getUser(req.userId);

    if (!user || !user.voice_id) {
      return res.status(404).json({ error: 'No cloned voice found' });
    }

    await deleteElevenLabsVoice(user.voice_id);
    await usersService.deleteVoice(req.userId);

    res.json({ status: 'deleted' });
  } catch (err) {
    console.error('Voice delete error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Failed to delete voice' });
  }
});

module.exports = router;
