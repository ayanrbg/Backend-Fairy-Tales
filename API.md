# API — Запросы и ответы

Базовый URL: `http://localhost:3000`

---

## 1. Health Check

**Запрос:**
```
GET /health
```

**Ответ (200):**
```json
{ "status": "ok" }
```

---

## 2. Авторизация — получить JWT токен

**Запрос:**
```
POST /api/auth/login
Content-Type: application/json

{
  "userId": "user_123"
}
```

**Ответ (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Ошибка (400):**
```json
{ "error": "userId is required" }
```

> Полученный `token` использовать во всех остальных запросах в заголовке:
> `Authorization: Bearer <token>`

---

## 3. Клонирование голоса

**Запрос:**
```
POST /api/voice/clone
Authorization: Bearer <token>
Content-Type: multipart/form-data

voiceSample: <аудио-файл.mp3>
```

**Ответ (200):**
```json
{
  "voiceId": "abc123def456",
  "status": "cloned"
}
```

**Ошибки:**
```json
// 400 — файл не приложен
{ "error": "voiceSample file is required" }

// 401 — нет/невалидный токен
{ "error": "Token not provided" }
{ "error": "Invalid or expired token" }

// 502 — ошибка Fish Audio API
{ "error": "Failed to clone voice", "details": "..." }
```

---

## 4. Удаление клонированного голоса

**Запрос:**
```
DELETE /api/voice
Authorization: Bearer <token>
```

**Ответ (200):**
```json
{ "status": "deleted" }
```

**Ошибки:**
```json
// 404 — голос не найден
{ "error": "No cloned voice found" }

// 502 — ошибка Fish Audio API
{ "error": "Failed to delete voice" }
```

---

## 5. Список сказок

**Запрос (все языки):**
```
GET /api/tales
Authorization: Bearer <token>
```

**Запрос (фильтр по языку):**
```
GET /api/tales?lang=ru
Authorization: Bearer <token>
```

**Ответ (200):**
```json
[
  {
    "id": "golden_egg",
    "title": "Золотое яичко",
    "lang": "ru",
    "free": true,
    "coverUrl": "/api/tales/golden_egg/cover",
    "bundled": true,
    "comingSoon": false
  },
  {
    "id": "magic_bird",
    "title": "Волшебная птица",
    "lang": "ru",
    "free": false,
    "coverUrl": "/api/tales/magic_bird/cover",
    "bundled": false,
    "downloadSize": 62286577,
    "comingSoon": false
  },
  {
    "id": "new_tale",
    "title": "Новая сказка",
    "titles": { "ru": "Новая сказка", "kz": "Жаңа ертегі", "uz": "Yangi ertak" },
    "lang": "ru",
    "free": false,
    "coverUrl": "/api/tales/new_tale/cover",
    "bundled": false,
    "comingSoon": true
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | ID сказки (одинаковый для всех языков) |
| `title` | string | Название на языке версии |
| `titles` | object | Названия на всех языках (`{ "ru": ..., "kz": ..., "uz": ... }`). Присутствует **только** у `comingSoon: true` |
| `lang` | string | Код языка (`ru`, `en`, `kz`, `uz`) |
| `free` | boolean | Бесплатная ли сказка |
| `coverUrl` | string | URL для загрузки обложки |
| `bundled` | boolean | `true` — иллюстрации встроены в клиент, загрузка не требуется |
| `downloadSize` | number | Размер иллюстраций в байтах (только для `bundled: false`). Включает обе версии (boy + girl). Отсутствует если `bundled: true` |
| `comingSoon` | boolean | `true` — сказка в разработке, **скоро будет**. Есть только название и обложка; текста/страниц нет, открывать/озвучивать нельзя. Клиент показывает её с бейджем «Скоро» |

> **Coming soon (скоро будет):** сказки с `comingSoon: true` отдаются в общем списке вместе с готовыми. У них есть `coverUrl` (обложка грузится с сервера как обычно) и `titles` со всеми языками, но **нет страниц**. Подробнее — см. раздел [«Сказки "Скоро будет"»](#сказки-скоро-будет) ниже.

---

## 6. Получить одну сказку (постраничная разбивка)

Текст сказки разбит на **страницы** (`pages`) — каждая страница = один слайд/экран в приложении.

**Запрос:**
```
GET /api/tales/kolobok?lang=ru
Authorization: Bearer <token>
```

| Параметр | Тип | Обяз. | Описание |
|----------|-----|-------|----------|
| `lang` | string | нет | Язык версии. Если не указан — первая найденная версия |

**Ответ (200):**
```json
{
  "id": "kolobok",
  "title": "Колобок",
  "lang": "ru",
  "free": true,
  "totalPages": 4,
  "bundled": false,
  "downloadSize": 0,
  "pages": [
    "Жили-были старик со старухой. Вот и просит старик: «Испеки мне, старая, колобок».",
    "Старуха наскребла муки, замесила тесто на сметане, скатала колобок, изжарила в масле и положила на окошко остудить.",
    "Колобок полежал-полежал, да вдруг и покатился — с окна на лавку, с лавки на пол, по полу да к двери...",
    "Катится колобок по дороге, а навстречу ему заяц: «Колобок, колобок! Я тебя съем!»"
  ],
  "genderedPages": [2, 5]
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `genderedPages` | int[] | Номера страниц, для которых есть гендерные варианты иллюстраций (`page_N_boy` / `page_N_girl`). Пустой массив если вариантов нет. Клиент использует этот массив, чтобы знать для каких страниц добавлять `?gender=boy` или `?gender=girl` при запросе иллюстраций. |
| `bundled` | boolean | `true` — иллюстрации встроены в клиент |
| `downloadSize` | number | Размер иллюстраций в байтах (только для `bundled: false`) |

**Ошибка (404):**
```json
{ "error": "Tale not found" }
```

> **Логика в приложении:** отображать `pages[currentIndex]` на экране, кнопки «назад/вперёд» переключают индекс от `0` до `totalPages - 1`. Для иллюстраций: если номер страницы есть в `genderedPages`, добавлять `?gender=boy` или `?gender=girl` к запросу иллюстрации.

---

## 7. Озвучить страницу сказки

Озвучивает **одну страницу** сказки. По умолчанию используется клонированный голос пользователя (Fish Audio). С параметром `voice=narrator` — дефолтный дикторский голос (Edge TTS, бесплатно).

Поддерживает два режима:
- **Серверные сказки** — текст загружается из БД, требует `name` и `gender` для персонализации.
- **Bundled-сказки** — клиент передаёт готовый текст в поле `text` тела запроса (уже персонализированный). Загрузка из БД и персонализация не выполняются.

**Запрос (серверная сказка, голос пользователя):**
```
POST /api/tales/kolobok/narrate?page=0
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female"
}
```

**Запрос (bundled-сказка, текст от клиента):**
```
POST /api/tales/white_camel/narrate?page=0&voice=narrator&lang=ru
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "Bir zamanlar bir devecik varmis. Onun adi Akbota..."
}
```

**Запрос (дикторская озвучка, женский голос):**
```
POST /api/tales/kolobok/narrate?page=0&voice=narrator
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female",
  "narratorGender": "female"
}
```

**Ответ (200):**
```
Content-Type: audio/mpeg
Content-Disposition: attachment; filename="kolobok-0.mp3"

<бинарные данные mp3>
```

**Query-параметры:**

| Параметр | Тип    | Обязательный | Описание |
|----------|--------|--------------|----------|
| `page`   | int    | да (если нет `text`) | Индекс страницы (0 .. totalPages-1) |
| `voice`  | string | нет          | `"narrator"` — использовать дикторский голос. Если не указан — голос пользователя |
| `lang`   | string | нет          | Язык сказки |

**Body-параметры (JSON):**

| Поле     | Тип    | Обязательный | Описание |
|----------|--------|--------------|----------|
| `text`   | string | нет          | Готовый текст для озвучки (bundled-сказки). Если передан — `page`, `name`, `gender` игнорируются, текст из БД не загружается |
| `name`   | string | да (если нет `text`) | Имя ребёнка для персонализации |
| `gender` | string | да (если нет `text`) | Пол ребёнка: `"male"` или `"female"` (для персонализации текста) |
| `narratorGender` | string | нет | Пол голоса диктора: `"male"` или `"female"`. По умолчанию `"male"`. Работает только с `voice=narrator` |

> При `voice=narrator` клонированный голос **не требуется** — можно использовать без предварительного клонирования.

**Ошибки:**
```json
// 400 — голос не клонирован (только без voice=narrator)
{ "error": "No cloned voice. Clone your voice first via POST /api/voice/clone" }

// 400 — не указана страница или индекс за пределами (только без text)
{ "error": "page parameter is required (0..3)" }

// 400 — не указаны name/gender (только без text)
{ "error": "name and gender are required in request body" }

// 404 — сказка не найдена (только без text)
{ "error": "Tale not found" }

// 502 — ошибка TTS API (Fish Audio / Edge TTS)
{ "error": "Failed to narrate tale", "details": "..." }
```

---

## 8. Регистрация — создать профиль и получить JWT

**Запрос:**
```
POST /api/auth/register
Content-Type: application/json

{
  "userId": "user_123",
  "name": "Маша",
  "gender": "female",
  "lang": "ru"
}
```

**Ответ (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "profile": {
    "user_id": "user_123",
    "name": "Маша",
    "gender": "female",
    "lang": "ru"
  }
}
```

**Ошибка (400):**
```json
{ "error": "userId is required" }
```

> При повторном вызове с тем же `userId` профиль обновляется (upsert).

---

## 9. Получить профиль пользователя

**Запрос:**
```
GET /api/user/profile
Authorization: Bearer <token>
```

**Ответ (200):**
```json
{
  "name": "Маша",
  "gender": "female",
  "lang": "ru"
}
```

**Ошибка (404):**
```json
{ "error": "Profile not found. Register first." }
```

---

## 10. Обновить профиль пользователя

Можно передать любое сочетание полей — обновятся только переданные.

**Запрос:**
```
PUT /api/user/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Миша",
  "gender": "male"
}
```

**Ответ (200):**
```json
{
  "profile": {
    "name": "Миша",
    "gender": "male",
    "lang": "ru"
  }
}
```

---

## 11. Персонализация сказки

Подставляет имя ребёнка и корректирует род в тексте сказки. Возвращает массив страниц с подставленными значениями.

**Запрос:**
```
POST /api/tales/kolobok/personalize
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female"
}
```

**Ответ (200):**
```json
{
  "pages": [
    "Жили-были старик со старухой. А у них жила внучка по имени Маша. Вот и просит старик: «Испеки мне, старая, колобок».",
    "Старуха наскребла муки, замесила тесто на сметане, скатала колобок, изжарила в масле и положила на окошко остудить. Маша сидела рядом и наблюдала.",
    "..."
  ]
}
```

**Шаблоны в текстах сказок:**
| Шаблон | Описание | Пример |
|--------|----------|--------|
| `{childName}` | Имя ребёнка | `Маша` |
| `{m:слово\|f:слово}` | Выбор по роду | `{m:побежал\|f:побежала}` → `побежала` |

**Ошибки:**
```json
// 400 — имя не указано
{ "error": "name is required" }

