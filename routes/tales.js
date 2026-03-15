const express = require('express');
const fs = require('fs');
const path = require('path');

const auth = require('../middleware/auth');
const { sendAsWebP } = require('../middleware/webpConverter');
const { textToSpeech } = require('../services/elevenlabs');
const talesService = require('../services/talesService');
const usersService = require('../services/usersService');
const narrationService = require('../services/narrationService');

const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const DATA_DIR = path.join(__dirname, '..', 'data');

// Validate that an ID param is a safe filename (no path traversal)
function isSafeId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// Helper: find file with any extension from list
function findAsset(basePath, extensions = ['.webp', '.jpg', '.png']) {
  for (const ext of extensions) {
    const filePath = basePath + ext;
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

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

// GET /api/tales/:id?lang=ru
// Returns a single tale with pages array and totalPages.
router.get('/:id', auth, async (req, res) => {
  try {
    const lang = req.query.lang;
    const tale = await talesService.getTaleById(req.params.id, lang);

    if (!tale) {
      return res.status(404).json({ error: 'Tale not found' });
    }

    res.json(tale);
  } catch (err) {
    console.error('Tale load error:', err.message);
    res.status(500).json({ error: 'Failed to load tale' });
  }
});

// POST /api/tales/:id/narrate?page=0&lang=ru
// Generate narrated audio for a single page of a tale.
router.post('/:id/narrate', auth, async (req, res) => {
  try {
    const tale = await talesService.getTaleById(req.params.id, req.query.lang);
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

// POST /api/tales/:id/personalize?lang=ru
// Personalize tale text with child's name and gender.
router.post('/:id/personalize', auth, async (req, res) => {
  try {
    const tale = await talesService.getTaleById(req.params.id, req.query.lang);
    if (!tale) {
      return res.status(404).json({ error: 'Tale not found' });
    }

    const { name, gender } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const pages = tale.pages.map((text) => {
      let result = text;
      // Replace placeholder patterns for child name
      result = result.replace(/\{childName\}/g, name);
      result = result.replace(/\{ChildName\}/g, name);
      // Replace gender-conditional patterns: {m:мальчик|f:девочка}
      result = result.replace(/\{m:([^|]+)\|f:([^}]+)\}/g, (_, m, f) => {
        return gender === 'female' ? f : m;
      });
      return result;
    });

    res.json({ pages });
  } catch (err) {
    console.error('Personalize error:', err.message);
    res.status(500).json({ error: 'Failed to personalize tale' });
  }
});

// POST /api/tales/:id/narrate-all?lang=ru
// Start async full book narration with cloned voice.
// Requires name and gender in body for personalization before TTS.
router.post('/:id/narrate-all', auth, async (req, res) => {
  try {
    const tale = await talesService.getTaleById(req.params.id, req.query.lang);
    if (!tale) {
      return res.status(404).json({ error: 'Tale not found' });
    }

    const { name, gender } = req.body;
    if (!name || !gender) {
      return res.status(400).json({ error: 'name and gender are required' });
    }

    const user = await usersService.getUser(req.userId);
    if (!user || !user.voice_id) {
      return res.status(400).json({ error: 'No cloned voice. Clone your voice first via POST /api/voice/clone' });
    }

    const job = await narrationService.createJob(req.userId, tale.id, tale.totalPages);

    // Run narration in background
    const jobId = job.job_id;
    const voiceId = user.voice_id;
    const taleId = tale.id;

    // Personalize pages before narration
    const personalizedPages = tale.pages.map((text) => {
      let result = text;
      result = result.replace(/\{childName\}/g, name);
      result = result.replace(/\{ChildName\}/g, name);
      result = result.replace(/\{m:([^|]+)\|f:([^}]+)\}/g, (_, m, f) => {
        return gender === 'female' ? f : m;
      });
      return result;
    });

    (async () => {
      const jobDir = path.join(STORAGE_DIR, req.userId, taleId);
      fs.mkdirSync(jobDir, { recursive: true });

      for (let i = 0; i < tale.totalPages; i++) {
        try {
          const audioBuffer = await textToSpeech(voiceId, personalizedPages[i]);
          fs.writeFileSync(path.join(jobDir, `${i}.mp3`), audioBuffer);
          await narrationService.updateJobProgress(jobId, i + 1);
        } catch (err) {
          console.error(`Narrate-all page ${i} error:`, err.message);
          await narrationService.failJob(jobId);
          return;
        }
      }
      await narrationService.completeJob(jobId);
    })();

    res.json({ jobId, status: 'processing' });
  } catch (err) {
    console.error('Narrate-all error:', err.message);
    res.status(500).json({ error: 'Failed to start narration' });
  }
});

// GET /api/tales/:id/narration-status
// Poll for narration progress.
router.get('/:id/narration-status', auth, async (req, res) => {
  try {
    const job = await narrationService.getJob(req.userId, req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'No narration job found for this tale' });
    }
    res.json({
      status: job.status,
      pagesReady: job.pages_ready,
      totalPages: job.total_pages,
    });
  } catch (err) {
    console.error('Narration status error:', err.message);
    res.status(500).json({ error: 'Failed to get narration status' });
  }
});

// GET /api/tales/:id/narration/:page
// Download narrated page audio.
router.get('/:id/narration/:page', auth, async (req, res) => {
  try {
    const page = parseInt(req.params.page, 10);
    if (isNaN(page) || page < 0) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    const filePath = path.join(STORAGE_DIR, req.userId, req.params.id, `${page}.mp3`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Narrated page not found. Check narration-status first.' });
    }

    const audioBuffer = fs.readFileSync(filePath);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': `attachment; filename="${req.params.id}-${page}.mp3"`,
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error('Narration download error:', err.message);
    res.status(500).json({ error: 'Failed to download narrated page' });
  }
});

// GET /api/tales/:id/cover
// Returns tale cover image.
router.get('/:id/cover', auth, (req, res) => {
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tale id' });
  }
  const filePath = findAsset(path.join(DATA_DIR, 'covers', req.params.id));
  if (!filePath) {
    return res.status(404).json({ error: `Cover not found for tale: ${req.params.id}` });
  }
  sendAsWebP(res, filePath);
});

