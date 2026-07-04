const multer = require('multer');

// Separate from the audio uploader (upload.js). Accepts images only; kept in
// memory so the route can normalize/convert with sharp before writing to disk.
const MAX_SIZE = (parseInt(process.env.MAX_IMAGE_MB, 10) || 15) * 1024 * 1024;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported image format: ${file.mimetype}`));
  },
});

module.exports = imageUpload;