// 404 — сказка не найдена
{ "error": "Tale not found" }
```

---

## 12. Озвучить всю книгу (async)

Запускает фоновую озвучку всех страниц сказки. По умолчанию используется клонированный голос пользователя (Fish Audio). С параметром `voice: "narrator"` — дефолтный дикторский голос (Edge TTS, бесплатно). Озвучка идёт **параллельно батчами по 5 страниц** (~5× быстрее), прогресс можно отслеживать через `narration-status`.

**ВАЖНО:** Перед озвучкой сервер ДОЛЖЕН персонализировать текст — подставить `name` и `gender` из тела запроса в шаблоны `{childName}` и `{m:...|f:...}`. Используется та же логика что в endpoint `/personalize`. Без этого AI будет читать вслух сырые плейсхолдеры.

**Запрос (голос пользователя):**
```
POST /api/tales/kolobok/narrate-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female"
}
```

**Запрос (дикторская озвучка, мужской голос):**
```
POST /api/tales/kolobok/narrate-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female",
  "voice": "narrator"
}
```

**Запрос (дикторская озвучка, женский голос):**
```
POST /api/tales/kolobok/narrate-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female",
  "voice": "narrator",
  "narratorGender": "female"
}
```

**Параметры тела:**

| Поле     | Тип    | Обязательный | Описание |
|----------|--------|--------------|----------|
| `name`   | string | да           | Имя ребёнка (для подстановки `{childName}`) |
| `gender` | string | да           | Пол ребёнка: `"male"` или `"female"` (для персонализации текста `{m:...\|f:...}`) |
| `voice`  | string | нет          | `"narrator"` — использовать дикторский голос. Если не указан — голос пользователя |
| `narratorGender` | string | нет | Пол голоса диктора: `"male"` или `"female"`. По умолчанию `"male"`. Работает только с `voice: "narrator"` |

> При `voice: "narrator"` клонированный голос **не требуется** — можно использовать без предварительного клонирования.

**Логика на сервере:**
1. Загрузить текст сказки (`pages[]`)
2. Для каждой страницы выполнить персонализацию:
   - Заменить `{childName}` → `name`
   - Заменить `{m:текст|f:текст}` → выбрать вариант по `gender`
3. Озвучить персонализированный текст (клонированный голос → Fish Audio, дикторский → Edge TTS)
4. Сохранить результат

**Ответ (200):**
```json
{
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "processing"
}
```

**Ошибки:**
```json
// 400 — голос не клонирован (только без voice: "narrator")
{ "error": "No cloned voice. Clone your voice first via POST /api/voice/clone" }

