# Server Assets API — Спецификация

Сервер должен раздавать все ассеты сказок: обложки, иллюстрации, дефолтную озвучку диктора.
Клиент перейдёт с `Resources.Load()` на загрузку с сервера + локальный кеш.

**Важно:** одна сказка может существовать на нескольких языках с одним `id`.
Язык определяет: текст, озвучку диктора, и (опционально) иллюстрации.

---

## Структура файлов на сервере

```
data/
├── tales/
│   ├── ru/
│   │   ├── kolobok.json          # текст сказки на русском
│   │   └── teremok.json
│   ├── kz/
│   │   ├── kolobok.json          # та же сказка на казахском
│   │   └── teremok.json
│   └── en/
│       └── kolobok.json          # та же сказка на английском
├── covers/
│   ├── kolobok.jpg               # обложка — общая для всех языков
│   ├── teremok.jpg
│   └── ...
├── illustrations/
│   ├── kolobok/                  # иллюстрации — общие для всех языков (по умолчанию)
│   │   ├── page_0.jpg
│   │   ├── page_1.jpg
│   │   ├── page_2.jpg
│   │   └── page_3.jpg
│   └── teremok/
│       ├── page_0.jpg
│       └── ...
└── narration/
    └── default/
        ├── kolobok/
        │   ├── ru/               # озвучка диктора — ПО ЯЗЫКАМ
        │   │   ├── page_0.mp3
        │   │   ├── page_1.mp3
        │   │   ├── page_2.mp3
        │   │   └── page_3.mp3
        │   ├── kz/
        │   │   ├── page_0.mp3
        │   │   └── ...
        │   └── en/
        │       ├── page_0.mp3
        │       └── ...
        └── teremok/
            ├── ru/
            │   ├── page_0.mp3
            │   └── ...
            └── kz/
                └── ...
```

### Принцип

| Ассет | Зависит от языка? | Путь |
|-------|-------------------|------|
| Текст | Да | `data/tales/{lang}/{id}.json` |
| Обложка | Нет (одна картинка на все языки) | `data/covers/{id}.jpg` |
| Иллюстрации | Нет (одни и те же картинки) | `data/illustrations/{id}/page_{N}.jpg` |
| Озвучка диктора | **Да** (разные дикторы/языки) | `data/narration/default/{id}/{lang}/page_{N}.mp3` |

---

## Изменения в существующих эндпоинтах

### 5. Список сказок — `GET /api/tales`

**Было:** каждая языковая версия — отдельный объект с уникальным `id`.

**Стало:** один `id` для всех языков. Фильтр `?lang=` выбирает нужную версию. Добавлены поля `hasDefaultNarration` и `coverUrl`.

```
GET /api/tales?lang=ru
Authorization: Bearer <token>
```

**Ответ (200):**
```json
[
  {
    "id": "kolobok",
    "title": "Колобок",
    "lang": "ru",
    "file": "ru/kolobok.json",
    "hasDefaultNarration": true,
    "coverUrl": "/api/tales/kolobok/cover"
  },
  {
    "id": "teremok",
    "title": "Теремок",
    "lang": "ru",
    "file": "ru/teremok.json",
    "hasDefaultNarration": true,
    "coverUrl": "/api/tales/teremok/cover"
  }
]
```

**Логика `hasDefaultNarration`:**
- Проверить существование директории `data/narration/default/{id}/{lang}/`
- Если в ней есть хотя бы один `page_*.mp3` → `true`

Это избавляет клиент от N+1 запросов для каждой сказки.

### 6. Получить сказку — `GET /api/tales/:id`

**Добавить query-параметр `lang`:**

```
GET /api/tales/kolobok?lang=ru
Authorization: Bearer <token>
```

**Логика:**
1. Если `lang` указан — загрузить `data/tales/{lang}/{id}.json`
2. Если `lang` не указан — взять `lang` из профиля пользователя (fallback: `ru`)

Ответ без изменений (тот же `TaleDetail`).

---

## Новые эндпоинты (4 штуки)

### 19. Обложка сказки

Обложка **не зависит от языка** — одна картинка для всех версий.

```
GET /api/tales/:id/cover
Authorization: Bearer <token>
```

**Ответ (200):**
```
Content-Type: image/jpeg          (или image/png — по расширению файла)
Content-Length: 45231

<бинарные данные изображения>
```

