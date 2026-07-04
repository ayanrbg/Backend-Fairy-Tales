const path = require('path');

const CONTENT_TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// Serve an image with the correct Content-Type for its real extension. Covers
// are PNG (image/png), illustrations are JPEG. (Name kept for callers.)
async function sendAsWebP(res, originalPath) {
  const absPath = path.resolve(originalPath);
  const ext = path.extname(absPath).toLowerCase();
  const fileName = path.basename(absPath);

  res.set('Content-Type', CONTENT_TYPES[ext] || 'image/jpeg');
  res.set('Content-Disposition', `inline; filename="${fileName}"`);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(absPath);
}

module.exports = { sendAsWebP };
