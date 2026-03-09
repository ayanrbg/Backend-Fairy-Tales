# Backend Fairy Tales — План реализации

## Общий флоу

```
Приложение                      Сервер                         ElevenLabs
    |                              |                                |
    |-- POST /api/auth/login ----->|  (JWT)                         |
    |<-- { token } ----------------|                                |
    |                              |                                |
    |-- POST /api/voice/clone ---->|                                |
    |   (аудио-сэмпл + JWT)       |-- POST /v1/voices/add -------->|
    |                              |<-- voice_id -------------------|
    |                              |   (сохранить voice_id → user)  |
    |<-- { voiceId, status } ------|                                |
    |                              |                                |
    |-- GET /api/tales ----------->|                                |
    |<-- [ список сказок ] --------|                                |
    |                              |                                |
    |-- POST /api/tales/:id/narrate|                                |
    |   (JWT, берём voice_id юзера)|-- POST /v1/text-to-speech ---->|
    |                              |<-- аудио (mp3) ----------------|
    |<-- аудио-файл сказки --------|                                |
```

### Ключевые принципы

- Голос клонируется **один раз** и привязывается к пользователю (кэширование)
- Тексты сказок хранятся **на сервере** в файлах — приложение выбирает из каталога
- **JWT** на каждом запросе кроме логина
- Два раздельных эндпоинта — клонирование и озвучка
- Многоязычная поддержка (модель `eleven_multilingual_v2`)
- Формат аудио: mp3 (Android), в будущем — поддержка m4a (iOS)

---

## Структура проекта

```
Backend-Fairy-Tales/
├── server.js                  # Точка входа
├── .env                       # Ключи, секреты
├── package.json
│
├── middleware/
│   ├── auth.js                # JWT проверка
│   └── upload.js              # Multer конфиг
│
├── routes/
│   ├── auth.js                # POST /api/auth/login
│   ├── voice.js               # POST /api/voice/clone, DELETE /api/voice
│   └── tales.js               # GET /api/tales, POST /api/tales/:id/narrate
│
├── services/
│   └── elevenlabs.js          # cloneVoice, textToSpeech, deleteVoice
│
├── data/
│   ├── tales/                 # Тексты сказок (JSON файлы)
│   │   ├── ru/
│   │   │   ├── kolobok.json
│   │   │   └── teremok.json
│   │   ├── en/
│   │   │   └── three-bears.json
│   │   └── index.json         # Каталог: id, title, lang, file
│   └── users.json             # userId → { voiceId, clonedAt }
│
└── utils/
    └── talesLoader.js         # Чтение/поиск сказок из data/tales
```

---

## API Endpoints

| Метод    | Путь                      | Auth | Описание                                  |
|----------|---------------------------|------|-------------------------------------------|
| `POST`   | `/api/auth/login`         | —    | Получить JWT токен                        |
| `POST`   | `/api/voice/clone`        | JWT  | Загрузить сэмпл → клонировать голос       |
| `DELETE` | `/api/voice`              | JWT  | Удалить клонированный голос               |
| `GET`    | `/api/tales`              | JWT  | Список сказок (фильтр по `?lang=ru`)     |
| `GET`    | `/api/tales/:id`          | JWT  | Детали одной сказки (текст, мета)         |
| `POST`   | `/api/tales/:id/narrate`  | JWT  | Озвучить сказку голосом юзера → аудио     |

---

## Формат данных

### Файл сказки (`data/tales/ru/kolobok.json`)

```json
{
  "id": "kolobok",
  "title": "Колобок",
  "lang": "ru",
  "text": "Жили-были старик со старухой..."
}
```

### Каталог сказок (`data/tales/index.json`)

```json
[
  { "id": "kolobok",     "title": "Колобок",        "lang": "ru", "file": "ru/kolobok.json" },
  { "id": "teremok",     "title": "Теремок",        "lang": "ru", "file": "ru/teremok.json" },
  { "id": "three-bears", "title": "Three Bears",     "lang": "en", "file": "en/three-bears.json" }
]
```

### Маппинг пользователей (`data/users.json`)

```json
{
  "user_123": {
    "voiceId": "elevenlabs_voice_id_abc",
    "clonedAt": "2026-03-09T12:00:00Z"
  }
}
```

---

## Конфигурация окружения (.env)

```
ELEVENLABS_API_KEY=your_api_key_here
JWT_SECRET=your_jwt_secret_here
PORT=3000
MAX_FILE_SIZE_MB=10
```

---

## ElevenLabs API — используемые эндпоинты

### 1. Клонирование голоса (Instant Voice Cloning)

```
POST https://api.elevenlabs.io/v1/voices/add
Headers: xi-api-key
Body (FormData):
  - name: "user_{userId}"
  - files: аудио-файл (mp3)
Response: { voice_id: "..." }
```

### 2. Text-to-Speech

```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
Headers: xi-api-key, Content-Type: application/json
Body:
  - text: "текст сказки"
  - model_id: "eleven_multilingual_v2"
  - voice_settings: { stability: 0.5, similarity_boost: 0.75 }
Response: audio/mpeg (binary)
```

### 3. Удаление голоса

```
DELETE https://api.elevenlabs.io/v1/voices/{voice_id}
Headers: xi-api-key
```

---

## Порядок реализации

| Шаг | Что делаем                          | Файлы                                    |
|-----|-------------------------------------|------------------------------------------|
| 1   | Настройка `.env`, базовый сервер    | `.env`, `server.js`                      |
| 2   | JWT авторизация                     | `middleware/auth.js`, `routes/auth.js`   |
| 3   | Multer для загрузки аудио           | `middleware/upload.js`                   |
| 4   | ElevenLabs сервис                   | `services/elevenlabs.js`                 |
| 5   | Клонирование голоса + кэш           | `routes/voice.js`, `data/users.json`     |
| 6   | Сказки: каталог и загрузчик         | `data/tales/`, `utils/talesLoader.js`    |
| 7   | Роуты сказок + озвучка              | `routes/tales.js`                        |
| 8   | Подключить всё в server.js          | `server.js`                              |

---

## Зависимости

### Установлено

- `express` — веб-фреймворк
- `multer` — загрузка файлов (multipart/form-data)
- `axios` — HTTP-клиент для ElevenLabs API
- `cors` — CORS для мобильного приложения
- `dotenv` — переменные окружения

### Нужно установить

- `jsonwebtoken` — JWT генерация и проверка
