const path = require('path');

async function sendAsWebP(res, originalPath) {
  const absPath = path.resolve(originalPath);
  const fileName = path.basename(absPath).replace(/\.(jpg|jpeg|png|webp)$/i, '.jpg');

  res.set('Content-Type', 'image/jpeg');
  res.set('Content-Disposition', `inline; filename="${fileName}"`);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(absPath);
}

module.exports = { sendAsWebP };