// 400 — не указано имя
{ "error": "name and gender are required" }

// 404 — сказка не найдена
{ "error": "Tale not found" }

```

---

## 13. Статус озвучки книги

Опрашивается клиентом (polling) до тех пор, пока `status` не станет `"done"` или `"error"`.

**Запрос:**
```
GET /api/tales/kolobok/narration-status
Authorization: Bearer <token>
```

**Ответ (200):**
```json
{
  "status": "processing",
  "pagesReady": 3,
  "totalPages": 6
}
```

**Возможные значения `status`:** `processing`, `done`, `error`

**Ошибка (404):**
```json
{ "error": "No narration job found for this tale" }
```

---

## 14. Скачать озвученную страницу

Возвращает MP3-файл для конкретной страницы. Доступен только после того, как страница озвучена (проверяйте `pagesReady` в `narration-status`).

**Запрос:**
```
GET /api/tales/kolobok/narration/0
Authorization: Bearer <token>
```

**Ответ (200):**
```
Content-Type: audio/mpeg
Content-Disposition: attachment; filename="kolobok-0.mp3"

<бинарные данные mp3>
```

**Ошибки:**
```json
// 400 — невалидный номер страницы
{ "error": "Invalid page number" }

// 404 — страница ещё не озвучена
{ "error": "Narrated page not found. Check narration-status first." }
```

---

## 15. Список черновиков

**Запрос:**
```
GET /api/voice/drafts
Authorization: Bearer <token>
```

**Ответ (200):**
```json
[
  {
    "id": 1,
    "narratorName": "Папа",
    "taleId": "kolobok",
    "lastPage": 3,
    "createdAt": "2026-03-09T12:00:00.000Z"
  }
]
```

---

## 16. Создать черновик

**Запрос:**
```
POST /api/voice/drafts
Authorization: Bearer <token>
Content-Type: application/json

