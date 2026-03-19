const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const JPEG_QUALITY = 85;
const CACHE_DIR = path.join(__dirname, '..', 'data', '.jpeg-cache');

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function sendAsWebP(res, originalPath) {
  const absPath = path.resolve(originalPath);
  const cacheKey = absPath
    .replace(/[\/\\:]/g, '_')
    .replace(/\.(jpg|jpeg|png|webp)$/i, '.jpg');
  const cachePath = path.join(CACHE_DIR, cacheKey);
  const fileName = path.basename(absPath).replace(/\.(jpg|jpeg|png|webp)$/i, '.jpg');

  try {
    let webpBuffer;

    if (fs.existsSync(cachePath)) {
      webpBuffer = fs.readFileSync(cachePath);
    } else {
      webpBuffer = await sharp(absPath).jpeg({ quality: JPEG_QUALITY }).toBuffer();
      fs.writeFileSync(cachePath, webpBuffer);
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Disposition', `inline; filename="${fileName}"`);
    res.set('Content-Length', webpBuffer.length);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(webpBuffer);
  } catch (err) {
    console.error(`[JPEG] Conversion failed: ${absPath}`, err.message);
    res.sendFile(absPath);
  }
}

module.exports = { sendAsWebP };
