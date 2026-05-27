## Интеграция промокод-системы для клиента (Unity)

### Аутентификация
Все запросы к промо-эндпоинтам требуют JWT-токен пользователя:
```
Authorization: Bearer <jwt-token>
```

---

### Эндпоинт 1: Проверка промокода

**Когда вызывать:** пользователь ввёл промокод и нажал "Применить"

```
POST /api/promo/check
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "code": "TESTCODE"
}
```

**Ответы:**

| Ситуация | HTTP | Ответ |
|---|---|---|
| Код блогера | 200 | `{"type": "blogger", "bloggerName": "Имя", "message": "Промокод блогера Имя применён"}` |
| Премиум-код | 200 | `{"type": "premium", "durationDays": 7, "expiresAt": "...", "message": "Премиум активирован на 7 дней"}` |
| Премиум уже использован | 410 | `{"error": "Промокод уже использован"}` |
| Код не найден | 404 | `{"error": "Промокод не найден"}` |

**Логика на клиенте:**
- `type === "premium"` — подписка **уже активирована** на сервере. Обновить UI, показать сообщение из `message`
- `type === "blogger"` — показать `message`, сохранить `code` в PlayerPrefs для отправки при покупке
- Ошибка — показать текст из `error`

---

### Эндпоинт 2: Фиксация покупки

**Когда вызывать:** после успешной покупки (IAP), если у пользователя был применён blogger-промокод

```
POST /api/promo/purchase
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "code": "TESTCODE"
}
```

**Ответ:** `200 {"success": true}`

> Вызывать **только** для блогерских промокодов. Для премиум-кодов не нужно — они полностью обрабатываются в `/check`.

---

### Полный поток

```
1. Пользователь вводит код "SALE2026"
2. Клиент → POST /api/promo/check { "code": "SALE2026" }

   Вариант А — премиум:
   3. Сервер → { "type": "premium", "durationDays": 7, "expiresAt": "...", "message": "..." }
   4. Клиент обновляет статус подписки, показывает сообщение. Готово.

   Вариант Б — блогер:
   3. Сервер → { "type": "blogger", "bloggerName": "Иван", "message": "..." }
   4. Клиент сохраняет код в PlayerPrefs, показывает сообщение
   5. Пользователь покупает подписку через IAP
   6. После успешной оплаты: POST /api/promo/purchase { "code": "SALE2026" }
   7. Клиент удаляет сохранённый код из PlayerPrefs
```

---

### Пример реализации (C# / Unity)

```csharp
using UnityEngine;
using UnityEngine.Networking;
using System.Collections;
using System.Text;

[System.Serializable]
public class PromoCheckRequest
{
    public string code;
}

[System.Serializable]
public class PromoCheckResponse
{
    public string type;
    public string bloggerName;
    public int durationDays;
    public string expiresAt;
    public string message;
    public string error;
}

public class PromoService : MonoBehaviour
{
    private const string BASE_URL = "https://bala-stories.apiapp.kz/api/promo";

    // Вызвать когда пользователь нажал "Применить"
    public void ApplyPromoCode(string code)
    {
        StartCoroutine(CheckPromoCode(code));
    }

    private IEnumerator CheckPromoCode(string code)
    {
        var body = JsonUtility.ToJson(new PromoCheckRequest { code = code });
        var request = CreatePostRequest($"{BASE_URL}/check", body);

        yield return request.SendWebRequest();

        if (request.responseCode == 200)
        {
            var data = JsonUtility.FromJson<PromoCheckResponse>(request.downloadHandler.text);

            if (data.type == "premium")
            {
                // Подписка уже активирована на сервере — обновить UI
                Debug.Log(data.message);
                // TODO: обновить статус подписки в игре
            }
            else if (data.type == "blogger")
            {
                // Сохранить код для отправки после покупки
                PlayerPrefs.SetString("bloggerPromoCode", code);
                PlayerPrefs.Save();
                Debug.Log(data.message);
            }
        }
        else
        {
            var error = JsonUtility.FromJson<PromoCheckResponse>(request.downloadHandler.text);
            Debug.LogWarning(error.error);
            // TODO: показать error.error пользователю
        }

        request.Dispose();
    }

    // Вызвать после успешной покупки IAP
    public void OnPurchaseCompleted()
    {
        string savedCode = PlayerPrefs.GetString("bloggerPromoCode", "");
        if (!string.IsNullOrEmpty(savedCode))
        {
            StartCoroutine(SendPurchase(savedCode));
        }
    }

    private IEnumerator SendPurchase(string code)
    {
        var body = JsonUtility.ToJson(new PromoCheckRequest { code = code });
        var request = CreatePostRequest($"{BASE_URL}/purchase", body);

        yield return request.SendWebRequest();

        PlayerPrefs.DeleteKey("bloggerPromoCode");
        PlayerPrefs.Save();

        request.Dispose();
    }

    private UnityWebRequest CreatePostRequest(string url, string jsonBody)
    {
        var request = new UnityWebRequest(url, "POST");
        request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(jsonBody));
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");
        request.SetRequestHeader("Authorization", "Bearer " + AuthManager.Instance.Token);
        return request;
    }
}
```