// GET /api/tales/:id/illustration/:page
// Returns illustration image for a specific page.
router.get('/:id/illustration/:page', auth, (req, res) => {
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tale id' });
  }
  const page = parseInt(req.params.page);
  if (isNaN(page) || page < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }
  const filePath = findAsset(path.join(DATA_DIR, 'illustrations', req.params.id, `page_${page}`));
  if (!filePath) {
    return res.status(404).json({ error: `Illustration not found: ${req.params.id} page ${page}` });
  }
  sendAsWebP(res, filePath);
});

// Helper: resolve language from query param or user profile
async function resolveLang(req) {
  if (req.query.lang) return req.query.lang;
  const user = await usersService.getUser(req.userId);
  return user?.lang || 'ru';
}

// GET /api/tales/:id/default-narration/:page?lang=ru
// Returns default narrator MP3 for a specific page.
router.get('/:id/default-narration/:page', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tale id' });
  }
  const page = parseInt(req.params.page);
  if (isNaN(page) || page < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }
  const lang = await resolveLang(req);
  const filePath = path.join(DATA_DIR, 'narration', 'default', req.params.id, lang, `page_${page}.mp3`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Default narration not found: ${req.params.id}/${lang} page ${page}` });
  }
  res.set('Content-Disposition', `attachment; filename="${req.params.id}-${lang}-${page}.mp3"`);
  res.sendFile(path.resolve(filePath));
});

// GET /api/tales/:id/default-narration?lang=ru
// Check availability of default narration, returns list of available pages.
router.get('/:id/default-narration', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tale id' });
  }
  const lang = await resolveLang(req);
  const dir = path.join(DATA_DIR, 'narration', 'default', req.params.id, lang);
  if (!fs.existsSync(dir)) {
    return res.json({ available: false, lang, pages: [] });
  }
  const files = fs.readdirSync(dir).filter(f => f.match(/^page_\d+\.mp3$/));
  const pages = files.map(f => parseInt(f.match(/page_(\d+)/)[1])).sort((a, b) => a - b);
  res.json({ available: pages.length > 0, lang, pages });
});

module.exports = router;
