const express = require('express');

const auth = require('../middleware/auth');
const { textToSpeech } = require('../services/elevenlabs');
const talesService = require('../services/talesService');
const usersService = require('../services/usersService');

const router = express.Router();

// GET /api/tales?lang=ru
// Returns list of available tales.
router.get('/', auth, async (req, res) => {
  try {
    const tales = await talesService.getTalesList(req.query.lang);
    res.json(tales);
  } catch (err) {
    console.error('Tales list error:', err.message);
    res.status(500).json({ error: 'Failed to load tales' });
  }
});

// GET /api/tales/:id
// Returns a single tale with pages array and totalPages.
router.get('/:id', auth, async (req, res) => {
  try {
    const tale = await talesService.getTaleById(req.params.id);

    if (!tale) {
      return res.status(404).json({ error: 'Tale not found' });
    }

    res.json(tale);
  } catch (err) {
    console.error('Tale load error:', err.message);
    res.status(500).json({ error: 'Failed to load tale' });
  }
});

// POST /api/tales/:id/narrate?page=0
// Generate narrated audio for a single page of a tale.
router.post('/:id/narrate', auth, async (req, res) => {
  try {
    const tale = await talesService.getTaleById(req.params.id);
    if (!tale) {
      return res.status(404).json({ error: 'Tale not found' });
    }

    const page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 0 || page >= tale.totalPages) {
      return res.status(400).json({
        error: `page parameter is required (0..${tale.totalPages - 1})`,
      });
    }

    const user = await usersService.getUser(req.userId);
    if (!user || !user.voice_id) {
      return res.status(400).json({ error: 'No cloned voice. Clone your voice first via POST /api/voice/clone' });
    }

    const audioBuffer = await textToSpeech(user.voice_id, tale.pages[page]);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': `attachment; filename="${tale.id}-${page}.mp3"`,
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error('Narrate error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: 'Failed to narrate tale',
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