{
  "narratorName": "Папа",
  "taleId": "kolobok"
}
```

**Ответ (200):**
```json
{
  "draft": {
    "id": 1,
    "narratorName": "Папа",
    "taleId": "kolobok",
    "lastPage": 0,
    "voiceId": null,
    "createdAt": "2026-03-09T12:00:00.000Z"
  }
}
```

**Ошибка (400):**
```json
{ "error": "narratorName and taleId are required" }
```

---

## 17. Получить черновик

**Запрос:**
```
GET /api/voice/drafts/1
Authorization: Bearer <token>
```

**Ответ (200):**
```json
{
  "id": 1,
  "narratorName": "Папа",
  "taleId": "kolobok",
  "lastPage": 3,
  "voiceId": "abc123def456"
}
```

**Ошибка (404):**
```json
{ "error": "Draft not found" }
```

---

## 18. Удалить черновик

**Запрос:**
```
DELETE /api/voice/drafts/1
Authorization: Bearer <token>
```

**Ответ (200):**
```json
{ "status": "deleted" }
```

**Ошибка (404):**
```json
{ "error": "Draft not found" }
```

---

## 19. Обложка сказки

Возвращает изображение обложки. Обложка **не зависит от языка** — одна картинка для всех версий.

**Запрос:**
```
GET /api/tales/kolobok/cover
Authorization: Bearer <token>
```

**Ответ (200):**
```
Content-Type: image/jpeg
Cache-Control: public, max-age=86400
Content-Length: 45231

