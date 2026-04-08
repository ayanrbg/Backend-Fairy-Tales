# План миграции TTS: ElevenLabs → Fish Audio + Edge TTS

## Цель

Заменить ElevenLabs на:
- **Edge TTS** — бесплатная дефолтная озвучка (все языки: ru, uz, kz, en)
- **Fish Audio** — клонирование голоса пользователя (ru, kz)

Для uz клонирования нет (Fish Audio не поддерживает узбекский), только Edge TTS дефолтный.

## Причины миграции

- ElevenLabs не поддерживает узбекский язык в voice cloning
- Дорого: $5/мес = ~3 сказки. Нужно обслуживать всех пользователей
- Fish Audio: ~$0.07 за длинную сказку (~20x дешевле)
- Edge TTS: бесплатно для дефолтного диктора

## Контракт эндпоинтов (НЕ МЕНЯЕТСЯ)

| Эндпоинт | Изменения для клиента |
|----------|----------------------|
| POST /api/voice/clone | Нет (тот же request/response) |
| DELETE /api/voice | Нет |
| POST /api/tales/:id/narrate | Нет |
| POST /api/tales/:id/narrate-all | Нет |
| GET /api/tales/:id/narration-status | Нет |
| GET /api/tales/:id/narration/:page | Нет |
| GET /api/tales/:id/default-narration/* | Нет |

---

## Шаги реализации

### Шаг 1: `services/edgeTts.js` — Edge TTS сервис

- npm пакет: `edge-tts`
- Функция `textToSpeech(text, lang, gender)` → MP3 buffer
- Маппинг голосов по языкам:
  - `ru` → `ru-RU-DmitryNeural` (муж) / `ru-RU-SvetlanaNeural` (жен)
  - `uz` → `uz-UZ-SardorNeural` (муж) / `uz-UZ-MadinaNeural` (жен)
  - `kz` → `kk-KZ-DauletNeural` (муж) / `kk-KZ-AigulNeural` (жен)
  - `en` → `en-US-GuyNeural` (муж) / `en-US-JennyNeural` (жен)
- Стоимость: $0

### Шаг 2: `services/fishAudio.js` — Fish Audio сервис

- Заменяет `services/elevenlabs.js`
- Функции (та же сигнатура что у elevenlabs):
  - `cloneVoice(audioBuffer, originalName, userId)` → voice_id
  - `textToSpeech(voiceId, text)` → MP3 buffer
  - `deleteVoice(voiceId)`
- Env: `FISH_AUDIO_API_KEY`

### Шаг 3: `services/tts.js` — Единый TTS роутер

```js
async function textToSpeech({ text, lang, voiceType, voiceId, gender }) {
  if (voiceType === 'cloned') {
    return fishAudio.textToSpeech(voiceId, text);
  }
  // дефолтный диктор — Edge TTS (бесплатно)
  return edgeTts.textToSpeech(text, lang, gender);
}
```

### Шаг 4: Обновление `routes/tales.js`

- Заменить `require('../services/elevenlabs')` → `require('../services/tts')`
- POST /narrate:
  - `voice=narrator` → Edge TTS (вместо ElevenLabs narrator)
  - без voice → Fish Audio с клонированным голосом
- POST /narrate-all — аналогично
- Убрать зависимость от `NARRATOR_VOICE_ID`

### Шаг 5: Обновление `routes/voice.js`

- Заменить `require('../services/elevenlabs')` → `require('../services/fishAudio')`
- POST /clone — Fish Audio cloneVoice
- DELETE /voice — Fish Audio deleteVoice
- Контракт не меняется

### Шаг 6: Обновление `.env`

```
# Удалить:
ELEVENLABS_API_KEY=...
NARRATOR_VOICE_ID=...

# Добавить:
FISH_AUDIO_API_KEY=...
```

### Шаг 7: Установка зависимостей

```bash
npm install edge-tts
```

### ~~Шаг 8: `scripts/generateDefaultNarration.js`~~ — ОТМЕНЁН

Пре-генерация дефолтных озвучек невозможна: текст сказок содержит плейсхолдеры `{childName}` и `{m:...|f:...}`, которые зависят от имени и пола ребёнка конкретного пользователя.

**Решение:** вся озвучка (и Edge TTS, и Fish Audio) генерируется **на лету** через эндпоинты `/narrate` и `/narrate-all`. Эндпоинты `GET /default-narration/*` больше не нужны — можно удалить в будущем.

---

## Архитектура после миграции

```
Клиент
  │
  ├── voice=narrator ──→ services/tts.js ──→ services/edgeTts.js (бесплатно)
  │                                           ├── ru: DmitryNeural/SvetlanaNeural
  │                                           ├── uz: SardorNeural/MadinaNeural
  │                                           ├── kz: DauletNeural/AigulNeural
  │                                           └── en: GuyNeural/JennyNeural
  │
  ├── voice=cloned ────→ services/tts.js ──→ services/fishAudio.js ($0.015/1K символов)
  │                                           └── ru, kz (uz не поддерживается)
  │
  └── /clone ──────────→ routes/voice.js ──→ services/fishAudio.js
```
