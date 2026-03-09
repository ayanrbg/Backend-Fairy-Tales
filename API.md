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

// 502 — ошибка ElevenLabs API
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

// 502 — ошибка ElevenLabs API
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
  { "id": "kolobok",     "title": "Колобок",    "lang": "ru", "file": "ru/kolobok.json" },
  { "id": "teremok",     "title": "Теремок",    "lang": "ru", "file": "ru/teremok.json" },
  { "id": "three-bears", "title": "Three Bears", "lang": "en", "file": "en/three-bears.json" }
]
```

---

## 6. Получить одну сказку (постраничная разбивка)

Текст сказки разбит на **страницы** (`pages`) — каждая страница = один слайд/экран в приложении.

**Запрос:**
```
GET /api/tales/kolobok
Authorization: Bearer <token>
```

**Ответ (200):**
```json
{
  "id": "kolobok",
  "title": "Колобок",
  "lang": "ru",
  "totalPages": 4,
  "pages": [
    "Жили-были старик со старухой. Вот и просит старик: «Испеки мне, старая, колобок».",
    "Старуха наскребла муки, замесила тесто на сметане, скатала колобок, изжарила в масле и положила на окошко остудить.",
    "Колобок полежал-полежал, да вдруг и покатился — с окна на лавку, с лавки на пол, по полу да к двери...",
    "Катится колобок по дороге, а навстречу ему заяц: «Колобок, колобок! Я тебя съем!»"
  ]
}
```

**Ошибка (404):**
```json
{ "error": "Tale not found" }
```

> **Логика в приложении:** отображать `pages[currentIndex]` на экране, кнопки «назад/вперёд» переключают индекс от `0` до `totalPages - 1`.

---

## 7. Озвучить страницу сказки

Озвучивает **одну страницу** сказки голосом пользователя. Параметр `page` указывает индекс страницы (начиная с 0).

**Запрос:**
```
POST /api/tales/kolobok/narrate?page=0
Authorization: Bearer <token>
```

**Ответ (200):**
```
Content-Type: audio/mpeg
Content-Disposition: attachment; filename="kolobok-0.mp3"

<бинарные данные mp3>
```

**Параметры:**

| Параметр | Тип  | Обязательный | Описание |
|----------|------|--------------|----------|
| `page`   | int  | да           | Индекс страницы (0 .. totalPages-1) |

**Ошибки:**
```json
// 400 — голос не клонирован
{ "error": "No cloned voice. Clone your voice first via POST /api/voice/clone" }

// 400 — не указана страница или индекс за пределами
{ "error": "page parameter is required (0..3)" }

// 404 — сказка не найдена
{ "error": "Tale not found" }

// 502 — ошибка ElevenLabs API
{ "error": "Failed to narrate tale", "details": "..." }
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
    "Жили-были старик со старухой...",
    "Старуха наскребла муки...",
    "Колобок полежал-полежал...",
    "Катится колобок по дороге..."
  ]
}
```

> Разбивка на страницы делается **вручную** при добавлении сказки — так каждый разрыв будет по смыслу, а не механически по точкам.

---

## Типичный флоу тестирования

```
1. GET  /health                                → проверить что сервер жив
2. POST /api/auth/login                        → получить токен
3. POST /api/voice/clone                       → загрузить голос (mp3)
4. GET  /api/tales?lang=ru                     → посмотреть список сказок
5. GET  /api/tales/kolobok                     → получить сказку (pages + totalPages)
6. POST /api/tales/kolobok/narrate?page=0      → озвучить первую страницу
7. POST /api/tales/kolobok/narrate?page=1      → озвучить вторую страницу
8. DELETE /api/voice                           → удалить клонированный голос
```
