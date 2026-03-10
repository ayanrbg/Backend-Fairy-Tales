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

Запускает фоновую озвучку всех страниц сказки голосом пользователя. Озвучка идёт постранично, прогресс можно отслеживать через `narration-status`.

**ВАЖНО:** Перед озвучкой сервер ДОЛЖЕН персонализировать текст — подставить `name` и `gender` из тела запроса в шаблоны `{childName}` и `{m:...|f:...}`. Используется та же логика что в endpoint `/personalize`. Без этого AI будет читать вслух сырые плейсхолдеры.

**Запрос:**
```
POST /api/tales/kolobok/narrate-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Маша",
  "gender": "female"
}
```

**Параметры тела:**

| Поле     | Тип    | Обязательный | Описание |
|----------|--------|--------------|----------|
| `name`   | string | да           | Имя ребёнка (для подстановки `{childName}`) |
| `gender` | string | да           | Пол: `"male"` или `"female"` (для выбора в `{m:...\|f:...}`) |

**Логика на сервере:**
1. Загрузить текст сказки (`pages[]`)
2. Для каждой страницы выполнить персонализацию:
   - Заменить `{childName}` → `name`
   - Заменить `{m:текст|f:текст}` → выбрать вариант по `gender`
3. Озвучить персонализированный текст через ElevenLabs API
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
// 400 — голос не клонирован
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
1.  GET  /health                                → проверить что сервер жив
2.  POST /api/auth/register                     → зарегистрироваться (имя, пол, язык) + получить токен
3.  POST /api/voice/clone                       → загрузить голос (mp3)
4.  GET  /api/tales?lang=ru                     → посмотреть список сказок
5.  GET  /api/tales/kolobok                     → получить сказку (pages + totalPages)
6.  POST /api/tales/kolobok/personalize         → персонализировать текст (имя + пол)
7.  POST /api/tales/kolobok/narrate?page=0      → озвучить одну страницу
8.  POST /api/tales/kolobok/narrate-all         → озвучить всю книгу (async)
9.  GET  /api/tales/kolobok/narration-status    → проверить прогресс озвучки
10. GET  /api/tales/kolobok/narration/0         → скачать озвученную страницу
11. POST /api/voice/drafts                      → создать черновик
12. GET  /api/voice/drafts                      → список черновиков
13. GET  /api/user/profile                      → получить профиль
14. PUT  /api/user/profile                      → обновить профиль
15. DELETE /api/voice                           → удалить клонированный голос
```
