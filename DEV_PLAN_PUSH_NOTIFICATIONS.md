# План разработки: Панель пуш-уведомлений (пользовательские кампании)

Статус: **план** (код не писан). Цель — полноценное управление пользовательскими пуш-кампаниями
из админ-сайта: сегменты, отложенная отправка, авто-триггеры, мультиязычный контент.
Идём в прод «железно», с подробными дебаг-логами (`[PUSH]`).

> ⚠️ **Важно:** это НЕ то же самое, что «пуш-алерты админам» из `DEV_PLAN_SITE_PUSH_ANALYTICS.md`
> (те шлют в Telegram/ленту `admin_alerts` о покупках). Здесь — **пуши конечным пользователям
> приложения** (ретеншн, анонсы сказок, реактивация). Это новая подсистема и она **требует
> доработки клиента (Unity)** — см. `CLIENT_TICKET_PUSH.md`.

## Согласованные решения (вводные от продукта)

| Вопрос | Решение |
|--------|---------|
| Канал доставки | **FCM** (Firebase Cloud Messaging) — тот же проект `bala-stories-afb46`, что уже настроен под аналитику |
| Таргетинг | **Сегменты + адресный userId** (платящие/бесплатные, язык, активность, пол, прочитал сказку/нет; плюс отправка одному юзеру для теста/саппорта) |
| Расписание | **Сейчас + отложенно + авто-триггеры** (сценарии «не заходил N дней», «новая сказка → анонс») |
| Локализация | **Мультиязычный контент** (ru/kz/en в кампании, подстановка по `users.lang`, фолбэк на дефолт) |
| Где панель | Сайт **`bala-stories`** (существующая админка, BFF-прокси к Fairy с `X-Admin-Key`) |
| Источник правды | **Fairy-бэкенд** (:3000) — токены, кампании, отправка, статистика |

---

## Архитектура

```
Unity-клиент ──(FCM SDK)──▶ APNs / FCM ──▶ устройство
     │  регистрирует device-token
     ▼
Fairy-бэкенд (:3000, Node/Express/pg)
     ├─ POST /api/push/register        (клиент кладёт токен)
     ├─ services/pushTokens.js         (хранение/дедуп/инвалидация токенов)
     ├─ services/pushSegments.js       (резолв сегмента → список userId/токенов)
     ├─ services/pushSender.js         (firebase-admin → FCM multicast, разбор ответов)
     ├─ services/pushScheduler.js      (воркер: отложенные кампании + авто-триггеры)
     └─ routes/adminPush.js            (CRUD кампаний, отправка, статистика — под X-Admin-Key)
     ▲
     │ X-Admin-Key (только на сервере)
bala-stories server (BFF/прокси)  ◀── Браузер (админ, свой логин/роль)
     └─ вкладка «Пуши»: компоновка, сегмент, предпросмотр охвата, расписание, статистика
```

**Ключевой принцип (как и в остальной админке):** `X-Admin-Key` и Firebase service-account
**никогда не попадают в браузер**. Человек логинится в bala-сайте, а bala-server дергает Fairy
admin API серверным ключом.

---

## Модель данных (новая миграция `010-push`)

### `push_tokens` — device-токены пользователей
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | bigserial PK | |
| `user_id` | text | ссылка на `users.user_id` (device-based id) |
| `token` | text UNIQUE | FCM registration token |
| `platform` | text | `ios` / `android` |
| `app_version` | text | для сегментации по версии |
| `lang` | text | язык на устройстве на момент регистрации (дублирует `users.lang`, но токен может опережать профиль) |
| `last_seen_at` | timestamptz | обновляется при каждом register (heartbeat) |
| `disabled_at` | timestamptz NULL | проставляется когда FCM вернул `UNREGISTERED`/`INVALID_ARGUMENT` |
| `created_at` | timestamptz | |

Индексы: `(user_id)`, `(disabled_at)`, частичный на активные токены.
Один юзер = несколько токенов (несколько устройств) — это нормально.

