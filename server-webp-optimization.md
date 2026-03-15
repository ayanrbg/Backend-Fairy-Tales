# Оптимизация изображений — WebP конвертация на сервере

## Проблема

Иллюстрации хранятся как JPEG ~2.6MB каждая. На 94 страницы = **244MB на одну сказку**.
Для мобильного приложения это недопустимо.

## Решение

Конвертировать в **WebP quality 85** на лету при раздаче. Результат:
- 2.6MB → **534KB** (в 5 раз меньше)
- 94 страницы: 244MB → **49MB**
- Визуальное качество **идентично** оригиналу
- Разрешение **сохраняется** (2752×1536)
- Unity `Texture2D.LoadImage()` поддерживает WebP

## Реализация

### 1. Установить sharp

```bash
npm install sharp
```

### 2. Middleware для конвертации изображений

Создать `middleware/webpConverter.js`:

```js
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
```

### 3. Обновить эндпоинты

В файле с роутами (например `routes/tales.js`):

```js
const { sendAsWebP } = require('../middleware/webpConverter');

// 19. GET /api/tales/:id/cover
router.get('/api/tales/:id/cover', auth, (req, res) => {
  const filePath = findAsset(path.join(DATA_DIR, 'covers', req.params.id));
  if (!filePath) return res.status(404).json({ error: `Cover not found for tale: ${req.params.id}` });

  // Было: res.sendFile(path.resolve(filePath));
  // Стало:
  sendAsWebP(res, filePath);
});

// 20. GET /api/tales/:id/illustration/:page
router.get('/api/tales/:id/illustration/:page', auth, (req, res) => {
  const page = parseInt(req.params.page);
  if (isNaN(page) || page < 0) return res.status(400).json({ error: 'Invalid page number' });

  const filePath = findAsset(path.join(DATA_DIR, 'illustrations', req.params.id, `page_${page}`));
  if (!filePath) return res.status(404).json({ error: `Illustration not found: ${req.params.id} page ${page}` });

  // Было: res.sendFile(path.resolve(filePath));
  // Стало:
  sendAsWebP(res, filePath);
});
```

Эндпоинты озвучки (audio) — **не трогать**, они отдают mp3.

### 4. Альтернатива: предварительная конвертация

Если не хочешь конвертировать на лету, можно сконвертировать все файлы заранее:

```bash
# Установить sharp-cli
npm install -g sharp-cli

# Или скриптом:
node -e "
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const DATA_DIR = './data';
const dirs = ['covers', 'illustrations'];

async function convertDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      await convertDir(full);
      continue;
    }

    if (!/\.(jpg|jpeg|png)$/i.test(file)) continue;

    const outPath = full.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    if (fs.existsSync(outPath)) continue; // already converted

    try {
      await sharp(full).webp({ quality: 85 }).toFile(outPath);
      const origSize = (stat.size / 1024).toFixed(0);
      const newSize = (fs.statSync(outPath).size / 1024).toFixed(0);
      console.log(file + ': ' + origSize + 'KB -> ' + newSize + 'KB');
    } catch (e) {
      console.error('Failed: ' + full, e.message);
    }
  }
}

convertDir(path.join(DATA_DIR, 'covers'));
convertDir(path.join(DATA_DIR, 'illustrations'));
"
```

После этого обновить `findAsset` чтобы приоритетно искал `.webp`:

```js
function findAsset(basePath, extensions = ['.webp', '.jpg', '.png']) {
  for (const ext of extensions) {
    const filePath = basePath + ext;
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}
```

## Результат

| | До | После |
|---|---|---|
| Формат | JPEG | WebP |
| Размер 1 страницы | ~2.6MB | ~534KB |
| 94 страницы | ~244MB | ~49MB |
| Разрешение | 2752×1536 | 2752×1536 (без изменений) |
| Визуальное качество | — | идентичное |
| Обложка | ~200KB | ~50KB |

## На клиенте

Ничего менять не надо. `Texture2D.LoadImage()` в Unity поддерживает WebP.
`AssetCache.LoadSprite()` работает с любым форматом — он передаёт bytes в `LoadImage()`.
