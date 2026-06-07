# Интеграция Backend Fairy Tales в Unity (C#)

## Содержание

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Подготовка Unity-проекта](#2-подготовка-unity-проекта)
3. [API-клиент — базовый класс](#3-api-клиент--базовый-класс)
4. [Модели данных](#4-модели-данных)
5. [Сервис аутентификации](#5-сервис-аутентификации)
6. [Сервис голоса](#6-сервис-голоса)
7. [Сервис сказок](#7-сервис-сказок)
8. [Сервис промокодов](#8-сервис-промокодов)
9. [Воспроизведение озвучки](#9-воспроизведение-озвучки)
10. [Запись голоса с микрофона](#10-запись-голоса-с-микрофона)
11. [Пример полного флоу](#11-пример-полного-флоу)
12. [Гендерные иллюстрации](#12-гендерные-иллюстрации)
13. [Обработка ошибок](#13-обработка-ошибок)
14. [Советы по продакшену](#14-советы-по-продакшену)

---

## 1. Обзор архитектуры

```
Unity Game (C#)
    │
    ├─ AuthService       → POST /api/auth/login
    ├─ VoiceService      → POST /api/voice/clone
    │                      DELETE /api/voice
    ├─ TalesService      → GET  /api/tales?lang=ru
    │                      GET  /api/tales/:id
    ├─ NarrationService  → POST /api/tales/:id/narrate?page=N
    │                         ↓
    │                    AudioSource.Play()
    └─ PromoService      → POST /api/promo/check
                           POST /api/promo/purchase
```

**Сервер:** `http://localhost:3000` (или ваш продакшен-адрес)

---

## 2. Подготовка Unity-проекта

### Структура папок

```
Assets/
└── Scripts/
    └── FairyTales/
        ├── Api/
        │   ├── ApiClient.cs          // Базовый HTTP-клиент
        │   ├── AuthService.cs        // Аутентификация
        │   ├── VoiceService.cs       // Клонирование голоса
        │   ├── TalesService.cs       // Сказки и озвучка
        │   └── PromoService.cs       // Промокоды
        ├── Models/
        │   ├── AuthModels.cs         // DTO аутентификации
        │   ├── VoiceModels.cs        // DTO голоса
        │   ├── TaleModels.cs         // DTO сказок
        │   └── PromoModels.cs        // DTO промокодов
        ├── Audio/
        │   ├── MicRecorder.cs        // Запись с микрофона
        │   └── NarrationPlayer.cs    // Воспроизведение озвучки
        └── FairyTaleManager.cs       // Главный менеджер (фасад)
```

### Зависимости

Unity имеет встроенный `UnityWebRequest` — дополнительные пакеты **не нужны**.
Для JSON используется встроенный `JsonUtility` (или Newtonsoft Json — через Package Manager).

> **Рекомендация:** установите `com.unity.nuget.newtonsoft-json` через Window → Package Manager → Add by name. Он лучше работает с массивами и вложенными объектами.

---

## 3. API-клиент — базовый класс

```csharp
// Assets/Scripts/FairyTales/Api/ApiClient.cs
using System;
using System.Text;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace FairyTales.Api
{
    public class ApiClient : MonoBehaviour
    {
        [SerializeField] private string baseUrl = "http://localhost:3000";

        private string _token;

        public string BaseUrl => baseUrl;

        public void SetToken(string token)
        {
            _token = token;
        }

        public bool HasToken => !string.IsNullOrEmpty(_token);

        // ── GET (JSON) ──────────────────────────────────────
        public IEnumerator Get(string endpoint, Action<string> onSuccess,
                               Action<string> onError = null)
        {
            using var request = UnityWebRequest.Get($"{baseUrl}{endpoint}");
            ApplyAuth(request);

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                onSuccess?.Invoke(request.downloadHandler.text);
            else
                onError?.Invoke(ParseError(request));
        }

        // ── POST (JSON) ─────────────────────────────────────
        public IEnumerator PostJson(string endpoint, string jsonBody,
                                    Action<string> onSuccess,
                                    Action<string> onError = null)
        {
            using var request = new UnityWebRequest($"{baseUrl}{endpoint}", "POST");
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonBody);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            ApplyAuth(request);

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                onSuccess?.Invoke(request.downloadHandler.text);
            else
                onError?.Invoke(ParseError(request));
        }

        // ── POST (multipart/form-data — для загрузки аудио) ─
        public IEnumerator PostMultipart(string endpoint, byte[] fileData,
                                         string fileName, string fieldName,
                                         string mimeType,
                                         Action<string> onSuccess,
                                         Action<string> onError = null)
        {
            var form = new WWWForm();
            form.AddBinaryData(fieldName, fileData, fileName, mimeType);

            using var request = UnityWebRequest.Post($"{baseUrl}{endpoint}", form);
            ApplyAuth(request);

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                onSuccess?.Invoke(request.downloadHandler.text);
            else
                onError?.Invoke(ParseError(request));
        }

        // ── POST (получить бинарные данные — аудио) ──────────
        public IEnumerator PostForAudio(string endpoint,
                                        Action<byte[]> onSuccess,
                                        Action<string> onError = null)
        {
            using var request = new UnityWebRequest($"{baseUrl}{endpoint}", "POST");
            request.downloadHandler = new DownloadHandlerBuffer();
            ApplyAuth(request);

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                onSuccess?.Invoke(request.downloadHandler.data);
            else
                onError?.Invoke(ParseError(request));
        }

        // ── DELETE ───────────────────────────────────────────
        public IEnumerator Delete(string endpoint, Action<string> onSuccess,
                                  Action<string> onError = null)
        {
            using var request = UnityWebRequest.Delete($"{baseUrl}{endpoint}");
            request.downloadHandler = new DownloadHandlerBuffer();
            ApplyAuth(request);

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                onSuccess?.Invoke(request.downloadHandler.text);
            else
                onError?.Invoke(ParseError(request));
        }

        // ── Helpers ──────────────────────────────────────────
        private void ApplyAuth(UnityWebRequest request)
        {
            if (!string.IsNullOrEmpty(_token))
                request.SetRequestHeader("Authorization", $"Bearer {_token}");
        }

        private string ParseError(UnityWebRequest request)
        {
            string body = request.downloadHandler?.text ?? "";
            return $"[{request.responseCode}] {request.error} — {body}";
        }
    }
}
```

---

## 4. Модели данных

```csharp
// Assets/Scripts/FairyTales/Models/AuthModels.cs
using System;

namespace FairyTales.Models
{
    [Serializable]
    public class LoginRequest
    {
        public string userId;
    }

    [Serializable]
    public class LoginResponse
    {
        public string token;
    }
}
```

```csharp
// Assets/Scripts/FairyTales/Models/VoiceModels.cs
using System;

namespace FairyTales.Models
{
    [Serializable]
    public class CloneResponse
    {
        public string voiceId;
        public string status;
    }

    [Serializable]
    public class DeleteVoiceResponse
    {
        public string status;
    }
}
```

```csharp
// Assets/Scripts/FairyTales/Models/TaleModels.cs
using System;

namespace FairyTales.Models
{
    [Serializable]
    public class TaleSummary
    {
        public string id;
        public string title;
        public string lang;
    }

    // Обёртка для JsonUtility (не умеет парсить массив верхнего уровня)
    [Serializable]
    public class TaleSummaryList
    {
        public TaleSummary[] items;
    }

    [Serializable]
    public class TaleDetail
    {
        public string id;
        public string title;
        public string lang;
        public int totalPages;
        public string[] pages;
    }
}
```

```csharp
// Assets/Scripts/FairyTales/Models/PromoModels.cs
using System;

namespace FairyTales.Models
{
    [Serializable]
    public class PromoCheckRequest
    {
        public string code;
    }

    [Serializable]
    public class PromoCheckResponse
    {
        public string type;        // "blogger" или "premium"
        public string bloggerName; // только для type === "blogger"
        public int durationDays;   // только для type === "premium"
        public string expiresAt;   // только для type === "premium"
        public string message;
    }

    [Serializable]
    public class PromoErrorResponse
    {
        public string error;
    }

    [Serializable]
    public class PromoPurchaseResponse
    {
        public bool success;
    }
}
```

---

## 5. Сервис аутентификации

```csharp
// Assets/Scripts/FairyTales/Api/AuthService.cs
using System;
using System.Collections;
using FairyTales.Models;
using UnityEngine;

namespace FairyTales.Api
{
    public class AuthService
    {
        private readonly ApiClient _api;

        public AuthService(ApiClient api)
        {
            _api = api;
        }

        /// <summary>
        /// Залогиниться по userId. Токен сохраняется автоматически.
        /// </summary>
        public IEnumerator Login(string userId,
                                 Action onSuccess = null,
                                 Action<string> onError = null)
        {
            var body = JsonUtility.ToJson(new LoginRequest { userId = userId });

            yield return _api.PostJson("/api/auth/login", body,
                json =>
                {
                    var response = JsonUtility.FromJson<LoginResponse>(json);
                    _api.SetToken(response.token);

                    // Сохраняем токен локально для повторных запусков
                    PlayerPrefs.SetString("ft_token", response.token);
                    PlayerPrefs.SetString("ft_userId", userId);
                    PlayerPrefs.Save();

                    onSuccess?.Invoke();
                },
                onError
            );
        }

        /// <summary>
        /// Попытаться восстановить сессию из PlayerPrefs.
        /// </summary>
        public bool TryRestoreSession()
        {
            string token = PlayerPrefs.GetString("ft_token", "");
            if (string.IsNullOrEmpty(token)) return false;

            _api.SetToken(token);
            return true;
        }

        public void Logout()
        {
            _api.SetToken(null);
            PlayerPrefs.DeleteKey("ft_token");
            PlayerPrefs.DeleteKey("ft_userId");
        }
    }
}
```

---

## 6. Сервис голоса

```csharp
// Assets/Scripts/FairyTales/Api/VoiceService.cs
using System;
using System.Collections;
using FairyTales.Models;
using UnityEngine;

namespace FairyTales.Api
{
    public class VoiceService
    {
        private readonly ApiClient _api;

        public VoiceService(ApiClient api)
        {
            _api = api;
        }

        /// <summary>
        /// Отправить аудиофайл для клонирования голоса.
        /// fileData — WAV/MP3 байты, fileName — например "voice.wav"
        /// </summary>
        public IEnumerator CloneVoice(byte[] fileData, string fileName,
                                      Action<CloneResponse> onSuccess,
                                      Action<string> onError = null)
        {
            string mime = fileName.EndsWith(".wav") ? "audio/wav" : "audio/mpeg";

            yield return _api.PostMultipart("/api/voice/clone",
                fileData, fileName, "voiceSample", mime,
                json =>
                {
                    var response = JsonUtility.FromJson<CloneResponse>(json);
                    Debug.Log($"Voice cloned: {response.voiceId}");
                    onSuccess?.Invoke(response);
                },
                onError
            );
        }

        /// <summary>
        /// Удалить клонированный голос.
        /// </summary>
        public IEnumerator DeleteVoice(Action onSuccess = null,
                                       Action<string> onError = null)
        {
            yield return _api.Delete("/api/voice",
                json =>
                {
                    Debug.Log("Voice deleted");
                    onSuccess?.Invoke();
                },
                onError
            );
        }
    }
}
```

---

## 7. Сервис сказок

```csharp
// Assets/Scripts/FairyTales/Api/TalesService.cs
using System;
using System.Collections;
using FairyTales.Models;
using UnityEngine;
using Newtonsoft.Json; // если установлен, иначе см. альтернативу ниже

namespace FairyTales.Api
{
    public class TalesService
    {
        private readonly ApiClient _api;

        public TalesService(ApiClient api)
        {
            _api = api;
        }

        /// <summary>
        /// Получить список сказок. lang = "ru", "en" или null для всех.
        /// </summary>
        public IEnumerator GetTales(string lang,
                                    Action<TaleSummary[]> onSuccess,
                                    Action<string> onError = null)
        {
            string query = string.IsNullOrEmpty(lang) ? "" : $"?lang={lang}";

            yield return _api.Get($"/api/tales{query}",
                json =>
                {
                    // Newtonsoft умеет парсить массив верхнего уровня
                    var tales = JsonConvert.DeserializeObject<TaleSummary[]>(json);
                    onSuccess?.Invoke(tales);
                },
                onError
            );
        }

        /// <summary>
        /// Получить конкретную сказку со всеми страницами.
        /// </summary>
        public IEnumerator GetTale(string taleId,
                                   Action<TaleDetail> onSuccess,
                                   Action<string> onError = null)
        {
            yield return _api.Get($"/api/tales/{taleId}",
                json =>
                {
                    var tale = JsonConvert.DeserializeObject<TaleDetail>(json);
                    onSuccess?.Invoke(tale);
                },
                onError
            );
        }

        /// <summary>
        /// Озвучить страницу сказки. Возвращает MP3-байты.
        /// </summary>
        public IEnumerator NarratePage(string taleId, int page,
                                       Action<byte[]> onSuccess,
                                       Action<string> onError = null)
        {
            yield return _api.PostForAudio(
                $"/api/tales/{taleId}/narrate?page={page}",
                onSuccess,
                onError
            );
        }
    }
}
```

### Альтернатива без Newtonsoft (только JsonUtility)

Если не хотите ставить Newtonsoft, оберните массив вручную:

```csharp
// Вместо JsonConvert.DeserializeObject<TaleSummary[]>(json):
var wrapped = JsonUtility.FromJson<TaleSummaryList>(
    "{\"items\":" + json + "}"
);
TaleSummary[] tales = wrapped.items;
```

---

## 8. Сервис промокодов

```csharp
// Assets/Scripts/FairyTales/Api/PromoService.cs
using System;
using System.Collections;
using FairyTales.Models;
using UnityEngine;

namespace FairyTales.Api
{
    public class PromoService
    {
        private readonly ApiClient _api;

        public PromoService(ApiClient api)
        {
            _api = api;
        }

        /// <summary>
        /// Проверить промокод. Для премиум-кодов подписка активируется автоматически на сервере.
        /// </summary>
        public IEnumerator CheckPromo(string code,
                                       Action<PromoCheckResponse> onSuccess,
                                       Action<string> onError = null)
        {
            var body = JsonUtility.ToJson(new PromoCheckRequest { code = code });

            yield return _api.PostJson("/api/promo/check", body,
                json =>
                {
                    var response = JsonUtility.FromJson<PromoCheckResponse>(json);
                    Debug.Log($"Promo check: {response.type} — {response.message}");
                    onSuccess?.Invoke(response);
                },
                onError
            );
        }

        /// <summary>
        /// Зафиксировать покупку по блогерскому промокоду.
        /// Вызывать ТОЛЬКО для type === "blogger" после успешной оплаты.
        /// </summary>
        public IEnumerator ReportPurchase(string code,
                                           Action<PromoPurchaseResponse> onSuccess,
                                           Action<string> onError = null)
        {
            var body = JsonUtility.ToJson(new PromoCheckRequest { code = code });

            yield return _api.PostJson("/api/promo/purchase", body,
                json =>
                {
                    var response = JsonUtility.FromJson<PromoPurchaseResponse>(json);
                    Debug.Log("Promo purchase reported");
                    onSuccess?.Invoke(response);
                },
                onError
            );
        }
    }
}
```

### Логика на клиенте

| Тип ответа | Действие |
|---|---|
| `type === "premium"` | Подписка уже активирована на сервере. Показать `message`, обновить статус подписки (дата окончания в `expiresAt`). Вызывать `/purchase` **не нужно**. |
| `type === "blogger"` | Показать `message`, запомнить `code`. После успешной оплаты подписки вызвать `ReportPurchase(code)`. |
| Ошибка (400/404/410) | Распарсить `PromoErrorResponse`, показать `error` пользователю. |

---

## 9. Воспроизведение озвучки

```csharp
// Assets/Scripts/FairyTales/Audio/NarrationPlayer.cs
using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace FairyTales.Audio
{
    [RequireComponent(typeof(AudioSource))]
    public class NarrationPlayer : MonoBehaviour
    {
        private AudioSource _audioSource;

        private void Awake()
        {
            _audioSource = GetComponent<AudioSource>();
        }

        /// <summary>
        /// Воспроизвести MP3 из байтового массива.
        /// MP3 → сохраняем во временный файл → загружаем через UnityWebRequest.
        /// </summary>
        public IEnumerator PlayMp3(byte[] mp3Data, Action onFinished = null)
        {
            // Сохраняем во временный файл (Unity не умеет декодировать MP3 из памяти)
            string tempPath = Path.Combine(Application.temporaryCachePath,
                                           $"narration_{Guid.NewGuid()}.mp3");
            File.WriteAllBytes(tempPath, mp3Data);

            // Загружаем как AudioClip
            string fileUri = "file:///" + tempPath.Replace("\\", "/");
            using var request = UnityWebRequestMultimedia.GetAudioClip(
                fileUri, AudioType.MPEG);

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                var clip = DownloadHandlerAudioClip.GetContent(request);
                _audioSource.clip = clip;
                _audioSource.Play();

                // Ждём окончания воспроизведения
                yield return new WaitForSeconds(clip.length);
                onFinished?.Invoke();
            }
            else
            {
                Debug.LogError($"Failed to load audio: {request.error}");
            }

            // Чистим временный файл
            if (File.Exists(tempPath))
                File.Delete(tempPath);
        }

        public void Stop()
        {
            _audioSource.Stop();
        }

        public bool IsPlaying => _audioSource.isPlaying;
    }
}
```

---

## 10. Запись голоса с микрофона

```csharp
// Assets/Scripts/FairyTales/Audio/MicRecorder.cs
using System;
using System.IO;
using UnityEngine;

namespace FairyTales.Audio
{
    public class MicRecorder : MonoBehaviour
    {
        private AudioClip _recording;
        private string _micDevice;
        private bool _isRecording;

        [SerializeField] private int maxDurationSec = 30;
        [SerializeField] private int sampleRate = 44100;

        public bool IsRecording => _isRecording;

        /// <summary>
        /// Начать запись с микрофона.
        /// </summary>
        public void StartRecording()
        {
            if (_isRecording) return;

            // Берём первый доступный микрофон
            if (Microphone.devices.Length == 0)
            {
                Debug.LogError("No microphone found!");
                return;
            }

            _micDevice = Microphone.devices[0];
            _recording = Microphone.Start(_micDevice, false,
                                          maxDurationSec, sampleRate);
            _isRecording = true;
            Debug.Log($"Recording started (mic: {_micDevice})");
        }

        /// <summary>
        /// Остановить запись и получить WAV-байты.
        /// </summary>
        public byte[] StopRecording()
        {
            if (!_isRecording) return null;

            int position = Microphone.GetPosition(_micDevice);
            Microphone.End(_micDevice);
            _isRecording = false;

            if (position == 0)
            {
                Debug.LogWarning("No audio recorded");
                return null;
            }

            // Обрезаем до реальной длины
            float[] samples = new float[position * _recording.channels];
            _recording.GetData(samples, 0);

            byte[] wavData = EncodeToWav(samples, _recording.channels, sampleRate);
            Debug.Log($"Recording stopped: {wavData.Length} bytes");
            return wavData;
        }

        /// <summary>
        /// Кодирование float[] сэмплов в WAV-формат.
        /// </summary>
        private static byte[] EncodeToWav(float[] samples, int channels,
                                           int sampleRate)
        {
            using var stream = new MemoryStream();
            using var writer = new BinaryWriter(stream);

            int bitsPerSample = 16;
            int byteRate = sampleRate * channels * bitsPerSample / 8;
            int blockAlign = channels * bitsPerSample / 8;
            int dataSize = samples.Length * bitsPerSample / 8;

            // RIFF header
            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            writer.Write(36 + dataSize);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));

            // fmt chunk
            writer.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
            writer.Write(16);                   // chunk size
            writer.Write((short)1);             // PCM
            writer.Write((short)channels);
            writer.Write(sampleRate);
            writer.Write(byteRate);
            writer.Write((short)blockAlign);
            writer.Write((short)bitsPerSample);

            // data chunk
            writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            writer.Write(dataSize);

            foreach (float sample in samples)
            {
                short intSample = (short)(Mathf.Clamp(sample, -1f, 1f) * short.MaxValue);
                writer.Write(intSample);
            }

            return stream.ToArray();
        }
    }
}
```

---

## 11. Пример полного флоу

```csharp
// Assets/Scripts/FairyTales/FairyTaleManager.cs
using System.Collections;
using FairyTales.Api;
using FairyTales.Audio;
using FairyTales.Models;
using UnityEngine;

namespace FairyTales
{
    public class FairyTaleManager : MonoBehaviour
    {
        [Header("Settings")]
        [SerializeField] private string userId = "player_001";
        [SerializeField] private string language = "ru";

        [Header("References")]
        [SerializeField] private ApiClient apiClient;
        [SerializeField] private MicRecorder micRecorder;
        [SerializeField] private NarrationPlayer narrationPlayer;

        private AuthService _auth;
        private VoiceService _voice;
        private TalesService _tales;
        private PromoService _promo;

        // Текущее состояние
        private TaleSummary[] _talesList;
        private TaleDetail _currentTale;
        private int _currentPage;
        private bool _hasVoice;
        private string _appliedBloggerCode; // запомненный блогерский промокод

        private void Start()
        {
            _auth = new AuthService(apiClient);
            _voice = new VoiceService(apiClient);
            _tales = new TalesService(apiClient);
            _promo = new PromoService(apiClient);

            // Попробовать восстановить сессию
            if (!_auth.TryRestoreSession())
                StartCoroutine(LoginFlow());
            else
                StartCoroutine(LoadTales());
        }

        // ══════════════════════════════════════════════════════
        //  1. ЛОГИН
        // ══════════════════════════════════════════════════════
        private IEnumerator LoginFlow()
        {
            Debug.Log("Logging in...");
            yield return _auth.Login(userId,
                onSuccess: () => Debug.Log("Logged in!"),
                onError: err => Debug.LogError($"Login failed: {err}")
            );

            if (apiClient.HasToken)
                yield return LoadTales();
        }

        // ══════════════════════════════════════════════════════
        //  2. ЗАГРУЗКА СПИСКА СКАЗОК
        // ══════════════════════════════════════════════════════
        private IEnumerator LoadTales()
        {
            Debug.Log("Loading tales...");
            yield return _tales.GetTales(language,
                tales =>
                {
                    _talesList = tales;
                    Debug.Log($"Loaded {tales.Length} tales");
                    foreach (var t in tales)
                        Debug.Log($"  - {t.title} ({t.lang})");
                },
                err => Debug.LogError($"Failed to load tales: {err}")
            );
        }

        // ══════════════════════════════════════════════════════
        //  3. КЛОНИРОВАНИЕ ГОЛОСА (вызов из UI)
        // ══════════════════════════════════════════════════════

        /// <summary>Начать запись голоса (привязать к кнопке "Записать")</summary>
        public void OnStartRecording()
        {
            micRecorder.StartRecording();
        }

        /// <summary>Остановить запись и отправить на клонирование (кнопка "Стоп")</summary>
        public void OnStopRecordingAndClone()
        {
            byte[] wavData = micRecorder.StopRecording();
            if (wavData != null)
                StartCoroutine(CloneVoiceFlow(wavData));
        }

        private IEnumerator CloneVoiceFlow(byte[] wavData)
        {
            Debug.Log("Cloning voice...");
            yield return _voice.CloneVoice(wavData, "voice.wav",
                response =>
                {
                    _hasVoice = true;
                    Debug.Log($"Voice cloned! ID: {response.voiceId}");
                },
                err => Debug.LogError($"Clone failed: {err}")
            );
        }

        // ══════════════════════════════════════════════════════
        //  4. ВЫБОР СКАЗКИ И НАВИГАЦИЯ ПО СТРАНИЦАМ
        // ══════════════════════════════════════════════════════

        /// <summary>Выбрать сказку по индексу из списка</summary>
        public void SelectTale(int index)
        {
            if (_talesList == null || index >= _talesList.Length) return;
            StartCoroutine(LoadTaleDetail(_talesList[index].id));
        }

        /// <summary>Выбрать сказку по ID (например "kolobok")</summary>
        public void SelectTale(string taleId)
        {
            StartCoroutine(LoadTaleDetail(taleId));
        }

        private IEnumerator LoadTaleDetail(string taleId)
        {
            yield return _tales.GetTale(taleId,
                tale =>
                {
                    _currentTale = tale;
                    _currentPage = 0;
                    Debug.Log($"Selected: {tale.title} ({tale.totalPages} pages)");
                },
                err => Debug.LogError($"Failed to load tale: {err}")
            );
        }

        // ══════════════════════════════════════════════════════
        //  5. ОЗВУЧКА ТЕКУЩЕЙ СТРАНИЦЫ
        // ══════════════════════════════════════════════════════

        /// <summary>Озвучить текущую страницу (кнопка "Слушать")</summary>
        public void NarrateCurrentPage()
        {
            if (_currentTale == null) return;
            StartCoroutine(NarrateFlow());
        }

        private IEnumerator NarrateFlow()
        {
            Debug.Log($"Narrating page {_currentPage}...");
            // Показываем текст страницы (для UI)
            string pageText = _currentTale.pages[_currentPage];
            Debug.Log($"Text: {pageText}");

            byte[] audioData = null;

            yield return _tales.NarratePage(
                _currentTale.id, _currentPage,
                data => audioData = data,
                err => Debug.LogError($"Narration failed: {err}")
            );

            if (audioData != null)
            {
                yield return narrationPlayer.PlayMp3(audioData, () =>
                {
                    Debug.Log("Narration finished");
                });
            }
        }

        /// <summary>Следующая страница</summary>
        public void NextPage()
        {
            if (_currentTale == null) return;
            if (_currentPage < _currentTale.totalPages - 1)
            {
                _currentPage++;
                Debug.Log($"Page {_currentPage}: {_currentTale.pages[_currentPage]}");
            }
        }

        /// <summary>Предыдущая страница</summary>
        public void PreviousPage()
        {
            if (_currentPage > 0)
            {
                _currentPage--;
                Debug.Log($"Page {_currentPage}: {_currentTale.pages[_currentPage]}");
            }
        }

        // ══════════════════════════════════════════════════════
        //  6. ПРОМОКОДЫ
        // ══════════════════════════════════════════════════════

        /// <summary>Применить промокод (кнопка "Применить")</summary>
        public void ApplyPromoCode(string code)
        {
            StartCoroutine(PromoCheckFlow(code));
        }

        private IEnumerator PromoCheckFlow(string code)
        {
            yield return _promo.CheckPromo(code,
                response =>
                {
                    if (response.type == "premium")
                    {
                        // Подписка уже активирована на сервере
                        Debug.Log($"Premium activated: {response.message}, expires: {response.expiresAt}");
                        // TODO: обновить UI подписки
                    }
                    else if (response.type == "blogger")
                    {
                        // Запоминаем код — отправим при покупке
                        _appliedBloggerCode = code;
                        Debug.Log($"Blogger promo applied: {response.message}");
                        // TODO: показать сообщение в UI
                    }
                },
                err => Debug.LogError($"Promo error: {err}")
            );
        }

        /// <summary>
        /// Вызвать после успешной оплаты подписки, если был применён блогерский промокод.
        /// </summary>
        public void ReportPurchaseIfNeeded()
        {
            if (string.IsNullOrEmpty(_appliedBloggerCode)) return;
            StartCoroutine(PurchaseFlow());
        }

        private IEnumerator PurchaseFlow()
        {
            string code = _appliedBloggerCode;
            _appliedBloggerCode = null;

            yield return _promo.ReportPurchase(code,
                response => Debug.Log("Purchase reported to promo system"),
                err => Debug.LogError($"Purchase report error: {err}")
            );
        }

        // ══════════════════════════════════════════════════════
        //  ПУБЛИЧНЫЕ СВОЙСТВА ДЛЯ UI
        // ══════════════════════════════════════════════════════

        public TaleSummary[] TalesList => _talesList;
        public TaleDetail CurrentTale => _currentTale;
        public int CurrentPage => _currentPage;
        public string CurrentPageText =>
            _currentTale?.pages != null && _currentPage < _currentTale.pages.Length
                ? _currentTale.pages[_currentPage]
                : "";
        public bool HasVoice => _hasVoice;
        public bool IsPlaying => narrationPlayer != null && narrationPlayer.IsPlaying;
    }
}
```

### Настройка сцены

1. Создайте пустой GameObject → назовите **FairyTaleSystem**
2. Добавьте компоненты:
   - `ApiClient` (задайте URL сервера)
   - `MicRecorder`
   - `NarrationPlayer` (добавится `AudioSource` автоматически)
   - `FairyTaleManager` (перетащите ссылки на остальные компоненты)
3. Привяжите UI-кнопки к методам `FairyTaleManager`:
   - "Записать голос" → `OnStartRecording()`
   - "Стоп/Отправить" → `OnStopRecordingAndClone()`
   - "Слушать" → `NarrateCurrentPage()`
   - "Далее" → `NextPage()`
   - "Назад" → `PreviousPage()`
   - "Применить промокод" → `ApplyPromoCode(inputField.text)`
   - После успешной оплаты → `ReportPurchaseIfNeeded()`

---

## 12. Гендерные иллюстрации

Некоторые страницы имеют разные иллюстрации для мальчиков и девочек (например, где ребёнок изображён на картинке). Сервер сообщает, какие страницы имеют варианты, через поле `genderedPages` в ответе `GET /api/tales/:id`.

### Как это работает

1. При загрузке сказки (`GET /api/tales/:id`) ответ содержит `genderedPages: [2, 5, 12]` — номера страниц с гендерными вариантами
2. Для этих страниц клиент добавляет `?gender=boy` или `?gender=girl` к запросу иллюстрации
3. Для остальных страниц запрос без параметра — как обычно

### Пример использования

```csharp
// В TaleDetail добавить поле:
[Serializable]
public class TaleDetail
{
    public string id;
    public string title;
    public string lang;
    public int totalPages;
    public string[] pages;
    public int[] genderedPages; // страницы с гендерными иллюстрациями
}

// При загрузке иллюстрации:
public string GetIllustrationUrl(string taleId, int page, string childGender)
{
    string url = $"/api/tales/{taleId}/illustration/{page}";

    // Если страница имеет гендерные варианты — добавить параметр
    if (_currentTale.genderedPages != null &&
        System.Array.IndexOf(_currentTale.genderedPages, page) >= 0)
    {
        string gender = childGender == "female" ? "girl" : "boy";
        url += $"?gender={gender}";
    }

    return url;
}
```

### Маппинг пола

| Профиль (`gender`) | Параметр иллюстрации (`?gender=`) |
|---|---|
| `"male"` | `boy` |
| `"female"` | `girl` |

> **Fallback:** если `?gender=` передан, но гендерный вариант файла не найден на сервере — автоматически вернётся общая иллюстрация. Это безопасно.

---

## 13. Обработка ошибок

### Типичные ошибки от сервера

| Код | Причина | Что делать в Unity |
|-----|---------|--------------------|
| 401 | Токен истёк / невалидный | Вызвать `Login()` заново |
| 400 `"No cloned voice..."` | Голос не клонирован | Показать экран записи голоса |
| 400 `"page parameter..."` | Неверный номер страницы | Проверить диапазон `0..totalPages-1` |
| 404 | Сказка не найдена | Обновить список сказок |
| 404 `"Промокод не найден"` | Неверный промокод | Показать ошибку пользователю |
| 410 `"Промокод уже использован"` | Премиум-код уже активирован | Показать ошибку пользователю |
| 502 | Ошибка ElevenLabs API | Показать "Попробуйте позже" |

### Пример обработки 401 с авто-повтором

```csharp
private IEnumerator SafeRequest(IEnumerator request, System.Action retry)
{
    bool got401 = false;

    yield return request; // первый запрос уже обработает ошибку

    // Если получили 401, перелогиниваемся и повторяем
    // (в реальном проекте передавайте код ошибки через callback)
    if (got401)
    {
        yield return _auth.Login(userId);
        retry?.Invoke();
    }
}
```

---

## 14. Советы по продакшену

### Кэширование аудио

Сервер генерирует озвучку каждый раз заново. Кэшируйте на клиенте:

```csharp
private Dictionary<string, byte[]> _audioCache = new();

private string CacheKey(string taleId, int page) => $"{taleId}_{page}";

public IEnumerator NarrateWithCache(string taleId, int page,
                                     Action<byte[]> onSuccess)
{
    string key = CacheKey(taleId, page);
    if (_audioCache.TryGetValue(key, out byte[] cached))
    {
        onSuccess(cached);
        yield break;
    }

    yield return _tales.NarratePage(taleId, page,
        data =>
        {
            _audioCache[key] = data;
            onSuccess(data);
        }
    );
}
```

### Предзагрузка следующей страницы

```csharp
// После начала воспроизведения текущей страницы:
if (_currentPage + 1 < _currentTale.totalPages)
{
    StartCoroutine(NarrateWithCache(
        _currentTale.id, _currentPage + 1, _ => { }));
}
```

### Безопасность

- **Не храните JWT_SECRET в клиенте** — токен получаете с сервера
- В продакшене замените `userId` на реальную систему аутентификации (Firebase Auth, PlayFab, и т.д.)
- Используйте HTTPS для всех запросов

### Платформы

| Платформа | Микрофон | Особенности |
|-----------|----------|-------------|
| Windows/Mac | Работает из коробки | — |
| Android | Нужен `RECORD_AUDIO` permission | Добавить в Player Settings |
| iOS | Нужен `NSMicrophoneUsageDescription` | Добавить в Info.plist |
| WebGL | `Microphone` не поддерживается | Использовать JS-плагин |

### Минимальный Player Settings для Android

В `Edit → Project Settings → Player → Android`:
- Other Settings → Internet Access: **Require**
- В `AndroidManifest.xml` добавьте:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.INTERNET"/>
```