### `push_campaigns` — кампании
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | bigserial PK | |
| `title` | text | внутреннее имя (не показывается юзеру) |
| `status` | text | `draft` / `scheduled` / `sending` / `sent` / `canceled` / `failed` |
| `audience` | jsonb | фильтры сегмента (см. ниже) ИЛИ `{ "userId": "..." }` для адресной |
| `content` | jsonb | `{ "ru": {title, body, image?}, "kz": {...}, "en": {...}, "default": "ru" }` |
| `deeplink` | jsonb | `{ "type": "tale\|paywall\|url\|home", "taleId?": "...", "url?": "..." }` |
| `schedule_at` | timestamptz NULL | если задано — отложенная; NULL = отправлена сразу |
| `automation_id` | bigint NULL | если кампания порождена авто-триггером |
| `stats` | jsonb | агрегаты: `{ targeted, sent, failed, opened }` |
| `created_by` | text | админ (из `X-Admin-Actor`) |
| `created_at` / `sent_at` | timestamptz | |

### `push_deliveries` — по-получательская доставка (аудит + дедуп + статистика)
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | bigserial PK | |
| `campaign_id` | bigint FK | |
| `user_id` | text | |
| `token` | text | какой токен |
| `lang_used` | text | какой язык контента подставлен |
| `status` | text | `sent` / `failed` |
| `fcm_message_id` | text NULL | ответ FCM |
| `error` | text NULL | код ошибки FCM |
| `sent_at` | timestamptz | |
| `opened_at` | timestamptz NULL | если клиент репортит открытие (§ клиентское ТЗ, опц.) |

Уникальность `(campaign_id, token)` — защита от дублей при ретраях воркера.

### `push_automations` — правила авто-триггеров (Фаза 3)
| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | bigserial PK | |
| `type` | text | `inactive_n_days` / `new_tale_announce` / … |
| `params` | jsonb | напр. `{ "days": 3 }` |
| `content` / `deeplink` | jsonb | шаблон (как у кампании, мультиязычный) |
| `audience` | jsonb | доп. фильтр поверх триггера |
| `enabled` | bool | вкл/выкл |
| `last_run_at` | timestamptz | |
| `frequency_cap` | jsonb | напр. «не чаще 1 раза в 7 дней на юзера» |

---

## Сегменты (резолв аудитории)

`services/pushSegments.js` превращает `audience`-фильтры в список активных токенов одним SQL по
`users` + `entitlements` + `analytics_events` + `push_tokens`. Поддерживаемые фильтры:

| Фильтр | Источник | Пример |
|--------|----------|--------|
| Платящие / бесплатные | `entitlements` (premium/expiresAt) | «только бесплатные» для конверсии |
| Язык | `users.lang` / `push_tokens.lang` | «только kz» |
| Пол ребёнка | `users.gender` | тематические анонсы |
| Активность (не заходил N дней) | max(`analytics_events.created_at`) по юзеру | реактивация |
| Прочитал / не прочитал сказку X | `analytics_events` (`tale_complete`/`tale_open`, `tale_id`) | «дочитай начатое», «новая похожая» |
| Версия приложения | `push_tokens.app_version` | таргет фикса/фичи |
| Платформа | `push_tokens.platform` | iOS/Android-специфика |

**Предпросмотр охвата:** `POST /api/admin/push/preview-audience` возвращает `{ users, tokens }`
(сколько человек/устройств попадёт) — админ видит охват ДО отправки. Только активные токены
(`disabled_at IS NULL`).

**Frequency cap:** глобальный предохранитель — не слать одному юзеру больше N пушей в сутки
(env `PUSH_MAX_PER_USER_PER_DAY`, дефолт напр. 2). Считается по `push_deliveries`.

---

## Отправка (FCM)

`services/pushSender.js` на `firebase-admin` (Node SDK, тот же Firebase-проект):