**Логика:**
1. Найти файл `data/covers/{id}.jpg` (или `.png`, `.webp` — проверять по порядку)
2. Вернуть бинарные данные с правильным `Content-Type`
3. Добавить `Cache-Control: public, max-age=86400` (кешировать на сутки)

**Ошибки:**
```json
// 404
{ "error": "Cover not found for tale: kolobok" }
```

---

### 20. Иллюстрация страницы

Иллюстрации **не зависят от языка** — одни и те же картинки.

```
GET /api/tales/:id/illustration/:page
Authorization: Bearer <token>
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `id`     | string | ID сказки |
| `page`   | int    | Индекс страницы (0 .. totalPages-1) |

**Ответ (200):**
```
Content-Type: image/jpeg
Content-Length: 128450

<бинарные данные изображения>
```

**Логика:**
1. Найти файл `data/illustrations/{id}/page_{page}.jpg` (или `.png`, `.webp`)
2. `Cache-Control: public, max-age=86400`

**Ошибки:**
```json
// 404
{ "error": "Illustration not found: kolobok page 5" }

// 400
{ "error": "Invalid page number" }
```

---

### 21. Дефолтная озвучка страницы (диктор)

Озвучка **зависит от языка**. Язык передаётся query-параметром или берётся из профиля.

```
GET /api/tales/:id/default-narration/:page?lang=ru
Authorization: Bearer <token>
```

| Параметр | Тип | Обяз. | Описание |
|----------|-----|-------|----------|
| `id`     | string | да | ID сказки |
| `page`   | int    | да | Индекс страницы (0 .. totalPages-1) |
| `lang`   | string | нет | Язык озвучки (`ru`/`kz`/`en`). По умолчанию — язык из профиля |

**Ответ (200):**
```
Content-Type: audio/mpeg
Content-Disposition: attachment; filename="kolobok-ru-0.mp3"
Content-Length: 234567

<бинарные данные mp3>
```

**Логика:**
1. Определить язык: `req.query.lang` || профиль пользователя || `"ru"`
2. Найти файл `data/narration/default/{id}/{lang}/page_{page}.mp3`
3. Вернуть бинарные данные

**Ошибки:**
```json
// 404
{ "error": "Default narration not found: kolobok/ru page 0" }
```

---

### 22. Проверка наличия дефолтной озвучки

```
GET /api/tales/:id/default-narration?lang=ru
Authorization: Bearer <token>
```

| Параметр | Тип | Обяз. | Описание |
|----------|-----|-------|----------|
| `lang`   | string | нет | Язык. По умолчанию — из профиля |

**Ответ (200):**
```json
{
  "available": true,
  "lang": "ru",
  "pages": [0, 1, 2, 3]
}
```

**Если озвучки нет:**
```json
{
  "available": false,
  "lang": "kz",
  "pages": []
}
```

**Логика:**
1. Определить язык
2. Проверить директорию `data/narration/default/{id}/{lang}/`
3. Собрать список `page_N.mp3` файлов

---

## Добавление новой сказки — чеклист

Для добавления сказки `kolobok` на 3 языка:

### 1. Тексты

Создать 3 файла:
- `data/tales/ru/kolobok.json`
- `data/tales/kz/kolobok.json`
- `data/tales/en/kolobok.json`

```json
{
  "id": "kolobok",
  "title": "Колобок",
  "lang": "ru",
  "pages": [
    "Жили-были старик со старухой. А у них {m:жил внук|f:жила внучка} по имени {childName}...",
    "Старуха наскребла муки...",
    "..."
  ]
}
```
- `id` **одинаковый** во всех языковых версиях
- `title` на языке версии (Колобок / Бауырсақ / Kolobok)
- `lang` соответствует папке
- Количество страниц может отличаться между языками
- Шаблоны: `{childName}`, `{m:текст|f:текст}`

### 2. Обложка (одна на все языки)

`data/covers/kolobok.jpg` — 400×600 px, JPG, качество 80%

### 3. Иллюстрации (общие для всех языков)

```
data/illustrations/kolobok/
├── page_0.jpg    # 1080×1920 px, fullscreen portrait
├── page_1.jpg
├── page_2.jpg
└── page_3.jpg
```

Количество = max(pages) среди всех языковых версий. Если у какого-то языка меньше страниц — лишние иллюстрации просто не покажутся.

### 4. Озвучка диктора (по языкам)

```
data/narration/default/kolobok/
├── ru/
│   ├── page_0.mp3    # MP3, 128 kbps, mono, 44100 Hz
│   ├── page_1.mp3
│   └── ...
├── kz/
│   ├── page_0.mp3
│   └── ...
└── en/
    ├── page_0.mp3
    └── ...
