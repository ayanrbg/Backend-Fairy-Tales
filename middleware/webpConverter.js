const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const WEBP_QUALITY = 85;
const CACHE_DIR = path.join(__dirname, '..', 'data', '.webp-cache');

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function sendAsWebP(res, originalPath) {
  const absPath = path.resolve(originalPath);
  const cacheKey = absPath
    .replace(/[\/\\:]/g, '_')
    .replace(/\.(jpg|jpeg|png|webp)$/i, '.webp');
  const cachePath = path.join(CACHE_DIR, cacheKey);
  const fileName = path.basename(absPath).replace(/\.(jpg|jpeg|png|webp)$/i, '.webp');

  try {
    let webpBuffer;

    if (fs.existsSync(cachePath)) {
      webpBuffer = fs.readFileSync(cachePath);
    } else {
      webpBuffer = await sharp(absPath).webp({ quality: WEBP_QUALITY }).toBuffer();
      fs.writeFileSync(cachePath, webpBuffer);
    }

    res.set('Content-Type', 'image/webp');
    res.set('Content-Disposition', `inline; filename="${fileName}"`);
    res.set('Content-Length', webpBuffer.length);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(webpBuffer);
  } catch (err) {
    console.error(`[WebP] Conversion failed: ${absPath}`, err.message);
    res.sendFile(absPath);
  }
}

module.exports = { sendAsWebP };
