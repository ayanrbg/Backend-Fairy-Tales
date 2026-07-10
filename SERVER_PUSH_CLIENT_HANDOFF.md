# Push (FCM) — хендофф бэкенду: что реализовал клиент и что сверить

Ответ на `AI/CLIENT_TICKET_PUSH.md`. Ниже — **фактический** контракт из кода клиента
(`Diagnostics/PushService.cs`, `UI/Core/DeepLink.cs`, `LibraryScreen.cs`). Сверьте построчно,
чтобы клиент и сервер работали как одно целое.

---

## 1. Что клиент реально шлёт на сервер

### `POST /api/push/register`
Вызывается при: старте (после онбординга), **refresh FCM-токена**, **смене языка**.
```json
{
  "userId":     "<device-based, тот же что в аналитике/остальных запросах>",
  "token":      "<FCM registration token>",
  "platform":   "ios" | "android" | "editor",
  "appVersion": "<Application.version>",
  "lang":       "ru" | "kz" | "en" | "uz"
}
```
⚠️ **Отличия от вашего ТЗ — важно:**
- `platform` может прийти как **`"editor"`** (запуск из Unity Editor в дев-сборках). В проде не
  встречается, но эндпоинт не должен падать/ронять запись из-за неизвестного значения.
- `lang` включает **`"uz"`** (в приложении 4 языка: ru/kz/en/uz), а не 3 как в ТЗ. Убедитесь,
  что для `uz` есть тексты кампаний, иначе используйте фолбэк (ru).
- Заголовок `Authorization: Bearer <jwt>` присутствует **не всегда**: FCM-токен может прийти
  раньше, чем установлен JWT сессии. Поэтому **`/api/push/register` должен идентифицировать
  устройство по `userId` из тела и НЕ требовать обязательный JWT** (иначе первая регистрация
  на свежем девайсе потеряется). JWT, если он есть, приложится — можно использовать как доп.
  проверку, но не как обязательное условие.

### `POST /api/push/unregister`
Вызывается при логауте (и в будущем — при выключении пушей в настройках).
```json
{ "token": "<текущий FCM token>" }
```
Только `token`, без userId. Удалите запись по токену.

### `POST /api/push/opened` (опционально, для open-rate)
Вызывается при тапе по пушу, **только если** в `data` был `campaignId`.
```json
{ "campaignId": "<data.campaignId>", "userId": "<device-based userId>" }
```

---

## 2. Контракт `data` в исходящем пуше (что сервер должен слать)

Клиент читает поле **`data`** (не `notification`) для маршрутизации:
```json
{
  "type":       "tale" | "paywall" | "url" | "home",
  "taleId":     "<id сказки>",   // только при type=tale
  "url":        "<ссылка>",      // только при type=url
  "campaignId": "<опц., для open-rate>"
}
```
Поведение по тапу:
| `type` | Клиент делает |
|--------|---------------|
| `tale` | открывает экран сказки `taleId` (через пейвол-гейт, если сказка платная и нет подписки) |
| `paywall` | открывает пейвол (`source="push"`) |
| `url` | `Application.OpenURL(url)` (внешний браузер) |
| `home` | ничего — просто открывает приложение |

### Критично для доставки/тапа
1. **Слать combined-сообщение: `notification` + `data`.** Клиент НЕ рисует баннер сам. Показ в
   трее (фон/закрыто) делает ОС из блока `notification` (title/body), а `data` доставляется в
   приложение при тапе. Если слать **data-only**, на Android в фоне баннер не покажется и тап
   не отработает.
2. Клиент роутит **только по тапу из фона/закрытого приложения** (`NotificationOpened`).
   Foreground-доставку намеренно НЕ перехватываем (не выдёргиваем пользователя с экрана).
3. **Android `channel_id`:** слать `android.notification.channel_id = "fairytales_default"`
   (клиент завёл этот канал в манифесте). Без него подхватится дефолт из
   `default_notification_channel_id` — тоже `fairytales_default`, так что ок.
4. **Priority:** для надёжной доставки в фоне ставьте `android.priority = "high"` и
   `apns-priority = 10`.
5. **`taleId` должен точно совпадать** с `id` из каталога (`GET /api/tales`). Если id нет в
   загруженном каталоге — клиент молча ничего не откроет (не найдёт сказку).

Пример FCM v1 payload (для справки):
```json
{
  "message": {
    "token": "<device token>",
    "notification": { "title": "Новая сказка!", "body": "Читайте вместе" },
    "data": { "type": "tale", "taleId": "golden_egg", "campaignId": "c123" },
    "android": { "priority": "high", "notification": { "channel_id": "fairytales_default" } },
    "apns": { "headers": { "apns-priority": "10" } }
  }
}
```

---

## 3. Что нужно от бэкенда (Фаза 0)
- [ ] **APNs-ключ (.p8)** залит в Firebase Console (тот же Firebase-проект, что аналитика) —
      без него iOS-пуши не уйдут. С клиента только capabilities (уже включены).
- [ ] Эндпоинты `/api/push/register`, `/api/push/unregister`, `/api/push/opened` подняты по
      контракту выше; `register` — по `userId` без обязательного JWT.
- [ ] Таргетинг кампаний по `userId` (device-based) → выборка токенов пользователя.
- [ ] Тексты кампаний на 4 языках (ru/kz/en/uz), выбор по `lang` из последней регистрации токена.
- [ ] Подтвердить финальные ключи `data` (`type`/`taleId`/`url`/`campaignId`) — если решите
      переименовать, скажите, поправлю клиент.

## 4. Чек-лист совместной проверки
- [ ] Клиент шлёт `register` → в БД появилась запись `{userId, token, platform, lang}`.
- [ ] Смена языка в приложении → повторный `register` с новым `lang` (запись обновилась).
- [ ] Тестовый combined-пуш из Firebase Console по токену → баннер на iOS и Android.
- [ ] Тап (приложение в фоне) → открывается нужный экран для `tale/paywall/url/home`.
- [ ] `campaignId` в `data` → прилетел `POST /api/push/opened`.
- [ ] Логаут → `POST /api/push/unregister`, токен удалён.
```
