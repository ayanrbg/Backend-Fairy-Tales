# IAP — Инструкция для серверного разработчика

Клиент (Unity) уже реализован. Серверу нужно поддержать 3 вещи:
1. Отдавать поле `free` в списке сказок
2. Валидировать Apple receipt
3. Возвращать статус подписки

---

## 1. Поле `free` в API сказок

### Что сделать
Добавить boolean-поле `free` в таблицу сказок и в ответ API.

### База данных
```sql
ALTER TABLE tales ADD COLUMN free BOOLEAN DEFAULT FALSE;

-- Пометить бесплатные сказки
UPDATE tales SET free = TRUE WHERE id IN ('id-первой-бесплатной-сказки');
```

### Эндпоинт `GET /api/tales?lang=ru`

Текущий ответ дополнить полем `free`:

```json
[
  {
    "id": "red-riding-hood",
    "title": "Красная Шапочка",
    "lang": "ru",
    "file": "red-riding-hood.json",
    "hasDefaultNarration": true,
    "free": true,
    "coverUrl": "..."
  },
  {
    "id": "snow-queen",
    "title": "Снежная Королева",
    "lang": "ru",
    "file": "snow-queen.json",
    "hasDefaultNarration": false,
    "free": false,
    "coverUrl": "..."
  }
]
```

- `free: true` — сказка доступна всем без подписки
- `free: false` — нужна подписка (клиент покажет замок)
- Если поле отсутствует — клиент считает `false` (заблокировано)

---

## 2. Валидация Apple Receipt

### Переменная окружения
```
APPLE_SHARED_SECRET=<получить у iOS-публикатора>
```
Это App-Specific Shared Secret из App Store Connect (iOS-публикатор его сгенерирует и передаст).

### Эндпоинт `POST /api/subscription/validate`

Клиент отправляет:
```json
{
  "receipt": "{\"Store\":\"AppleAppStore\",\"Payload\":\"MIIT..base64..\"}",
  "platform": "apple"
}
```

> `receipt` — это JSON-строка от Unity IAP. Внутри есть поле `Payload` — это и есть base64 receipt data для Apple.

### Реализация

```js
const axios = require('axios');

const APPLE_VERIFY_PRODUCTION = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';
const SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

async function validateAppleReceipt(receiptPayload) {
  const body = {
    'receipt-data': receiptPayload,
    'password': SHARED_SECRET,
    'exclude-old-transactions': true
  };

  // Сначала production
  let res = await axios.post(APPLE_VERIFY_PRODUCTION, body);

  // 21007 = sandbox receipt отправлен на production endpoint
  if (res.data.status === 21007) {
    res = await axios.post(APPLE_VERIFY_SANDBOX, body);
  }

  // status 0 = успех
  if (res.data.status !== 0) {
    console.error('Apple verify status:', res.data.status);
    return { valid: false, expiresAt: null };
  }

  const latestInfo = res.data.latest_receipt_info;
  if (!latestInfo || latestInfo.length === 0) {
    return { valid: false, expiresAt: null };
  }

  // Берём последнюю транзакцию
  const latest = latestInfo[latestInfo.length - 1];
  const expiresMs = parseInt(latest.expires_date_ms);
  const expiresAt = new Date(expiresMs);

  return {
    valid: expiresMs > Date.now(),
    expiresAt,
    productId: latest.product_id,
    originalTransactionId: latest.original_transaction_id
  };
}

// --- Express route ---

app.post('/api/subscription/validate', async (req, res) => {
  try {
    const { receipt, platform } = req.body;
    const userId = req.userId; // из auth middleware

    if (platform !== 'apple') {
      return res.json({ success: false });
    }

    // Unity IAP оборачивает receipt в JSON
    const parsed = JSON.parse(receipt);
    const result = await validateAppleReceipt(parsed.Payload);

    if (result.valid) {
      // Сохранить подписку в БД
      await db.query(
        `INSERT INTO subscriptions (user_id, product_id, original_transaction_id, expires_at, platform)
         VALUES ($1, $2, $3, $4, 'apple')
         ON CONFLICT (user_id) DO UPDATE
         SET product_id = $2, original_transaction_id = $3, expires_at = $4`,
        [userId, result.productId, result.originalTransactionId, result.expiresAt]
      );
    }

    return res.json({ success: result.valid });
  } catch (e) {
    console.error('Receipt validation error:', e.message);
    return res.status(500).json({ success: false });
  }
});
```

### Таблица subscriptions
```sql
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  original_transaction_id TEXT,
  expires_at TIMESTAMP NOT NULL,
  platform TEXT NOT NULL DEFAULT 'apple',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 3. Проверка статуса подписки

### Эндпоинт `GET /api/subscription/status`

Клиент периодически проверяет, активна ли подписка.

```js
app.get('/api/subscription/status', async (req, res) => {
  try {
    const userId = req.userId; // из auth middleware

    const result = await db.query(
      'SELECT expires_at FROM subscriptions WHERE user_id = $1',
      [userId]
    );

    const active = result.rows.length > 0
      && new Date(result.rows[0].expires_at) > new Date();

    return res.json({ active });
  } catch (e) {
    console.error('Status check error:', e.message);
    return res.json({ active: false });
  }
});
```

Клиент ожидает ответ:
```json
{ "active": true }
```

---

## 4. Apple Status Codes (справка)

| Status | Значение |
|---|---|
| 0 | Валидный receipt |
| 21000 | App Store не смог прочитать JSON |
| 21002 | Receipt повреждён |
| 21003 | Receipt не прошёл аутентификацию |
| 21004 | Shared secret не совпадает |
| 21005 | Сервер Apple недоступен (повторить позже) |
| 21006 | Receipt валиден, но подписка истекла |
| 21007 | Sandbox receipt отправлен на production (переотправить на sandbox URL) |
| 21008 | Production receipt отправлен на sandbox (переотправить на production URL) |

---

## 5. Чеклист

- [ ] Переменная `APPLE_SHARED_SECRET` задана в окружении
- [ ] Таблица `subscriptions` создана
- [ ] Колонка `free` добавлена в таблицу `tales`
- [ ] `GET /api/tales` возвращает поле `free`
- [ ] `POST /api/subscription/validate` работает с Apple receipt
- [ ] `GET /api/subscription/status` возвращает `{ active: bool }`
- [ ] Протестировано с sandbox receipt (status 21007 → retry на sandbox URL)
