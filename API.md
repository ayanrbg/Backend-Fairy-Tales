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
| `title` | string | Название на запрошенном языке (fallback `ru` → первый доступный) |
| `titles` | object | Названия на всех языках (`{ "ru": ..., "kz": ..., "uz": ... }`). Присутствует у **всех** сказок |
| `lang` | string | Код языка отданного `title` (`ru`, `en`, `kz`, `uz`) |
| `langs` | string[] | Языки, на которые сказка реально переведена |
| `free` | boolean | Бесплатная ли сказка |
| `coverUrl` | string | URL для загрузки обложки |
| `bundled` | boolean | `true` — иллюстрации встроены в клиент, загрузка не требуется |
| `downloadSize` | number | Размер иллюстраций в байтах (только для `bundled: false`). Включает обе версии (boy + girl). Отсутствует если `bundled: true` |
| `comingSoon` | boolean | `true` — сказка в разработке, **скоро будет**. Есть только название и обложка; текста/страниц нет, открывать/озвучивать нельзя. Клиент показывает её с бейджем «Скоро» |
| `status` | string | `active` — показывать; `hidden` — скрыть у новых; `removed` — скрыть **и стереть локальный кэш** сказки. Клиент реагирует на явный `removed` (сказка держится в выдаче ещё ~30 дней после удаления, чтобы клиент успел подчистить кэш) |
| `sortOrder` | number | Порядок в библиотеке (меньше = выше). Клиент дополнительно сортирует по доступности |
| `contentVersion` | number | Версия контента. Растёт при обновлении сказки — клиент может перекачать изменённое |

