# Инструкция для Unity-клиента: новые сказки и система скачивания

## Что изменилось на сервере

1. Добавлены 5 новых сказок: `baursak`, `farhad`, `golden_egg`, `magic_bird`, `odeyalko` (каждая на 3 языках: ru, kz, uz)
2. Добавлены ещё 2 сказки из прошлых обновлений: `old_books`, `three_batyrs` (ru, kz, uz)
3. Иллюстрации сжаты (~200-400 KB на файл вместо ~2.5 MB)
4. API теперь возвращает новые поля: `free`, `bundled`, `downloadSize`
5. Обложки сказок хранятся на клиенте (сервер их не отдаёт для новых сказок)

---

## Сказки и их статус

| Сказка | ID | Free | Bundled | Иллюстрации | Размер (оба пола) |
|---|---|---|---|---|---|
| Золотое яичко | `golden_egg` | ✅ да | ✅ в клиенте | 84 файла | 30.4 MB |
| Фархад | `farhad` | ❌ нет | ✅ в клиенте | 175 файлов | 46.5 MB |
| Баурсак | `baursak` | ✅ да | ❌ сервер | 130 файлов | 52.4 MB |
| Одеялко | `odeyalko` | ✅ да | ❌ сервер | 147 файлов | 51.9 MB |
| Волшебная птица | `magic_bird` | ❌ нет | ❌ сервер | 218 файлов | 64.3 MB |
| Белый верблюжонок | `white_camel` | ❌ нет | ❌ сервер | 94 файла | 39.0 MB |

**Bundled** = иллюстрации встроены в билд Unity, скачивать не нужно.
**Free** = сказка доступна без подписки.

---

## Новый формат API

### GET /api/tales?lang=ru — список сказок

Каждая сказка теперь содержит три новых поля:

```json
{
  "id": "baursak",
  "title": "Баурсак",
  "lang": "ru",
  "free": true,
  "coverUrl": "/api/tales/baursak/cover",
  "bundled": false,
  "downloadSize": 54930744
}
```

```json
{
  "id": "golden_egg",
  "title": "Золотое яичко",
  "lang": "ru",
  "free": true,
  "coverUrl": "/api/tales/golden_egg/cover",
  "bundled": true
}
```

| Поле | Тип | Описание |
|---|---|---|
| `free` | bool | `true` — сказка бесплатная, доступна без подписки |
| `bundled` | bool | `true` — иллюстрации встроены в клиент, скачивать не нужно |
| `downloadSize` | long | Размер всех иллюстраций в байтах (оба пола). **Есть только если `bundled: false`**. Если `bundled: true` — поля нет вообще |

### GET /api/tales/:id?lang=ru — одна сказка

Те же новые поля + `genderedPages` как раньше:

```json
{
  "id": "baursak",
  "title": "Баурсак",
  "lang": "ru",
  "free": true,
  "totalPages": 72,
  "bundled": false,
  "downloadSize": 54930744,
  "pages": ["...", "..."],
  "genderedPages": [0, 1, 3, 5, 7, 10, ...]
}
```

---

## Что нужно сделать на клиенте

### 1. Обновить модели данных

```csharp
[Serializable]
public class TaleSummary
{
    public string id;
    public string title;
    public string lang;
    public bool free;           // бесплатная ли сказка
    public string coverUrl;
    public bool bundled;        // иллюстрации встроены в клиент
    public long downloadSize;   // размер в байтах (0 или отсутствует если bundled)
}

[Serializable]
public class TaleDetail
{
    public string id;
    public string title;
    public string lang;
    public bool free;
    public int totalPages;
    public string[] pages;
    public int[] genderedPages;
    public bool bundled;
    public long downloadSize;
}
```

### 2. Встроить иллюстрации bundled-сказок в билд

Скопировать с сервера папки:
- `data/illustrations/golden_egg/` → `Assets/StreamingAssets/Illustrations/golden_egg/`
- `data/illustrations/farhad/` → `Assets/StreamingAssets/Illustrations/farhad/`

Файлы уже сжаты, ничего обрабатывать не надо.

Структура файлов внутри папки:
```
golden_egg/
├── page_0_boy.jpg      ← гендерный вариант (мальчик)
├── page_0_girl.jpg     ← гендерный вариант (девочка)
├── page_1_boy.jpg
├── page_1_girl.jpg
├── page_2.jpg          ← общая иллюстрация (без гендера)
├── page_3_boy.jpg
├── page_3_girl.jpg
└── ...
```

**Важно:** не все страницы имеют иллюстрации, и не все имеют гендерные варианты. Список страниц с гендерными вариантами приходит в `genderedPages`.

### 3. Логика загрузки иллюстраций

