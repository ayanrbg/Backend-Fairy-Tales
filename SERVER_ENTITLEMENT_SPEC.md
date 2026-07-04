# Backend: Premium Entitlement — подробное ТЗ

Цель: сделать сервер **единственным источником правды** по премиум-подписке.
Клиент (Unity) хранит только оптимистичный кэш и всегда сверяется с сервером.

Проблема, которую чиним:
1. **В App Store не даёт премиум, хотя оплачено** — почти наверняка Apple-чек валидируется
   не в том окружении (sandbox vs production). TestFlight = sandbox, релиз = production.
   Нужен fallback `production → sandbox` по кодам `21007/21008`.
2. **Промо/подписка «слетает» после перезапуска** — сейчас премиум живёт только на клиенте,
   сервер его не хранит и не подтверждает. Нужна таблица `entitlements` и честный `/status`.

Базовый URL сервера (прод): `https://bala-stories.apiapp.kz:3000`
Продукты (App Store Connect / Google Play), ID должны совпадать 1:1 с клиентом:
- `fairytales_monthly` (auto-renewable subscription)
- `fairytales_yearly` (auto-renewable subscription)

---

## 0. Идентичность пользователя

Ничего нового заводить не нужно — идентичность уже есть:

- `userId` — GUID, приходит при `POST /api/auth/register` / `login`. Сервер выдаёт JWT.
- Все защищённые запросы приходят с `Authorization: Bearer <jwt>`; из токена сервер
  достаёт `userId`. **Именно `userId` — ключ аккаунта.**
- Для платной подписки дополнительно храним Apple `originalTransactionId`
  (и Google `purchaseToken`) — они переживают переустановку и Restore и однозначно
  идентифицируют платящий стор-аккаунт.

Правило связывания: `userId` ↔ `originalTransactionId` — **один-к-одному по факту первой
валидации**. Если тот же `originalTransactionId` позже приходит от другого `userId`
(переустановка, новый GUID) — переносим entitlement на новый `userId` (см. §4, «merge»).

---

## 1. Модель данных

Таблица `entitlements` (по одной активной записи на `userId`):

```sql
CREATE TABLE entitlements (
  user_id                 TEXT PRIMARY KEY,          -- ключ аккаунта (из JWT)
  premium                 BOOLEAN NOT NULL DEFAULT FALSE,
  source                  TEXT    NOT NULL,          -- 'apple' | 'google' | 'promo' | 'admin'
  product_id              TEXT,                       -- fairytales_monthly | _yearly | null для promo
  original_transaction_id TEXT,                       -- Apple: originalTransactionId
  purchase_token          TEXT,                       -- Google: purchaseToken
  expires_at              TIMESTAMPTZ,                -- null = бессрочно (promo), иначе конец периода
  auto_renew              BOOLEAN,                    -- по данным стора (для аналитики)
  environment             TEXT,                       -- 'production' | 'sandbox'
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- быстрый поиск при S2S-нотификациях и merge
CREATE UNIQUE INDEX ux_entitlements_apple ON entitlements (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX ux_entitlements_google ON entitlements (purchase_token)
  WHERE purchase_token IS NOT NULL;
```

Опционально — журнал транзакций для дебага/аудита (не обязателен для MVP):

```sql
CREATE TABLE subscription_events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT,
  source       TEXT,
  raw          JSONB,          -- сырой ответ стора/нотификация
  kind         TEXT,           -- 'validate' | 's2s' | 'promo' | 'status'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Определение «активен»** (единая функция, используется везде):
```
isActive(e) = e.premium AND (e.expires_at IS NULL OR e.expires_at > now())
```

---

## 2. Эндпоинт: POST /api/subscription/validate

Клиент вызывает после покупки/восстановления. Тело:

```json
{
  "platform": "apple",              // "apple" | "google"
  "receipt": "<base64 или token>",  // apple: base64 appStoreReceipt; google: purchaseToken
  "userId": "<guid>",               // дубль для сверки (авторитетный источник — JWT)
  "productId": "fairytales_yearly"  // может отсутствовать
}
```

Авторизация: обязательно `Authorization: Bearer <jwt>`. `userId` берём из токена;
поле в теле — только для логов/сверки.

### 2.1 Apple — алгоритм валидации (критично!)

Используем legacy `verifyReceipt` (проще всего) ИЛИ App Store Server API (см. §6).
Для MVP достаточно `verifyReceipt`:

Эндпоинты:
- production: `https://buy.itunes.apple.com/verifyReceipt`
- sandbox:    `https://sandbox.itunes.apple.com/verifyReceipt`