```

- Текст в озвучке — **БЕЗ плейсхолдеров** (нейтральная версия без имени)
- Количество файлов = `pages.length` для данного языка
- Не обязательно озвучивать все языки сразу — `hasDefaultNarration` будет `false` для языков без озвучки

---

## Реализация на Node.js (Express)

```js
const path = require('path');
const fs = require('fs');

// Хелпер: найти файл с любым расширением
function findAsset(basePath, extensions = ['.jpg', '.png', '.webp']) {
  for (const ext of extensions) {
    const filePath = basePath + ext;
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

// Хелпер: определить язык из query или профиля
function resolveLang(req) {
  return req.query.lang || req.user?.lang || 'ru';
}

// 19. GET /api/tales/:id/cover
router.get('/api/tales/:id/cover', auth, (req, res) => {
  const filePath = findAsset(path.join(DATA_DIR, 'covers', req.params.id));
  if (!filePath) return res.status(404).json({ error: `Cover not found for tale: ${req.params.id}` });
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(filePath));
});

// 20. GET /api/tales/:id/illustration/:page
router.get('/api/tales/:id/illustration/:page', auth, (req, res) => {
  const page = parseInt(req.params.page);
  if (isNaN(page) || page < 0) return res.status(400).json({ error: 'Invalid page number' });
  const filePath = findAsset(path.join(DATA_DIR, 'illustrations', req.params.id, `page_${page}`));
  if (!filePath) return res.status(404).json({ error: `Illustration not found: ${req.params.id} page ${page}` });
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(filePath));
});

// 21. GET /api/tales/:id/default-narration/:page?lang=ru
router.get('/api/tales/:id/default-narration/:page', auth, (req, res) => {
  const page = parseInt(req.params.page);
  if (isNaN(page) || page < 0) return res.status(400).json({ error: 'Invalid page number' });
  const lang = resolveLang(req);
  const filePath = path.join(DATA_DIR, 'narration', 'default', req.params.id, lang, `page_${page}.mp3`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Default narration not found: ${req.params.id}/${lang} page ${page}` });
  res.set('Content-Disposition', `attachment; filename="${req.params.id}-${lang}-${page}.mp3"`);
  res.sendFile(path.resolve(filePath));
});

// 22. GET /api/tales/:id/default-narration?lang=ru
router.get('/api/tales/:id/default-narration', auth, (req, res) => {
  const lang = resolveLang(req);
  const dir = path.join(DATA_DIR, 'narration', 'default', req.params.id, lang);
  if (!fs.existsSync(dir)) return res.json({ available: false, lang, pages: [] });
  const files = fs.readdirSync(dir).filter(f => f.match(/^page_\d+\.mp3$/));
  const pages = files.map(f => parseInt(f.match(/page_(\d+)/)[1])).sort((a, b) => a - b);
  res.json({ available: pages.length > 0, lang, pages });
});

// Обновить GET /api/tales — добавить hasDefaultNarration
// В существующем обработчике, при формировании списка:
tales.map(tale => ({
  ...tale,
  hasDefaultNarration: fs.existsSync(
    path.join(DATA_DIR, 'narration', 'default', tale.id, tale.lang)
  ),
  coverUrl: `/api/tales/${tale.id}/cover`
}));
```

---

## Итого

| # | Endpoint | Method | Что отдаёт | Зависит от lang? |
|---|----------|--------|------------|------------------|
| 19 | `/api/tales/:id/cover` | GET | JPG/PNG обложка | Нет |
| 20 | `/api/tales/:id/illustration/:page` | GET | JPG/PNG иллюстрация | Нет |
| 21 | `/api/tales/:id/default-narration/:page?lang=` | GET | MP3 озвучка диктора | **Да** |
| 22 | `/api/tales/:id/default-narration?lang=` | GET | JSON: доступные страницы | **Да** |

### Изменения в существующих эндпоинтах

| Endpoint | Что изменить |
|----------|-------------|
| `GET /api/tales` | Добавить `hasDefaultNarration`, `coverUrl` в ответ |
| `GET /api/tales/:id` | Добавить `?lang=` query-параметр |