```csharp
/// <summary>
/// Загрузить иллюстрацию для страницы.
/// Для bundled-сказок — из StreamingAssets, для серверных — с API.
/// </summary>
public IEnumerator LoadIllustration(TaleDetail tale, int page, string childGender,
                                     Action<Texture2D> onLoaded,
                                     Action onNotFound = null)
{
    // 1. Определить нужен ли гендерный вариант
    string genderSuffix = null;
    if (tale.genderedPages != null &&
        System.Array.IndexOf(tale.genderedPages, page) >= 0)
    {
        genderSuffix = childGender == "female" ? "girl" : "boy";
    }

    if (tale.bundled)
    {
        // === BUNDLED: загрузка из StreamingAssets ===
        string fileName = genderSuffix != null
            ? $"page_{page}_{genderSuffix}.jpg"
            : $"page_{page}.jpg";

        string filePath = Path.Combine(Application.streamingAssetsPath,
                                        "Illustrations", tale.id, fileName);
        string fileUri = "file:///" + filePath.Replace("\\", "/");

        using var request = UnityWebRequestTexture.GetTexture(fileUri);
        yield return request.SendWebRequest();

        if (request.result == UnityWebRequest.Result.Success)
            onLoaded?.Invoke(DownloadHandlerTexture.GetContent(request));
        else
            onNotFound?.Invoke();
    }
    else
    {
        // === СЕРВЕРНАЯ: проверяем кэш, потом скачиваем ===
        string cacheDir = Path.Combine(Application.persistentDataPath,
                                        "illustrations", tale.id);
        string cacheFileName = genderSuffix != null
            ? $"page_{page}_{genderSuffix}.jpg"
            : $"page_{page}.jpg";
        string cachePath = Path.Combine(cacheDir, cacheFileName);

        // Попробовать из кэша
        if (File.Exists(cachePath))
        {
            string cacheUri = "file:///" + cachePath.Replace("\\", "/");
            using var cacheReq = UnityWebRequestTexture.GetTexture(cacheUri);
            yield return cacheReq.SendWebRequest();

            if (cacheReq.result == UnityWebRequest.Result.Success)
            {
                onLoaded?.Invoke(DownloadHandlerTexture.GetContent(cacheReq));
                yield break;
            }
        }

        // Скачать с сервера
        string url = $"{_api.BaseUrl}/api/tales/{tale.id}/illustration/{page}";
        if (genderSuffix != null) url += $"?gender={genderSuffix}";

        using var webReq = UnityWebRequestTexture.GetTexture(url);
        webReq.SetRequestHeader("Authorization", $"Bearer {_token}");
        yield return webReq.SendWebRequest();

        if (webReq.result == UnityWebRequest.Result.Success)
        {
            var texture = DownloadHandlerTexture.GetContent(webReq);
            onLoaded?.Invoke(texture);

            // Сохранить в кэш
            Directory.CreateDirectory(cacheDir);
            File.WriteAllBytes(cachePath, webReq.downloadHandler.data);
        }
        else
        {
            onNotFound?.Invoke();
        }
    }
}
```

### 4. Предзагрузка серверной сказки целиком

Для серверных сказок можно скачать все иллюстрации заранее (кнопка "Скачать"). Показывай `downloadSize` в UI чтобы пользователь знал размер.

```csharp
/// <summary>
/// Скачать все иллюстрации сказки в кэш.
/// Вызывать для серверных сказок (bundled == false).
/// </summary>
public IEnumerator DownloadTaleIllustrations(TaleDetail tale, string childGender,
                                              Action<float> onProgress,
                                              Action onComplete)
{
    if (tale.bundled) { onComplete?.Invoke(); yield break; }

    string cacheDir = Path.Combine(Application.persistentDataPath,
                                    "illustrations", tale.id);
    Directory.CreateDirectory(cacheDir);

    int totalDownloaded = 0;
    int totalToDownload = 0;

    // Считаем сколько страниц нужно скачать
    for (int page = 0; page < tale.totalPages; page++)
    {
        bool hasGender = tale.genderedPages != null &&
                         System.Array.IndexOf(tale.genderedPages, page) >= 0;
        if (hasGender)
            totalToDownload += 2; // boy + girl
        else
            totalToDownload += 1;
    }

    for (int page = 0; page < tale.totalPages; page++)
    {
        bool hasGender = tale.genderedPages != null &&
                         System.Array.IndexOf(tale.genderedPages, page) >= 0;

        if (hasGender)
        {
            // Скачать оба варианта
            foreach (string gender in new[] { "boy", "girl" })
            {
                string fileName = $"page_{page}_{gender}.jpg";
                string cachePath = Path.Combine(cacheDir, fileName);

                if (!File.Exists(cachePath))
                {
                    string url = $"{_api.BaseUrl}/api/tales/{tale.id}/illustration/{page}?gender={gender}";
                    using var req = UnityWebRequest.Get(url);
                    req.SetRequestHeader("Authorization", $"Bearer {_token}");
                    yield return req.SendWebRequest();

                    if (req.result == UnityWebRequest.Result.Success)
                        File.WriteAllBytes(cachePath, req.downloadHandler.data);
                }

                totalDownloaded++;
                onProgress?.Invoke((float)totalDownloaded / totalToDownload);
            }
        }
        else
        {
            // Скачать общую иллюстрацию
            string fileName = $"page_{page}.jpg";
            string cachePath = Path.Combine(cacheDir, fileName);

            if (!File.Exists(cachePath))
            {
                string url = $"{_api.BaseUrl}/api/tales/{tale.id}/illustration/{page}";
                using var req = UnityWebRequest.Get(url);
                req.SetRequestHeader("Authorization", $"Bearer {_token}");
                yield return req.SendWebRequest();

                if (req.result == UnityWebRequest.Result.Success)
                    File.WriteAllBytes(cachePath, req.downloadHandler.data);
                // Если 404 — у страницы нет иллюстрации, это нормально
            }

            totalDownloaded++;
            onProgress?.Invoke((float)totalDownloaded / totalToDownload);
        }
    }

    onComplete?.Invoke();
}
```

