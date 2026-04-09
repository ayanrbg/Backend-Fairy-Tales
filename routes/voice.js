const express = require('express');

const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const { cloneVoice, deleteVoice } = require('../services/fishAudio');
const usersService = require('../services/usersService');

const router = express.Router();

// POST /api/voice/clone
// Upload a voice sample and clone the voice via Fish Audio.
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
        await deleteVoice(user.voice_id);
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

    await deleteVoice(user.voice_id);
    await usersService.deleteVoice(req.userId);

    res.json({ status: 'deleted' });
  } catch (err) {
    console.error('Voice delete error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Failed to delete voice' });
  }
});

// === Drafts ===
const draftsService = require('../services/draftsService');

// GET /api/voice/drafts
router.get('/drafts', auth, async (req, res) => {
  try {
    const drafts = await draftsService.listDrafts(req.userId);
    res.json(drafts);
  } catch (err) {
    console.error('List drafts error:', err.message);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
});

// POST /api/voice/drafts
router.post('/drafts', auth, async (req, res) => {
  try {
    const { narratorName, taleId } = req.body;
    if (!narratorName || !taleId) {
      return res.status(400).json({ error: 'narratorName and taleId are required' });
    }
    const draft = await draftsService.createDraft(req.userId, narratorName, taleId);
    res.json({ draft });
  } catch (err) {
    console.error('Create draft error:', err.message);
    res.status(500).json({ error: 'Failed to create draft' });
  }
});

// GET /api/voice/drafts/:id
router.get('/drafts/:id', auth, async (req, res) => {
  try {
    const draft = await draftsService.getDraft(req.userId, req.params.id);
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json(draft);
  } catch (err) {
    console.error('Get draft error:', err.message);
    res.status(500).json({ error: 'Failed to get draft' });
  }
});

// PUT /api/voice/drafts/:id
router.put('/drafts/:id', auth, async (req, res) => {
  try {
    const { voiceId } = req.body;
    if (!voiceId) {
      return res.status(400).json({ error: 'voiceId is required' });
    }
    const draft = await draftsService.updateDraft(req.userId, req.params.id, { voiceId });
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json(draft);
  } catch (err) {
    console.error('Update draft error:', err.message);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

// DELETE /api/voice/drafts/:id
router.delete('/drafts/:id', auth, async (req, res) => {
  try {
    const deleted = await draftsService.deleteDraft(req.userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json({ status: 'deleted' });
  } catch (err) {
    console.error('Delete draft error:', err.message);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

module.exports = router;