- Аутентификация — **service-account JSON** (env `FIREBASE_SERVICE_ACCOUNT`, только на сервере,
  в git НЕ коммитим). Отдельно от клиентских `GoogleService-Info.plist` / `google-services.json`.
- Отправка батчами `sendEachForMulticast` (до 500 токенов на вызов), контент подставляется по
  языку получателя с фолбэком на `content.default`.
- Разбор ответа per-token: успех → `push_deliveries.status='sent'` + `fcm_message_id`;
  ошибка `messaging/registration-token-not-registered` / `invalid-argument` → помечаем
  `push_tokens.disabled_at = now()` (чистим мёртвые токены), пишем `failed`.
- Payload: `notification` (title/body/image) + `data` (deeplink: `type`, `taleId`, `url`) —
  контракт deep-link согласован с клиентом (см. `CLIENT_TICKET_PUSH.md`).
- **fire-and-forget по отношению к основному флоу**, но с транзакционным учётом в `push_deliveries`,
  чтобы кампанию можно было докинуть при сбое.
- Дебаг-логи `[PUSH]`: campaign_id, размер аудитории, батчи, success/fail на батч, инвалидации.

---

## Планировщик (`services/pushScheduler.js`)

Периодический воркер (интервал в процессе Fairy, напр. каждую минуту; НЕ внешний cron, чтобы не
плодить точки отказа — но идемпотентно, чтобы переживать рестарт pm2):

1. **Отложенные кампании:** берёт `push_campaigns WHERE status='scheduled' AND schedule_at <= now()`,
   переводит в `sending` (атомарно, `FOR UPDATE SKIP LOCKED`), отправляет, ставит `sent`.
2. **Авто-триггеры (Фаза 3):** для каждого `enabled` правила по расписанию (напр. раз в день)
   резолвит аудиторию, применяет frequency cap, создаёт «системную» кампанию и шлёт.

Тайзмона расписания — храним `schedule_at` в UTC; в UI админ выбирает по своей TZ, конвертация
на bala-фронте/сервере.

---

## API (Fairy-бэкенд)

### Клиентские (регистрация токенов) — лёгкие, идемпотентные
| Метод | Эндпоинт | Тело | Действие |
|-------|----------|------|----------|
| POST | `/api/push/register` | `{ userId, token, platform, appVersion, lang }` | upsert токена, `last_seen_at=now()`, снять `disabled_at` |
| POST | `/api/push/unregister` | `{ token }` | пометить токен выключенным (юзер отключил пуши/разлогин) |
| POST | `/api/push/opened` (опц.) | `{ campaignId, userId }` | отметка открытия для статистики |

> Авторизация клиентских ручек — как у остальных user-эндпоинтов (device-based `userId`),
> без админ-ключа. Валидация формата токена, rate-limit.

### Админские (под `X-Admin-Key`, проксируются через bala BFF)
| Метод | Эндпоинт | Действие |
|-------|----------|----------|
| GET | `/api/admin/push/campaigns` | список кампаний + статусы + агрегаты |
| POST | `/api/admin/push/campaigns` | создать черновик |
| GET | `/api/admin/push/campaigns/:id` | детали + статистика доставки |
| PUT | `/api/admin/push/campaigns/:id` | редактировать черновик/запланированную |
| POST | `/api/admin/push/campaigns/:id/send` | отправить **сейчас** |
| POST | `/api/admin/push/campaigns/:id/schedule` | `{ scheduleAt }` — запланировать |
| POST | `/api/admin/push/campaigns/:id/cancel` | отменить запланированную/остановить |
| POST | `/api/admin/push/preview-audience` | `{ audience }` → `{ users, tokens }` (охват) |
| POST | `/api/admin/push/test` | `{ userId\|token, content, deeplink }` — тест на себя |
| GET | `/api/admin/push/tokens/stats` | сколько активных токенов по платформе/языку/версии |
| CRUD | `/api/admin/push/automations` | правила авто-триггеров (Фаза 3) |