### 5. UI списка сказок

```csharp
foreach (var tale in talesList)
{
    // ═══ Доступность ═══
    bool locked = !tale.free && !hasActiveSubscription;
    // Если locked — показать замок, не давать открыть

    // ═══ Статус скачивания ═══
    if (tale.bundled)
    {
        // Иллюстрации уже в приложении — показать "Готово" / зелёную галочку
        // Можно открыть сразу
    }
    else if (tale.downloadSize > 0)
    {
        // Проверить есть ли в кэше
        string cacheDir = Path.Combine(Application.persistentDataPath,
                                        "illustrations", tale.id);
        bool isDownloaded = Directory.Exists(cacheDir) &&
                            Directory.GetFiles(cacheDir, "*.jpg").Length > 0;

        if (isDownloaded)
        {
            // Уже скачана — показать "Готово"
        }
        else
        {
            // Не скачана — показать кнопку "Скачать"
            string sizeMB = (tale.downloadSize / 1024f / 1024f).ToString("F0");
            // Текст кнопки: "Скачать (52 MB)"

            // При нажатии — запустить DownloadTaleIllustrations
            // с прогресс-баром
        }
    }
    else
    {
        // downloadSize == 0 — у сказки нет иллюстраций (kolobok, teremok и т.д.)
    }
}
```

### 6. Обложки

Обложки для новых сказок на сервере **нет**. Обложки хранятся на клиенте. Положи их в ассеты (например `Resources/Covers/`) и загружай по `tale.id`.

Для старых сказок (white_camel) обложка по-прежнему доступна через `GET /api/tales/:id/cover`.

### 7. Озвучка

Логика озвучки **не изменилась**. Клиент по-прежнему:
1. Вызывает `POST /api/tales/:id/narrate?page=N&voice=narrator&lang=ru` с `{ "text": "..." }` для bundled-сказок
2. Или `POST /api/tales/:id/narrate?page=N&lang=ru` с `{ "name": "Имя", "gender": "male" }` для серверных сказок
3. Получает MP3 в ответе

Для полной озвучки книги — `POST /api/tales/:id/narrate-all` как раньше.

---

## Переименованные slug-и (ВАЖНО!)

Если в клиенте где-то хардкодились старые ID — обновить:

| Было | Стало |
|---|---|
| `farhad_and_gg` | `farhad` |
| `odyeyalko` | `odeyalko` |

Остальные slug-и не менялись.

---

## Чеклист

- [ ] Обновить модели `TaleSummary` и `TaleDetail` (добавить `free`, `bundled`, `downloadSize`)
- [ ] Скопировать иллюстрации `golden_egg` и `farhad` в `StreamingAssets/Illustrations/`
- [ ] Добавить обложки новых сказок в ассеты клиента
- [ ] Реализовать логику: bundled → из StreamingAssets, серверная → скачать/кэш
- [ ] В UI списка: показывать замок (locked), кнопку скачивания с размером, или "Готово"
- [ ] Реализовать скачивание сказки целиком с прогресс-баром
- [ ] Кэшировать скачанные иллюстрации в `persistentDataPath`
- [ ] Обновить хардкодные slug-и если есть (`farhad_and_gg` → `farhad`, `odyeyalko` → `odeyalko`)
- [ ] Протестировать: bundled-сказка открывается без интернета
- [ ] Протестировать: серверная сказка скачивается, кэшируется, открывается из кэша