**Обязательный порядок (иначе релиз ломается):**
1. Всегда шлём сначала на **production**.
2. Если ответ `status == 21007` → это sandbox-чек → повторяем запрос на **sandbox**.
3. Если на sandbox пришёл `status == 21008` → это production-чек → шлём на production.
   (На практике достаточно шага 1→2, но обрабатывайте оба кода.)

Тело запроса к Apple:
```json
{
  "receipt-data": "<base64 receipt>",
  "password": "<APP_SHARED_SECRET>",   // App-Specific Shared Secret из App Store Connect
  "exclude-old-transactions": true
}
```

Разбор ответа (`status == 0` — успех):
- Берём массив `latest_receipt_info` (не `receipt.in_app`!) — там актуальное состояние
  авто-продления.
- Для наших `product_id` находим запись с максимальным `expires_date_ms`.
- `expires_at = max(expires_date_ms)`; подписка активна, если `expires_at > now()`.
- `original_transaction_id` — из той же записи.
- `environment` — из ответа (`"Sandbox"`/`"Production"`), сохраняем.
- Учитывать `is_in_billing_retry_period`, `pending_renewal_info` для будущего, но для
  MVP хватает `expires_date_ms`.

Коды ошибок Apple: `21000` (bad JSON), `21002` (bad receipt data), `21003` (не аутентифицирован),
`21004` (неверный shared secret), `21005` (сервер Apple недоступен — ретрай),
`21007` (sandbox-чек на prod), `21008` (prod-чек на sandbox), `21010` (аккаунт не найден).

### 2.2 Google — алгоритм валидации

- Проверяем `purchaseToken` через Google Play Developer API:
  `GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/subscriptions/{subscriptionId}/tokens/{token}`
  (нужен сервис-аккаунт с доступом в Play Console).
- `expires_at = expiryTimeMillis`; активна, если в будущем и `paymentState` = 1 (received) или 2 (trial).
- Сохраняем `purchase_token`.
- Подтверждаем покупку (`:acknowledge`), если `acknowledgementState == 0`.

### 2.3 Апсерт entitlement и ответ

После успешной валидации:
```
upsert entitlements SET
  premium = true,
  source = platform,
  product_id = <из чека>,
  original_transaction_id = <apple> | purchase_token = <google>,
  expires_at = <из чека>,
  auto_renew = <из чека>,
  environment = <из чека>,
  updated_at = now()
WHERE user_id = <из JWT>
```
Плюс merge (§4), если этот `original_transaction_id`/`purchase_token` уже привязан к другому `user_id`.

Ответ клиенту (200):
```json
{
  "active": true,
  "expiresAt": "2026-08-01T12:00:00Z",
  "source": "apple",
  "productId": "fairytales_yearly"
}
```
При неуспехе валидации — `200` с `{"active": false, ...}` (не 4xx), чтобы клиент
не считал это сетевой ошибкой. Технические сбои (Apple недоступен, 21005) — `503`,
чтобы клиент сохранил текущий кэш и повторил позже.

---

## 3. Эндпоинт: GET /api/subscription/status

Клиент дёргает на каждом старте. Авторизация по JWT.

Логика: читаем entitlement по `user_id`, применяем `isActive()`. **Ленивая проверка Apple:**
если `expires_at < now()` и `source in (apple, google)` — перед ответом можно
пере-валидировать через стор (или положиться на S2S-нотификации из §6).

Ответ (200):
```json
{
  "active": true,
  "expiresAt": "2026-08-01T12:00:00Z",   // null для promo
  "source": "apple",                      // apple | google | promo | null
  "productId": "fairytales_yearly"
}
```
Если записи нет: `{"active": false, "expiresAt": null, "source": null, "productId": null}`.

> Важно для клиента: сейчас сервер отдаёт только `{active}`. Клиенту нужны также
> `expiresAt` и `source` — только тогда клиент имеет право **гасить** премиум по
> истечению. Без этих полей клиент премиум не понижает.

---

## 4. Merge (перенос премиума на новый userId)

Сценарий: переустановка приложения → генерится новый `userId` (GUID), но стор отдаёт
тот же `originalTransactionId`/`purchaseToken`.