Пробрасываем `X-Admin-Actor` (кто) для аудита `created_by`, сквозной `requestId` (как в BFF-стандарте).

---

## Панель на сайте `bala-stories` (вкладка «Пуши»)

Переиспользуем существующий паттерн (хелпер `api()`, модалки, таблицы, `style.css`),
под `authenticateToken + requireRole('admin')`. BFF-роутер `src/routes/push.ts` проксирует
в Fairy admin API.

**Экраны:**
1. **Список кампаний** — статус, аудитория (сжато), охват, отправлено/ошибок/открытий, дата.
2. **Создание/редактирование кампании:**
   - внутреннее имя;
   - **контент по языкам** (ru/kz/en): заголовок, текст, опц. картинка; выбор дефолтного языка;
   - **deep-link**: тип (сказка → выбор из каталога / пейволл / URL / просто открыть) ;
   - **сегмент**: чекбоксы/фильтры (платящие·бесплатные, язык, пол, «не заходил N дней»,
     «прочитал/не прочитал сказку», платформа, версия) ИЛИ поле «конкретный userId»;
   - кнопка **«Показать охват»** → живой счётчик получателей;
   - **предпросмотр** карточки пуша (как увидит юзер) на каждый язык;
   - **тест на себя** (ввести свой userId → прилетит пуш);
   - действие: **Отправить сейчас** / **Запланировать** (дата-время + TZ) / **Сохранить черновик**.
3. **Статистика кампании** — targeted / sent / failed / opened, разбивка по платформе/языку,
   список ошибок (для диагностики мёртвых токенов).
4. **Авто-триггеры** (Фаза 3) — список правил, вкл/выкл, редактирование шаблона и параметров.
5. **Здоровье токенов** — сколько активных устройств, динамика, % отключённых.

---

## Приватность / комплаенс (детское приложение — критично)

- Пуши шлём **только с разрешения ОС** (iOS запрашивает явно; Android 13+ — `POST_NOTIFICATIONS`).
- **Никакого PII** в теле пуша (имя ребёнка и т.п.) — только нейтральные тексты.
- **Частотный предохранитель** (frequency cap) + разумные «тихие часы» (не слать ночью по TZ).
- Контент — родительский/нейтральный тон; кампании проходят ручную вычитку (черновик → отправка).
- Соответствие правилам сторов для Kids/Families: пуши не должны быть рекламой третьих лиц.
- Юзер может отключить пуши (в ОС и/или в приложении → `unregister`).

---

## Переменные окружения (добавить)

| Где | Переменная | Назначение |
|-----|-----------|------------|
| Fairy | `FIREBASE_SERVICE_ACCOUNT` | путь/JSON service-account для firebase-admin (секрет) |
| Fairy | `PUSH_ENABLED` | глобальный рубильник подсистемы |
| Fairy | `PUSH_MAX_PER_USER_PER_DAY` | частотный предохранитель (дефолт 2) |
| Fairy | `PUSH_QUIET_HOURS` | напр. `22-08` — не слать ночью (опц.) |
| bala | `FAIRY_API_URL`, `FAIRY_ADMIN_KEY` | уже есть (BFF-контракт) |
| клиент | Firebase configs | `GoogleService-Info.plist` / `google-services.json` (уже нужны для аналитики) |

---

## Порядок работ (по фазам, каждую катим отдельно)

### Фаза 0 — Инфраструктура FCM (без отправки, «прокладываем трубы»)
- [ ] Firebase Console: включить **Cloud Messaging**, загрузить **APNs Auth Key (.p8)** для iOS.
- [ ] Сгенерировать **service-account** → положить на Fairy-сервер как секрет (`FIREBASE_SERVICE_ACCOUNT`).
- [ ] Клиент: подключить **Firebase Messaging Unity SDK**, разрешение, регистрация токена
      (`POST /api/push/register`), обработка входящих + deep-link — **`CLIENT_TICKET_PUSH.md`**.
