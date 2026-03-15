const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const WEBP_QUALITY = 85;
const CACHE_DIR = path.join(__dirname, '..', 'data', '.webp-cache');

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

/**
 * Middleware: converts any image response to WebP before sending.
 * Caches the result so conversion happens only once per file.
 *
 * Usage: wrap sendFile calls for illustration and cover endpoints.
 */
async function sendAsWebP(res, originalPath) {
  // Build cache path: flatten original path into a single filename
  const cacheKey = originalPath
    .replace(/[\/\\:]/g, '_')
    .replace(/\.(jpg|jpeg|png|webp)$/i, '.webp');
  const cachePath = path.join(CACHE_DIR, cacheKey);

  // Serve from cache if exists
  if (fs.existsSync(cachePath)) {
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(path.resolve(cachePath));
  }

  // Convert and cache
  try {
    await sharp(originalPath)
      .webp({ quality: WEBP_QUALITY })
      .toFile(cachePath);

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.resolve(cachePath));
  } catch (err) {
    console.error(`[WebP] Conversion failed: ${originalPath}`, err.message);
    // Fallback: send original file as-is
    res.sendFile(path.resolve(originalPath));
  }
}

module.exports = { sendAsWebP };