При `validate`:
1. Ищем существующую запись по `original_transaction_id` (или `purchase_token`).
2. Если нашли и её `user_id != текущий` — переносим право на текущий `user_id`:
   переписываем `user_id` в записи (или создаём новую и помечаем старую неактивной).
   Идея: подписка следует за платящим стор-аккаунтом, а не за GUID.

Это и есть причина связки «userId + originalTransactionId» из решения на клиенте.

---

## 5. Эндпоинт: POST /api/promo

Сейчас промо включает премиум **только на клиенте** → теряется при перезапуске.
Нужно писать грант в ту же таблицу.

Тело: `{ "code": "<промокод>" }`, авторизация по JWT.
При валидном промо-коде типа `premium`:
```
upsert entitlements SET
  premium = true,
  source = 'promo',
  product_id = null,
  expires_at = <null для бессрочного ИЛИ дата, если промо временный>,
  updated_at = now()
WHERE user_id = <из JWT>
```
Ответ (совместим с текущим клиентом): `{ "type": "premium", "message": "..." }`.
Промо-грант `source='promo'` **не трогается** при Apple/Google валидации и S2S —
это отдельный источник, не пересекается со стор-подписками.

---

## 6. App Store Server Notifications v2 (обязательно для «железности»)

Чтобы премиум продлевался/снимался без запуска приложения (продление, отмена, возврат,
grace period), настроить в App Store Connect URL нотификаций → ваш эндпоинт:

`POST /api/apple/notifications`  (публичный, но с проверкой подписи)

- Тело — `signedPayload` (JWS). **Проверить подпись** цепочкой сертификатов Apple
  (x5c header, корень — Apple Root CA G3). Не доверять неподписанным.
- Декодировать `notificationType` (`DID_RENEW`, `EXPIRED`, `DID_FAIL_TO_RENEW`,
  `REFUND`, `GRACE_PERIOD_EXPIRED`, `DID_CHANGE_RENEWAL_STATUS` и т.д.).
- По `originalTransactionId` найти entitlement и обновить `premium`/`expires_at`/`auto_renew`.
- На `REFUND`/`REVOKE` → `premium = false`.

Google-аналог: **Real-time Developer Notifications (RTDN)** через Pub/Sub — по желанию,
но крайне рекомендуется. Обрабатывать `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_CANCELED`,
`SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_REVOKED`.

Если S2S/RTDN пока не делаете — минимальный запасной вариант: клиент на каждом старте
дёргает `/status`, а сервер при `expires_at < now()` перепроверяет чек у стора (ленивая
ре-валидация в §3). Медленнее, но работает.

---

## 7. Безопасность

- Все `validate`/`status`/`promo` — **только по валидному JWT**; `userId` берём из токена,
  не из тела.
- `APP_SHARED_SECRET` (Apple) и ключ сервис-аккаунта Google — в переменных окружения,
  не в коде.
- Эндпоинт нотификаций Apple — обязательная проверка JWS-подписи; отклонять всё остальное.
- Идемпотентность: повторный `validate` того же чека не должен плодить записи (апсерт по ключу).
- Не доверять `productId`/`active` из тела клиента — всё берётся из ответа стора.

---

## 8. Переменные окружения (добавить)

```
APPLE_SHARED_SECRET=...            # App-Specific Shared Secret (App Store Connect → App Information)
APPLE_BUNDLE_ID=kz.apiapp.balastories   # уточнить реальный bundle id
GOOGLE_PACKAGE_NAME=...            # applicationId Android-сборки
GOOGLE_SERVICE_ACCOUNT_JSON=...    # путь/содержимое ключа сервис-аккаунта Play
```

---

## 9. Контракт для клиента (сводка — что именно вызывает Unity)

| Метод | Эндпоинт | Тело/Заголовки | Ответ |
|-------|----------|----------------|-------|
| POST | `/api/subscription/validate` | JWT + `{platform, receipt, userId, productId}` | `{active, expiresAt, source, productId}` |
| GET  | `/api/subscription/status`   | JWT | `{active, expiresAt, source, productId}` |
| POST | `/api/promo`                 | JWT + `{code}` | `{type, message}` |
| POST | `/api/apple/notifications`   | signedPayload (JWS) | 200 |

Клиент правило: премиум **включается** от любого источника (кэш / чек / сервер);
**выключается только** когда `/status` вернул `active=false` с `expiresAt` в прошлом.
Поэтому поля `expiresAt` и `source` в `/status` — обязательны.

---

## 9a. POST /api/debug/log — приём удалённых логов покупок

