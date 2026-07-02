# Подписка / Премиум — интеграция для клиента (iOS + Android)

Коротко: **сервер — единственный источник правды по премиуму.** Клиент делает покупку
через магазин (StoreKit / Google Play Billing), отправляет чек на сервер, а показывает
премиум **по ответу сервера**, а не по локальному флагу магазина.

Базовый URL (прод): `https://bala-stories.apiapp.kz:3000`
Авторизация: во всех запросах заголовок `Authorization: Bearer <jwt>` (тот же токен, что
приходит при `POST /api/auth/register` / `login`). Сервер берёт `userId` из токена.

Product ID (должны совпадать в App Store Connect, Play Console и в клиенте):
- `fairytales_monthly`
- `fairytales_yearly`

---

## Золотое правило клиента

1. **Премиум ВКЛЮЧАЕТСЯ** от любого источника: успешная покупка, восстановление, промокод,
   или ответ `/status` с `active:true`.
2. **Премиум ВЫКЛЮЧАЕТСЯ только** когда `GET /status` вернул `active:false` с `expiresAt`
   в прошлом. Ни по каким другим причинам (нет сети, ошибка магазина и т.п.) премиум не гасим —
   держим оптимистичный кэш.
3. **На каждом старте приложения** (после логина) вызываем `GET /status` и приводим локальный
   премиум к тому, что сказал сервер.

---

## 1. GET /api/subscription/status  — вызывать на КАЖДОМ старте

Заголовки: `Authorization: Bearer <jwt>`

Ответ 200:
```json
{
  "active": true,
  "expiresAt": "2026-07-23T17:46:48.000Z",   // null для бессрочного промо
  "source": "apple",                          // apple | google | promo | null
  "productId": "fairytales_monthly"           // null для промо
}
```
Нет подписки:
```json
{ "active": false, "expiresAt": null, "source": null, "productId": null }
```

Клиент: `hasActiveSubscription = active`. Если `active:false` и `expiresAt` в прошлом —
снять премиум. Если запрос не удался (нет сети) — **оставить текущий кэш**, не снимать.

---

## 2. POST /api/subscription/validate  — после покупки И после «Восстановить»

Вызывать:
- сразу после **успешной покупки** в магазине;
- при нажатии **«Восстановить покупки» / Restore**;
- при ответе магазина **«уже куплено» / already purchased** (взять существующую транзакцию
  и всё равно отправить её чек сюда — иначе премиум не включится).

### iOS (Apple)
```json
POST /api/subscription/validate
Authorization: Bearer <jwt>
{
  "platform": "apple",
  "receipt": "<base64 appStoreReceipt>"   // содержимое appStoreReceiptURL в base64
}
```
`receipt` можно слать как «сырую» base64-строку — сервер разберёт.

### Android (Google)
```json
POST /api/subscription/validate
Authorization: Bearer <jwt>
{
  "platform": "google",
  "receipt": "<purchaseToken>",           // purchaseToken из Google Play Billing
  "productId": "fairytales_monthly"        // обязательно для google
}
```

### Ответ (одинаковый для обеих платформ)
Успех 200:
```json
{ "active": true, "expiresAt": "2026-08-01T12:00:00Z", "source": "apple", "productId": "fairytales_yearly" }
```
Не подтверждено (чек невалиден/просрочен) — тоже 200, но:
```json
{ "active": false, "error": "apple_status_21002" }
```
> `active:false` здесь — это НЕ сетевая ошибка, а «магазин не подтвердил». Премиум не включаем.

Технический сбой — `503` (магазин недоступен) или `500`. В этом случае **не трогаем кэш**,
повторяем позже.

Клиент выставляет премиум по полю `active` из ответа.

---

## 3. POST /api/promo  — активация промокода (уже работает)

```json
POST /api/promo         // или /api/promo/check (старый путь, тоже работает)
Authorization: Bearer <jwt>
{ "code": "PREMIUM7" }
```
Ответ для премиум-кода:
```json
{ "type": "premium", "durationDays": 7, "expiresAt": "2026-07-09T...", "message": "Премиум активирован на 7 дней" }
```
Промо-грант сохраняется на сервере и переживает перезапуск — после него `/status` вернёт
`active:true, source:"promo"`.

---

## 4. Переустановка / смена устройства (merge) — делать НИЧЕГО не нужно

Если пользователь переустановил приложение и получил новый `userId`, но магазин отдаёт ту же
подписку — клиент просто вызывает **Restore → /validate**. Сервер по `originalTransactionId`
(Apple) / `purchaseToken` (Google) сам перенесёт премиум на новый `userId`. Отдельной логики
на клиенте не требуется.

---

## Что сервер делает сам (клиенту знать не нужно, но для понимания)

- Проверяет чек Apple: сначала production, при sandbox-чеке (TestFlight) автоматически
  повторяет в sandbox. То есть один и тот же код работает и в TestFlight, и в релизе.
- Проверяет Google `purchaseToken` через Play Developer API и подтверждает покупку.
- Хранит право в таблице `entitlements` — поэтому премиум не «слетает» после перезапуска.
- Принимает серверные уведомления Apple (продление/отмена/возврат) на
  `/api/apple/notifications` — премиум продлевается/снимается без запуска приложения.

---

## Чек-лист для клиента

- [ ] На старте (после логина) — `GET /status`, выставить премиум по `active`.
- [ ] После покупки — `POST /validate` с чеком, премиум по `active` из ответа.
- [ ] Кнопка «Восстановить» — `POST /validate` с текущим чеком.
- [ ] На «уже куплено» — тоже `POST /validate`, а не игнорировать.
- [ ] Премиум снимать ТОЛЬКО по `/status active:false` с истёкшим `expiresAt`.
- [ ] Нет сети / 5xx — премиум не снимать, оставить кэш.
- [ ] Product ID в клиенте = `fairytales_monthly` / `fairytales_yearly`.