<бинарные данные изображения>
```

> `Content-Type` определяется автоматически по расширению файла (`.jpg` → `image/jpeg`, `.png` → `image/png`, `.webp` → `image/webp`).

**Ошибка (404):**
```json
{ "error": "Cover not found for tale: kolobok" }
```

---

## Сказки «Скоро будет»

Сказки в разработке, которые уже видно в библиотеке, но открыть их пока нельзя. У них есть **название** (на всех языках) и **обложка**, но нет текста/страниц.

### Как это работает

- Отдаются в общем списке `GET /api/tales` с полем `comingSoon: true`.
- Обложка грузится с сервера тем же эндпоинтом, что и у обычных сказок: `GET /api/tales/{id}/cover`.
- `GET /api/tales/{id}` для такой сказки вернёт заглушку с `comingSoon: true`, `pages: []`, `totalPages: 0` — но открывать/озвучивать её не нужно.

### Инструкция для клиента

1. Запросить список: `GET /api/tales?lang=ru` (или без `lang`).
2. Для каждой сказки проверить поле `comingSoon`:
   - `comingSoon: false` (или отсутствует) — обычная сказка, работает как раньше.
   - `comingSoon: true` — отрисовать карточку с обложкой и названием, повесить бейдж **«Скоро»**, сделать её **некликабельной** (не открывать, не качать иллюстрации, не озвучивать).
3. Обложку грузить с `coverUrl` как обычно.
4. Название брать из `title` (для текущего языка) либо из `titles[lang]`, если нужен конкретный язык.

```text
GET /api/tales?lang=ru
   → для каждой сказки:
        if (tale.comingSoon) {
            показать обложку (tale.coverUrl) + tale.title + бейдж "Скоро";
            карточка disabled;
        } else {
            обычная сказка;
        }
```

### Как добавить «скоро будет» сказку (серверная часть)

1. Положить обложку в `data/covers/` под именем `{id}.png` (поддерживаются `.png`, `.jpg`, `.webp`). Например `data/covers/new_tale.png`.
2. Добавить запись в `data/coming-soon.json`:

```json
[
  {
    "id": "new_tale",
    "free": false,
    "titles": {
      "ru": "Новая сказка",
      "kz": "Жаңа ертегі",
      "uz": "Yangi ertak"
    }
  }
]
```

| Поле | Обяз. | Описание |
|------|-------|----------|
| `id` | да | ID сказки. Должен совпадать с именем файла обложки (`data/covers/{id}.png`). Только латиница/цифры/`_`/`-` |
| `titles` | да | Названия по языкам. Минимум один язык. Ключи: `ru`, `kz`, `uz` (и др.) |
| `free` | нет | Будет ли сказка бесплатной (по умолчанию `false`). Информативно для клиента |

Перезапуск сервера **не нужен** — файл читается при каждом запросе списка. Когда сказка готова, удали её из `coming-soon.json` и добавь полноценно (через `db/seed.js` + иллюстрации).

---

## 20. Иллюстрация страницы

Возвращает иллюстрацию для конкретной страницы. Иллюстрации **не зависят от языка** — одни и те же картинки. Поддерживает гендерные варианты (разные картинки для мальчиков и девочек).

**Запрос:**
```
GET /api/tales/kolobok/illustration/0
GET /api/tales/kolobok/illustration/2?gender=boy
GET /api/tales/kolobok/illustration/2?gender=girl
Authorization: Bearer <token>
```

**Параметры:**

| Параметр | Тип | Обяз. | Описание |
|----------|-----|-------|----------|
| `id` | string | да | ID сказки |
| `page` | int | да | Индекс страницы (0 .. totalPages-1) |

**Query-параметры:**

| Параметр | Тип | Обяз. | Описание |
|----------|-----|-------|----------|
| `gender` | string | нет | `"boy"` или `"girl"`. Если передан — сервер ищет `page_N_boy.{ext}` / `page_N_girl.{ext}`. Если не найден или не передан — fallback на общую `page_N.{ext}` |

**Логика поиска файла:**
1. Если `gender` передан → искать `page_N_boy.{ext}` или `page_N_girl.{ext}`
2. Если гендерный вариант не найден или `gender` не передан → fallback на `page_N.{ext}`
3. Если ничего не найдено → 404

**Ответ (200):**
```
Content-Type: image/jpeg
Cache-Control: public, max-age=86400
Content-Length: 128450