У нас НЕТ доступа к консоли устройства (нет Mac), поэтому клиент шлёт ключевые события
IAP на сервер. Нужен максимально простой эндпоинт-приёмник, который складывает записи
в таблицу/файл, чтобы мы могли их читать.

Запрос (авторизация НЕ обязательна — логи должны проходить даже до логина; если
`Authorization` есть, можно дополнительно сверить `userId`):
```json
POST /api/debug/log
{
  "userId": "<guid или пусто>",
  "session": "a1b2c3d4",          // 8 hex-символов, группирует события одного запуска
  "platform": "IPhonePlayer",     // Application.platform
  "appVersion": "1.0.3",
  "ev": "purchase_validated",     // тип события (см. список ниже)
  "data": "ok=true; active=true; source=apple; granted=true",
  "ts": "2026-07-02T10:15:30.1234567Z"  // ISO-8601 UTC
}
```

Ответ: `200 {}` (тело неважно, клиент игнорирует). Никогда не отдавайте 4xx/5xx как
критичное — клиент шлёт fire-and-forget, но лишний шум в его логах ни к чему.

Хранение — минимум:
```sql
CREATE TABLE debug_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT,
  session     TEXT,
  platform    TEXT,
  app_version TEXT,
  ev          TEXT,
  data        TEXT,
  client_ts   TIMESTAMPTZ,   -- ts из тела
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_debug_logs_user ON debug_logs (user_id, received_at);
CREATE INDEX ix_debug_logs_session ON debug_logs (session);
```

Нужна простая возможность посмотреть логи по `userId` или `session` (эндпоинт-читалка
`GET /api/debug/log?userId=...` под админ-ключом, или просто SQL-доступ — на ваше усмотрение).

Ретеншн: чистить записи старше ~14 дней (cron), чтобы таблица не разрасталась.

### Список событий `ev`, которые шлёт клиент (для понимания)
| ev | data (примеры) | смысл |
|----|----------------|-------|
| `iap_init_ok` | `cachedPremium=..; monthly(avail,receipt,price); yearly(...)` | стор поднялся, каталог/чеки |
| `iap_init_failed` | `reason=..; msg=..` | стор не инициализировался (нет продуктов и т.п.) |
| `purchase_start` | `productId=..; storeReady=..` | пользователь нажал «купить» |
| `purchase_abort` | `store_not_initialized` | покупка невозможна — стор не готов |
| `process_purchase` | `productId=..; txId=..; receiptLen=..` | StoreKit подтвердил покупку, начинаем валидацию |
| `purchase_validated` | `ok=..; active=..; source=..; granted=..` | ответ `/validate` |
| `purchase_failed` | `productId=..; reason=..; msg=..` | покупка не удалась (в т.ч. «уже подписан») |
| `restore_start` | `platform=..` | нажали «восстановить» / авто-restore |
| `restore_callback` | `success=..; error=..` | ответ StoreKit RestoreTransactions |
| `restore_result` | `premium=..` | итог после серверной сверки |
| `status_result` | `ok=..; active=..; source=..; expires=..; cachedPremium=..` | ответ `/status` на старте |
| `premium_changed` | `value=true|false` | локальный флаг премиума переключился |

Этого набора достаточно, чтобы по логам одного `session` восстановить всю цепочку:
инициализация → покупка → валидация → включение премиума (или где оборвалось).

---

## 9b. POST /api/subscription/sync — полный снимок состояния клиента

Клиент шлёт полный снимок состояния подписки (для мониторинга и контроля). Вызывается
на старте (`context:"init"`), после покупки (`"purchase"`), можно расширять.

```json
POST /api/subscription/sync
Authorization: Bearer <jwt>   // опционально; userId всё равно берём из токена, если есть
{
  "userId": "<guid>",
  "platform": "IPhonePlayer",
  "appVersion": "1.0.3",
  "context": "init",
  "cachedPremium": true,          // что клиент показывает локально ПРЯМО СЕЙЧАС
  "products": [
    {
      "id": "fairytales_monthly",
      "available": true,          // доступен ли к покупке в сторе
      "hasReceipt": true,         // есть ли локальный чек
      "price": "790,00 ₸",
      "currency": "KZT",
      "isSubscribed": true,       // локальный разбор чека (может врать — не доверять слепо)
      "isExpired": false,
      "expiresUtc": "2026-08-01T12:00:00.0000000Z"
    },
    { "id": "fairytales_yearly", "available": true, "hasReceipt": false, ... }
  ],
  "ts": "2026-07-02T10:15:30Z"
}
```

