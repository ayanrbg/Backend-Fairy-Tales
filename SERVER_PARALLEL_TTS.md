# Оптимизация: параллельная генерация TTS в narrate-all

## Проблема

Сейчас `narrate-all` генерирует страницы **последовательно**:
- 94 страницы × ~2-3 сек на страницу = **3-5 минут** ожидания
- Пользователь ждёт на экране прогресса

## Решение 1: Параллельная генерация (главный буст)

Генерировать N страниц одновременно (рекомендую 3-5 параллельных воркеров).

### Было (последовательно):
```js
for (const page of pages) {
    const audio = await generateTTS(page.text, voice);
    await savePage(taleId, page.index, audio);
    pagesReady++;
}
```

### Стало (параллельно, батчами по 5):
```js
const BATCH_SIZE = 5;

for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (page) => {
        const audio = await generateTTS(page.text, voice);
        await savePage(taleId, page.index, audio);
        pagesReady++;
    }));
}
```

**Результат**: 94 страницы при batch=5 → ~19 батчей × 3 сек = **~1 минута** вместо 5.

### Вариант с ограничением через семафор (более гибкий):
```js
const pLimit = require('p-limit');
const limit = pLimit(5); // максимум 5 параллельных запросов к TTS API

await Promise.all(pages.map((page) =>
    limit(async () => {
        const audio = await generateTTS(page.text, voice);
        await savePage(taleId, page.index, audio);
        pagesReady++;
    })
));
```

> Установить: `npm install p-limit`

## Решение 2: Снизить битрейт аудио

Для речи 64kbps MP3 звучит почти так же как 128kbps, но файлы в 2 раза меньше → быстрее скачивание.

В Edge TTS или Fish Audio найди параметр битрейта и поставь 64k или 48k.

Для edge-tts (если используется CLI):
```bash
edge-tts --rate="+0%" --text "..." --write-media output.mp3
# Файлы edge-tts уже достаточно компактные (~48kbps)
```

## Решение 3: Серверный кэш

Если одна и та же сказка + имя + пол + голос уже озвучена — отдавать готовые файлы.

```js
// Ключ кэша:
const cacheKey = `${taleId}_${lang}_${name}_${gender}_${voice || 'cloned'}`;

// Перед генерацией:
if (await cacheExists(cacheKey)) {
    // Скопировать из кэша, сразу status=done
    return;
}
```

## Что даст каждое решение

| Оптимизация | Эффект на скорость |
|-------------|-------------------|
| Параллельная генерация (×5) | **~5× быстрее** |
| Битрейт 64kbps | ~2× меньше размер → быстрее скачивание |
| Серверный кэш | **мгновенно** при повторном запросе |

## Рекомендация

Начни с **параллельной генерации** — это даст самый большой буст с минимальными изменениями. Потом добавь кэш.