<бинарные данные изображения>
```

**Ошибки:**
```json
// 400 — невалидный номер страницы
{ "error": "Invalid page number" }

// 400 — невалидное значение gender
{ "error": "gender must be \"boy\" or \"girl\"" }

// 404 — иллюстрация не найдена
{ "error": "Illustration not found: kolobok page 5" }
```

---

## Формат файла сказки

Тексты хранятся в `data/tales/{lang}/{id}.json`. Поле `pages` — массив строк, каждая строка = один экран/слайд.

```json
{
  "id": "kolobok",
  "title": "Колобок",
  "lang": "ru",
  "pages": [
    "Жили-были старик со старухой. А у них {m:жил внук|f:жила внучка} по имени {childName}...",
    "Старуха наскребла муки...",
    "Колобок полежал-полежал...",
    "Катится колобок по дороге..."
  ]
}
```

**Шаблоны персонализации:**
- `{childName}` — заменяется на имя ребёнка при вызове `/personalize`
- `{m:текст|f:текст}` — выбирается вариант по полу (`male` / `female`)

> Разбивка на страницы делается **вручную** при добавлении сказки — так каждый разрыв будет по смыслу, а не механически по точкам.

---

## Типичный флоу тестирования

```
1.  GET  /health                                         → проверить что сервер жив
2.  POST /api/auth/register                              → зарегистрироваться (имя, пол, язык) + получить токен
3.  POST /api/voice/clone                                → загрузить голос (mp3)
4.  GET  /api/tales?lang=ru                              → посмотреть список сказок (+ free, coverUrl)
5.  GET  /api/tales/kolobok?lang=ru                      → получить сказку (pages + totalPages)
6.  GET  /api/tales/kolobok/cover                        → загрузить обложку
7.  GET  /api/tales/kolobok/illustration/0               → загрузить иллюстрацию страницы
8.  POST /api/tales/kolobok/personalize                  → персонализировать текст (имя + пол)
9.  POST /api/tales/kolobok/narrate?page=0               → озвучить одну страницу (Fish Audio, голос пользователя)
9b. POST /api/tales/kolobok/narrate?page=0&voice=narrator→ озвучить одну страницу (Edge TTS, дикторский голос)
10. POST /api/tales/kolobok/narrate-all                  → озвучить всю книгу (async, голос пользователя)
10b.POST /api/tales/kolobok/narrate-all {voice:"narrator"}→ озвучить всю книгу (async, Edge TTS)
11. GET  /api/tales/kolobok/narration-status             → проверить прогресс озвучки
12. GET  /api/tales/kolobok/narration/0                  → скачать озвученную страницу
13. POST /api/voice/drafts                               → создать черновик
14. GET  /api/voice/drafts                               → список черновиков
15. GET  /api/user/profile                               → получить профиль
16. PUT  /api/user/profile                               → обновить профиль
17. DELETE /api/voice                                    → удалить клонированный голос
```