> `GET /api/tales` возвращает **весь каталог** по одной записи на сказку (с `titles` на всех языках), включая сказки, не переведённые на запрошенный `lang`. Это нужно, чтобы клиент не принял отсутствие перевода за удаление: чистку кэша он делает только по явному `status: "removed"`. Управление каталогом (статус, «скоро», порядок, удаление) — через админ-эндпоинты, см. раздел [«Админ-API»](#админ-api) ниже.

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

---

# Подписки и премиум

Сервер — **единственный источник правды** по премиуму. Клиент хранит только оптимистичный кэш и всегда сверяется с сервером. Три эндпоинта (все — по пользовательскому JWT).

## S1. Проверить премиум при запуске — `GET /api/subscription/status`

> **Клиент ДОЛЖЕН дёргать этот эндпоинт при каждом запуске приложения** (и после возврата из фона, и после покупки/восстановления). Именно отсюда берётся дата окончания премиума и принимается решение — включать премиум или уже погасить.

**Запрос:**
```
GET /api/subscription/status
Authorization: Bearer <token>
```

**Ответ (200) — премиум активен:**
```json
{
  "active": true,
  "expiresAt": "2026-08-01T12:00:00.000Z",
  "source": "apple",
  "productId": "fairytales_yearly"
}
```

**Ответ (200) — премиума нет / истёк:**
```json
{ "active": false, "expiresAt": null, "source": null, "productId": null }
```

| Поле | Тип | Описание |
|------|-----|----------|
| `active` | boolean | **Главное поле.** `true` — премиум действует прямо сейчас. Считается на сервере как `premium && (expiresAt == null \|\| expiresAt > now)` |
| `expiresAt` | string\|null | Дата/время окончания премиума в **ISO-8601 UTC**. `null` = бессрочный (промо/админ-грант). Для стор-подписок — конец оплаченного периода; после успешного автопродления сервер сам сдвинет её вперёд |
| `source` | string\|null | Откуда премиум: `apple` \| `google` \| `promo` \| `admin` \| `null` (если премиума нет) |
| `productId` | string\|null | `fairytales_monthly` \| `fairytales_yearly` \| `null` (для промо/админ) |

### Как клиент должен трактовать ответ

1. **На каждом старте** вызвать `GET /api/subscription/status`.
2. Если `active == true` → включить премиум. Показать дату окончания можно из `expiresAt` (для стор-подписок это дата следующего списания/окончания; для `expiresAt == null` — «бессрочно»).
3. Премиум **выключать только** когда сервер вернул `active == false`. Не гасить премиум по локальному таймеру или по `expiresAt` в прошлом самостоятельно — сервер уже учёл автопродление, grace-period и S2S-события и сам вернёт `active:false`, когда премиум реально закончился.
4. **Если запрос не удался (сеть/сервер недоступен)** — НЕ выключать премиум: оставить последнее известное состояние из локального кэша и повторить позже. Гашение — только по явному `active:false` от сервера.

> Правило одной строкой: премиум **включается** от любого источника (кэш/чек/сервер), **выключается только** по `active:false` из `/status`. Дата окончания — всегда `expiresAt` из этого ответа.

### Что происходит на сервере (для понимания)

- Для Apple премиум продлевается/снимается автоматически через **S2S-нотификации** (`DID_RENEW`, `EXPIRED`, `REFUND` и т.д.) — `/status` просто читает актуальное состояние.
- Для Google при истёкшем `expiresAt` сервер делает ленивую ре-валидацию в Google Play при обращении к `/status`.
- Триал (Apple `is_trial_period`, Google `paymentState=2`) отдаётся как обычный активный премиум: `active:true` с `expiresAt` = конец триала.

## S2. Подтвердить покупку — `POST /api/subscription/validate`

Вызывается **после покупки или восстановления** (Restore). Сервер валидирует чек в сторе, включает премиум и возвращает то же тело, что и `/status`.

**Запрос:**
```
POST /api/subscription/validate
Authorization: Bearer <token>
Content-Type: application/json

{
  "platform": "apple",              // "apple" | "google"
  "receipt": "<base64 receipt | google purchaseToken>",
  "productId": "fairytales_yearly"  // для google обязателен
}
```

**Ответ (200):** `{ "active": true, "expiresAt": "...", "source": "apple", "productId": "..." }`

| Ситуация | Ответ |
|----------|-------|
| Чек валиден | `200 { "active": true, ... }` |
| Чек невалиден/истёк | `200 { "active": false, "error": "..." }` — это **не** сетевая ошибка, премиум не давать |
| Стор временно недоступен (Apple 21005 и т.п.) | `503` — клиент сохраняет текущий кэш и повторяет позже |
| Нет/битый JWT | `401` |

> После `validate` клиенту не обязательно отдельно звать `/status` — тело ответа идентично. Но на следующем старте `/status` всё равно вызывается.

## S3. Промокод — `POST /api/promo`

**Запрос:**
```
POST /api/promo
Authorization: Bearer <token>
Content-Type: application/json

{ "code": "PROMO2026" }
```

**Ответ (200):** `{ "type": "premium", "expiresAt": "...", "message": "Премиум активирован" }` (для премиум-кодов; `expiresAt: null` = бессрочно). Грант пишется на сервер (`source='promo'`) и переживает перезапуск/переустановку — на следующем `/status` вернётся `active:true, source:"promo"`.

---

# Админ-API

Управление каталогом сказок и подписками. Отдельная авторизация — **не** пользовательский JWT, а админ-ключ в заголовке:

```
X-Admin-Key: <ADMIN_KEY>
```

`ADMIN_KEY` хранится в серверном `.env`. Без ключа или с неверным — `401 { "error": "Invalid admin key" }`; если ключ не сконфигурирован на сервере — `503 { "error": "Admin key not configured" }`.

---

## A1. Список подписок

**Запрос:**
```
GET /api/admin/subscriptions?active=true&q=&limit=100&offset=0
X-Admin-Key: <ADMIN_KEY>
```

| Query | Тип | Описание |
|-------|-----|----------|
| `active` | bool | `true` — только активные (premium и не истёк) |
| `q` | string | Поиск по подстроке `userId` |
| `limit` | int | По умолчанию 100, максимум 500 |
| `offset` | int | Смещение для пагинации |

**Ответ (200):**
```json
[
  {
    "userId": "a30cede5-9149-48ff-a5ec-f639cec17222",
    "active": true,
    "premium": true,
    "source": "apple",
    "productId": "fairytales_monthly",
    "expiresAt": "2026-07-23T17:46:48.000Z",
    "environment": null,
    "updatedAt": "2026-06-23T17:47:03.342Z"
  }
]
```

| Поле | Описание |
|------|----------|
| `source` | `apple` \| `google` \| `promo` \| `admin` |
| `active` | `premium && (expiresAt == null \|\| expiresAt > now)` |
| `expiresAt` | `null` = бессрочно (promo/admin) |

---

## A2. Карточка подписки пользователя

**Запрос:**
```
GET /api/admin/subscriptions/{userId}
X-Admin-Key: <ADMIN_KEY>
```

**Ответ (200):** текущее право + история событий + последний снимок клиента.
```json
{
  "userId": "4a104582-0862-4b60-8a38-1088c6bd1997",
  "entitlement": {
    "active": true,
    "expiresAt": "2026-08-01T13:42:57.021Z",
    "source": "promo",
    "productId": null
  },
  "events": [
    { "id": "12", "source": "admin", "kind": "admin_grant", "created_at": "2026-07-04T06:30:00.000Z" }
  ],
  "lastSnapshot": {
    "platform": "IPhonePlayer",
    "app_version": "1.0.3",
    "context": "init",
    "cached_premium": true,
    "products": [ { "id": "fairytales_monthly", "available": true, "hasReceipt": true } ],
    "client_ts": "2026-07-02T10:15:30.000Z",
    "received_at": "2026-07-02T10:15:31.000Z"
  }
}
```
`events` и `lastSnapshot` могут быть пустыми (`[]` / `null`).

---

## A3. Выдать премиум вручную (grant)

Записывает право с `source='admin'` — **перекрывает** любую стор-запись и не сбрасывается последующей валидацией стора / S2S (снять можно только `revoke`).

**Запрос:**
```
POST /api/admin/subscriptions/{userId}/grant
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{ "days": 30 }
```

| Поле | Тип | Описание |
|------|-----|----------|
| `days` | int | Премиум на N дней от текущего момента |
| `until` | string | Дата окончания (ISO, напр. `"2026-12-31"`) — альтернатива `days` |
| — | — | Если ни `days`, ни `until` не переданы → **бессрочно** (`expiresAt: null`) |

**Ответ (200):**
```json
{ "active": true, "expiresAt": "2026-08-03T06:30:00.000Z", "source": "admin", "productId": null }
```

**Ошибка (400):** `{ "error": "invalid until" }`

---

## A4. Снять премиум (revoke)

**Запрос:**
```
POST /api/admin/subscriptions/{userId}/revoke
X-Admin-Key: <ADMIN_KEY>
```

**Ответ (200):**
```json
{ "active": false, "expiresAt": "...", "source": "admin", "productId": null }
```

**Ошибка (404):** `{ "error": "no entitlement for user" }`

---

## A5. Продлить премиум (extend)

Сдвигает `expiresAt` на N дней (от текущего значения, либо от `now`, если было бессрочно/пусто).

**Запрос:**
```
POST /api/admin/subscriptions/{userId}/extend
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{ "days": 7 }
```

**Ответ (200):** обновлённое право (как в grant). **Ошибки:** `400 { "error": "days required" }`, `404 { "error": "no entitlement for user" }`.

---

## A6. Список сказок (админ)

Полный каталог по одной записи на сказку, **включая** `hidden` и `removed`.

**Запрос:**
```
GET /api/admin/tales
X-Admin-Key: <ADMIN_KEY>
```

**Ответ (200):**
```json
[
  {
    "id": "baursak",
    "titles": { "ru": "Баурсак", "kz": "Баурсақ", "uz": "Baursaq" },
    "langs": ["kz", "ru", "uz"],
    "free": false,
    "status": "active",
    "comingSoon": false,
    "sortOrder": 0,
    "contentVersion": 1,
    "updatedAt": "2026-07-04T06:26:58.523Z"
  }
]
```

---

## A7. Создать сказку

Заводит запись каталога (по одной строке на язык). Иллюстрации/обложку заливать в хранилище отдельно (см. `ADDING_TALES.md`). Пока не залит контент — можно держать `comingSoon: true`.

**Запрос:**
```
POST /api/admin/tales
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "id": "new_tale",
  "titles": { "ru": "Новая сказка", "kz": "Жаңа ертегі", "uz": "Yangi ertak" },
  "pages": { "ru": ["Страница 1...", "Страница 2..."] },
  "free": false,
  "comingSoon": true,
  "sortOrder": 10
}
```

| Поле | Обяз. | Описание |
|------|-------|----------|
| `id` | да | Только латиница/цифры/`_`/`-` |
| `titles` | да | `{ lang: title }`, минимум один язык |
| `pages` | нет | `{ lang: [строки] }`. По умолчанию пусто |
| `free` / `comingSoon` / `sortOrder` | нет | Флаги каталога |

**Ответ (200):** `{ "id": "new_tale", "created": true }`. **Ошибки:** `400 { "error": "invalid id" }`, `400 { "error": "titles required" }`.

---

## A8. Обновить сказку (patch)

Обновляются только переданные поля. Слаг-уровневые (`free`, `comingSoon`, `status`, `sortOrder`) применяются ко всем языковым строкам сказки; `titles` — точечно по языкам.

**Запрос:**
```
PATCH /api/admin/tales/{id}
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "status": "hidden",
  "sortOrder": 3,
  "titles": { "ru": "Новое название" }
}
```

| Поле | Значения |
|------|----------|
| `status` | `active` \| `hidden` \| `removed` |
| `free` | bool |
| `comingSoon` | bool |
| `sortOrder` | number |
| `titles` | `{ lang: title }` — обновляет существующие языковые строки |

**Ответ (200):** `{ "id": "...", "updated": true }`. **Ошибки:** `400 { "error": "invalid status" }`, `404 { "error": "tale not found" }`.

---

## A9. Быстрые действия каталога

Все требуют `X-Admin-Key`. Возвращают `404 { "error": "tale not found" }`, если сказки нет.

| Метод | Эндпоинт | Тело | Действие | Ответ |
|-------|----------|------|----------|-------|
| POST | `/api/admin/tales/{id}/coming-soon` | `{ "value": true }` | Тумблер «скоро» | `{ "id", "comingSoon" }` |
| POST | `/api/admin/tales/{id}/publish` | — | `comingSoon=false`, `status='active'` | `{ "id", "published": true }` |
| POST | `/api/admin/tales/{id}/reorder` | `{ "sortOrder": 5 }` | Порядок в библиотеке | `{ "id", "sortOrder" }` |
| DELETE | `/api/admin/tales/{id}` | — | Мягкое удаление: `status='removed'` (клиент подчистит кэш; запись держится ~30 дней) | `{ "id", "removed": true }` |

> Удаление **мягкое** — строка не стирается сразу, а помечается `removed` и ещё ~30 дней отдаётся в `GET /api/tales`, чтобы клиенты успели удалить локальный кэш сказки.

---

## A10. Мониторинг клиента (без админ-ключа)

Эти эндпоинты вызывает **клиент** (не админ), поэтому админ-ключ не нужен.

### Снимок состояния подписки — `POST /api/subscription/sync`

JWT опционален (если есть — `userId` берётся из токена). Клиент шлёт полный снимок; сервер складывает в `subscription_snapshots` (виден в карточке A2). Ответ всегда `200 {}`.

```
POST /api/subscription/sync
Authorization: Bearer <token>   // опционально
Content-Type: application/json

{
  "userId": "<guid>",
  "platform": "IPhonePlayer",
  "appVersion": "1.0.3",
  "context": "init",
  "cachedPremium": true,
  "products": [ { "id": "fairytales_monthly", "available": true, "hasReceipt": true } ],
  "ts": "2026-07-02T10:15:30Z"
}
```

### Удалённые логи — `POST /api/debug/log`

Без авторизации (логи должны проходить и до логина). Fire-and-forget, всегда `200 {}`.

```
POST /api/debug/log
Content-Type: application/json

{
  "userId": "<guid или пусто>",
  "session": "a1b2c3d4",
  "platform": "IPhonePlayer",
  "appVersion": "1.0.3",
  "ev": "purchase_validated",
  "data": "ok=true; active=true; source=apple; granted=true",
  "ts": "2026-07-02T10:15:30Z"
}
```

**Чтение логов (админ):**
```
GET /api/debug/log?userId=&session=&limit=200
X-Admin-Key: <ADMIN_KEY>
```
Возвращает массив записей (новые сверху), отфильтрованных по `userId`/`session`.

---

### Зеркало полного лога — `POST /api/debug/logs`

Батч строк лога Unity из живого билда (SERVER_LOG_MIRROR_SPEC §1). Fire-and-forget,
без обязательной авторизации; при наличии валидного JWT его `userId` важнее тела.
Всегда `200`. В ответ пиггибекается текущая политика логирования (§3).

```
POST /api/debug/logs
Content-Type: application/json

{
  "userId": "abc123",
  "session": "9f3c1a2b",
  "platform": "IPhonePlayer",
  "appVersion": "1.4.0",
  "lines": [
    { "ts": "2026-07-05T10:11:12.345Z", "level": "Log",   "message": "[IAP-DBG] Purchase() called", "stack": "" },
    { "ts": "2026-07-05T10:11:13.000Z", "level": "Error", "message": "[IAP-DBG] ERROR [500]", "stack": "UnityEngine..." }
  ]
}
```
Ответ: `{ "hasConfig": true, "enabled": true, "level": "all", "flushSec": 4, "batchMax": 40 }`.

**Чтение строк лога (админ)** — старые→новые, чтобы читать флоу покупки сверху вниз:
```
GET /api/debug/logs?userId=&session=&level=&limit=500
X-Admin-Key: <ADMIN_KEY>
```

### Kill-switch логирования — `GET /api/debug/config`

Клиент дёргает на каждом старте (SERVER_LOG_MIRROR_SPEC §2). `hasConfig:true`
обязателен, иначе клиент игнорирует ответ.

```
GET /api/debug/config?userId=<id>
```
```json
{ "hasConfig": true, "enabled": true, "level": "all", "flushSec": 4, "batchMax": 40 }
```
- `enabled:false` — клиент перестаёт захватывать и слать логи (глушилка).
- `level:"warn"` — только Warning/Error/Exception (без шумных `Log`).

**Управление политикой (админ):** глобальная строка — `user_id='*'`, строка с
реальным `userId` — точечное переопределение для одного тестера.
```
GET    /api/admin/debug/log-config                 → список строк политики
PUT    /api/admin/debug/log-config                 → upsert { userId?, enabled?, level?, flushSec?, batchMax? }
DELETE /api/admin/debug/log-config?userId=<id>     → снять переопределение (не глобальное)
X-Admin-Key: <ADMIN_KEY>
```
Чтобы выключить логи у всех без обновления клиента: `PUT { "enabled": false }` (без `userId`).

---

## A11. Диагностика сервера (debug)

Обзор состояния сервера и активности IAP в одном месте — чтобы искать причину сбоя без SSH/psql. Требуют `X-Admin-Key`.

### Обзор — `GET /api/admin/debug/overview`

```
GET /api/admin/debug/overview?limit=25
X-Admin-Key: <ADMIN_KEY>
```

| Query | Описание |
|-------|----------|
| `limit` | Сколько последних записей в каждом списке (по умолчанию 25, максимум 200) |

**Ответ (200):**
```json
{
  "config": {
    "apple": { "sharedSecret": true, "bundleId": "com.mozz.fairyTales", "appAppleId": "6761322650",
               "s2sCerts": { "count": 2, "files": ["AppleRootCA-G2.cer", "AppleRootCA-G3.cer"] } },
    "google": { "serviceAccount": "file-ok", "packageName": "com.tokengc.balastories" },
    "adminKey": true, "promo": true, "debugHttp": true, "node": "v20.19.6"
  },
  "db": { "ok": true, "time": "2026-07-04T06:48:36.492Z" },
  "entitlementCounts": [
    { "source": "apple", "total": "3", "active": "1" },
    { "source": "promo", "total": "3", "active": "1" }
  ],
  "recentEvents":    [ { "id": "…", "user_id": "…", "source": "apple", "kind": "s2s", "created_at": "…" } ],
  "recentSnapshots": [ { "user_id": "…", "context": "init", "cached_premium": true, "received_at": "…" } ],
  "recentLogs":      [ { "id": "…", "session": "…", "ev": "purchase_validated", "data": "…", "received_at": "…" } ],
  "recentFailures":  [ ]
}
```

| Поле | Что показывает |
|------|----------------|
| `config` | Что подключено на сервере (Apple secret/bundle/appAppleId, S2S-сертификаты, Google SA/package, admin-ключ, промо). Быстрая проверка мисконфига |
| `db` | Доступность БД + серверное время |
| `entitlementCounts` | Число прав по каждому источнику (`total`) и сколько из них активны (`active`) |
| `recentEvents` | Последние события подписок (`validate` / `s2s` / `promo` / `admin_*`) из `subscription_events` |
| `recentSnapshots` | Последние снимки клиента (`POST /api/subscription/sync`) |
| `recentLogs` | Последние удалённые логи (`POST /api/debug/log`) |
| `recentFailures` | Только записи логов с признаком ошибки (`ev` содержит `fail`, либо `data` содержит `error`/`granted=false`) — сюда смотреть в первую очередь |

### Только конфиг — `GET /api/admin/debug/config`

```
GET /api/admin/debug/config
X-Admin-Key: <ADMIN_KEY>
```
Ответ: `{ "config": { … }, "db": { "ok": true, "time": "…" } }` — то же, что `config`+`db` из overview.

> **Логи процесса** (`pm2 logs fairy-backend`): префиксы для грепа — `[IAP]` (покупки/валидация/S2S), `[HTTP]`/`[HTTP!]` (запросы; `!` = ответ ≥400), `[BOOT]` (проблемы конфига при старте), `[FATAL]` (необработанные исключения), `[CLEANUP]` (чистка старых логов). Секреты (чеки, токены, подписи, промокоды, ключи) в логах маскируются как `<redacted len=N>`. Приглушить болтливость запросов: `DEBUG_HTTP=0` в `.env` (останутся только ошибки).