Ответ: `200 {}`. Сервер сохраняет последний снимок на пользователя (для «посмотреть, что
у клиента происходит») + может складывать историю снимков. Минимальная таблица:

```sql
CREATE TABLE subscription_snapshots (
  user_id      TEXT,
  platform     TEXT,
  app_version  TEXT,
  context      TEXT,
  cached_premium BOOLEAN,
  products     JSONB,      -- массив products как есть
  client_ts    TIMESTAMPTZ,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_snap_user ON subscription_snapshots (user_id, received_at DESC);
```

> `cachedPremium=true`, но `/status` считает `active=false` → рассинхрон, повод разобраться.
> `hasReceipt=false` у обоих продуктов при живой подписке → на устройстве нет чека
> (нужен Restore). Эти сигналы видны прямо в снимке.

---

## 9c. Админ-контроль подписок

Отдельные админ-эндпоинты (защита — админ-ключ/роль, НЕ обычный пользовательский JWT).

**Источник `admin` — ручной оверрайд.** В таблице `entitlements` (§1) значение
`source='admin'` означает ручной грант. Правило приоритета при валидации стора / S2S:
- запись с `source='admin'` или `source='promo'` **не понижается** авто-валидацией стора,
  если у неё `expires_at` в будущем или NULL. Стор может только продлить/добавить свою
  запись, но не снять ручной грант. (Ручной грант снимает только админ.)
- обратный случай: `grant` **перезаписывает** активную стор-запись (`source='admin'`,
  `premium=true`). После этого S2S/валидация стора её уже не трогают (правило выше). Так
  ручной грант всегда «главнее» — снять его может только `revoke`.

Реализация (для справки): `entitlements.upsertEntitlement(fields, { protectManual: true })`
на путях валидации стора не понижает активный admin/promo; `adminGrant/adminRevoke/adminExtend`
пишут напрямую. Таблицы `subscription_snapshots`/`debug_logs` и поля каталога — в
`db/migrate-006-catalog-admin.sql`.

| Метод | Эндпоинт | Тело | Действие |
|-------|----------|------|----------|
| GET  | `/api/admin/subscriptions?active=true&limit=&offset=&q=` | — | Список подписчиков: userId, premium, source, productId, expiresAt, updatedAt. Фильтры: только активные, поиск по userId. |
| GET  | `/api/admin/subscriptions/{userId}` | — | Карточка: текущий entitlement + история событий (`subscription_events`) + последний снимок (`subscription_snapshots`). |
| POST | `/api/admin/subscriptions/{userId}/grant` | `{ "days": 30 }` или `{ "until": "2026-12-31" }`, `days:null`/отсутствует = бессрочно | Выдать премиум вручную (`source='admin'`, `premium=true`, `expires_at` по days/until). |
| POST | `/api/admin/subscriptions/{userId}/revoke` | — | Снять премиум (`premium=false`), записать в историю. |
| POST | `/api/admin/subscriptions/{userId}/extend` | `{ "days": 7 }` | Продлить текущий `expires_at` на N дней (тест/компенсация). |

История: каждая админ-операция и каждое стор-событие пишутся в `subscription_events`
(§1, `kind='admin_grant'|'admin_revoke'|'admin_extend'|'s2s'|'validate'`), чтобы был
полный аудит «кто, когда, почему».

Клиент ничего нового для этого не делает: админ-грант отражается в `entitlements`, и
обычный `GET /api/subscription/status` вернёт `active:true, source:"admin"` — премиум
включится на следующем старте / `RefreshEntitlement`.

---

## 10. Чек-лист приёмки

- [ ] Покупка в **production** (реальный App Store) → `validate` проходит (fallback prod→sandbox работает).
- [ ] Покупка в **TestFlight** (sandbox) → тоже проходит (код 21007 обрабатывается).
- [ ] После перезапуска приложения `/status` возвращает `active=true` — премиум не слетает.
- [ ] Промо-код → `/status` возвращает `active=true, source=promo` и переживает перезапуск.
- [ ] Переустановка приложения → Restore на клиенте → `validate` находит старый
      `originalTransactionId` → merge → премиум восстановлен на новом `userId`.
- [ ] Отмена/возврат подписки → S2S-нотификация → `premium=false`.
- [ ] `validate` без валидного JWT → 401.
- [ ] Повторный `validate` того же чека не создаёт дубликатов.
```