- [x] Fairy: миграция `010-push` (`push_tokens`), `routes/push.js` (register/unregister),
      `services/pushTokens.js`. **Код готов** (загружается, синтаксис чист). ⚠️ миграцию
      применить на проде: `psql -f db/migrate-010-push.sql`.

### Фаза 1 — MVP панели (отправка сейчас + сегменты + статистика)
- [x] `services/pushSender.js` (firebase-admin v13 модульный API, `sendEach` батчами по 500,
      инвалидация мёртвых токенов, ленивая инициализация — деплоится без ключа).
- [x] `services/pushSegments.js` + `POST /preview-audience` (охват без отправки).
- [x] `routes/adminPush.js`: campaigns CRUD, `send`, `cancel`, `preview-audience`, `test`,
      `tokens/stats`. Миграция `011-push-campaigns` (`push_campaigns`, `push_deliveries`).
- [ ] bala BFF `src/routes/push.ts` + вкладка «Пуши»: компоновка, сегмент, охват, отправить сейчас,
      статистика. **(отдельный репозиторий `bala-stories`, правится на сервере)**
- [ ] Чек-лист приёмки Фазы 1 (ниже) — после подключения ключа FCM и клиента.

### Фаза 2 — Расписание
- [ ] `push_campaigns.schedule_at` + `services/pushScheduler.js` (отложенная отправка, идемпотентно).
- [ ] UI: «Запланировать» (дата-время + TZ), «Отменить», статус `scheduled`.

### Фаза 3 — Авто-триггеры
- [ ] `push_automations` + правила `inactive_n_days`, `new_tale_announce` (хук на публикацию сказки).
- [ ] Frequency cap + тихие часы.
- [ ] UI управления правилами.

---

## Чек-лист приёмки

### Фаза 0
- [ ] Реальное устройство (iOS и Android) регистрирует токен → строка в `push_tokens`.
- [ ] Повторный запуск обновляет `last_seen_at`, не плодит дубли.
- [ ] `unregister` помечает токен выключенным.

### Фаза 1
- [ ] Тестовый пуш на свой `userId` приходит на оба устройства с правильным языком.
- [ ] Сегмент «только бесплатные kz» → охват совпадает с ручной проверкой в БД.
- [ ] Отправка сегменту: `push_deliveries` заполнен, `stats` сходятся (targeted/sent/failed).
- [ ] Мёртвый токен (переустановленное приложение) → FCM `UNREGISTERED` → `disabled_at` проставлен,
      больше не таргетится.
- [ ] Тап по пушу открывает нужный экран (deep-link: сказка/пейволл/home).
- [ ] Все операции видны в `[PUSH]`/`[PROXY]`-логах; `X-Admin-Actor` пишет `created_by`.

### Фаза 2
- [ ] Кампания на будущее время уходит в срок (±минута), переживает рестарт pm2 без дублей.
- [ ] «Отменить» до времени → не отправляется.

### Фаза 3
- [ ] «Не заходил 3 дня» шлёт только подходящим, уважает frequency cap и тихие часы.
- [ ] Публикация новой сказки → анонс подписчикам сегмента.

---

## Требования к клиенту (Unity) — ОБЯЗАТЕЛЬНО

Пользовательские пуши без клиента невозможны. Полное ТЗ — **`CLIENT_TICKET_PUSH.md`**. Кратко:
Firebase Messaging SDK, разрешение (iOS/Android 13+), регистрация/обновление токена на нашем API,
обработка входящих и deep-link по контракту `data`, обновление языка. См. отдельный документ.

---

## Связанные документы
- `CLIENT_TICKET_PUSH.md` — ТЗ клиентскому разработчику (Unity).
- `FIREBASE_SETUP.md` — настройка Firebase-проекта (дополнить разделом FCM/APNs).
- `DEV_PLAN_SITE_PUSH_ANALYTICS.md` — соседняя подсистема (админ-алерты, аналитика) — не путать.
- `ANALYTICS_SPEC.md` — таксономия событий (источник данных для сегментов активности/чтения).
