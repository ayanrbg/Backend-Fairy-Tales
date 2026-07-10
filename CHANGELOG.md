# Changelog

## 2026-07-10 — Пуши: сверка с клиентом (SERVER_PUSH_CLIENT_HANDOFF)

Клиент (Unity) реализовал пуши и прислал фактический контракт. Подогнал бэкенд:
- **`POST /api/push/opened`** — приём тапа по пушу (open-rate). Пишет `push_deliveries.opened_at`
  (однократно) и инкрементит `push_campaigns.stats.opened`. Fire-and-forget, всегда 200;
  нечисловой `campaignId` (тестовые пуши) игнорируется. `services/pushTokens.recordOpen`.
- **FCM-payload** дополнен под требования клиента: `android.priority=high` +
  `android.notification.channel_id="fairytales_default"`, `apns.headers.apns-priority=10`.
  Шлём combined (`notification`+`data`), не data-only — иначе Android в фоне не покажет баннер.
- **`platform="editor"`** теперь принимается (Unity-Editor дев-сборки) и **исключается из
  обычных рассылок** (`pushSegments`: broadcast добавляет `platform IS DISTINCT FROM 'editor'`,
  если платформа не задана явно) — тестовые токены не получают прод-пуши.
- Ключи `data` (`type`/`taleId`/`url`/`campaignId`) подтверждены как есть.
- Сайт: в композер добавлен 4-й язык **uz** (бэкенд и так фолбэчил на default).


## 2026-07-08 — Пуш-уведомления: Фаза 1 — отправка, сегменты, кампании (DEV_PLAN_PUSH_NOTIFICATIONS)

- **`services/pushSender.js`** — отправка через FCM на `firebase-admin` v13 (модульный API
  `firebase-admin/app` + `/messaging`). Ленивая инициализация из `FIREBASE_SERVICE_ACCOUNT`
  (путь или сырой JSON) — код деплоится без ключа, шлёт когда ключ появится. `sendEach`
  батчами по 500, мультиязычный контент по языку получателя (фолбэк на `default`), мёртвые
  токены (`registration-token-not-registered` и т.п.) мягко гасятся `disabled_at`.
- **`services/pushSegments.js`** — резолвер аудитории: `premium` (paid/free через `entitlements`),
  `langs`, `genders`, `platforms`, `appVersions`, `inactiveDays` (по `analytics_events`),
  `taleRead` (прочитал/не прочитал сказку), либо адресный `userId`. Только активные токены.
- **`routes/adminPush.js`** (под `X-Admin-Key`): `GET/POST/PUT /campaigns`, `/:id`,
  `/:id/send` (атомарный claim `draft→sending`, защита от двойного клика), `/:id/cancel`,
  `POST /preview-audience` (охват до отправки), `POST /test` (пуш себе по `userId`/`token`
  без записи кампании), `GET /tokens/stats`. `X-Admin-Actor` пишет `created_by`.
- Миграция `db/migrate-011-push-campaigns.sql` (`push_campaigns`, `push_deliveries` с
  уникальным `(campaign_id, token)` против дублей). Зависимость `firebase-admin@^13`.
- Осталось для запуска: применить миграции 010/011 на проде, подключить `FIREBASE_SERVICE_ACCOUNT`
  + APNs-ключ (Firebase Console), доработать клиент (Unity) и вкладку «Пуши» на `bala-stories`.

## 2026-07-08 — Пуш-уведомления: Фаза 0 — приём device-токенов (DEV_PLAN_PUSH_NOTIFICATIONS)

- Старт новой подсистемы **пользовательских пуш-кампаний** (FCM). Это НЕ админ-алерты
  из `admin_alerts` — это пуши конечным пользователям приложения. План —
  `DEV_PLAN_PUSH_NOTIFICATIONS.md`, ТЗ клиенту — `CLIENT_TICKET_PUSH.md`.
- **`POST /api/push/register`** — устройство кладёт/обновляет FCM-токен
  (`userId/token/platform/appVersion/lang`). Идемпотентно, всегда `200`; upsert по токену,
  `disabled_at` снимается при повторной регистрации (устройство доказало, что живо).
- **`POST /api/push/unregister`** — мягко выключить токен (юзер отключил пуши / разлогин).
- Миграция `db/migrate-010-push.sql` (`push_tokens`), `services/pushTokens.js`,
  `routes/push.js`. Дебаг-логи под тегом `[PUSH]`.
- Отправки пока НЕТ — Фаза 0 только «прокладывает трубу», чтобы к готовности клиента
  токены уже складывались. Отправка/сегменты/панель — Фазы 1–3.

## 2026-07-05 — Зеркало полного лога + kill-switch (SERVER_LOG_MIRROR_SPEC)

- **`POST /api/debug/logs`** — приём батча строк лога Unity из живого билда
  (`level/message/stack`), bulk-insert в новую таблицу `debug_log_lines`.
  Fire-and-forget, всегда `200`; в ответ пиггибекается текущая политика (§3),
  чтобы `enabled:false` дошёл до клиентов без ожидания следующего старта.
- **`GET /api/debug/config?userId=`** — глушилка: `enabled`, `level` (`all|warn`),
  `flushSec`, `batchMax`. `hasConfig:true` обязателен. Разрешение политики:
  строка по userId → глобальная `'*'` → встроенный дефолт (ON, `all`).
- **Админ-управление** — `GET/PUT/DELETE /api/admin/debug/log-config`: выключить
  логи у всех без обновления клиента (`PUT { enabled:false }`), либо точечное
  переопределение по `userId`.
- **`GET /api/debug/logs`** (admin) — читалка флоу покупки сверху вниз
  (старые→новые), фильтры `userId/session/level`.
- Миграция `db/migrate-009-log-mirror.sql` (`debug_log_lines`, `debug_log_config`),
  ретеншн 30 дней в `diagnostics.cleanupOldRows`. Таблица отдельна от `debug_logs`
  (та — структурные IAP-события `ev/data`; здесь — сырые строки лога).

## 2026-07-05 — Аналитика: экран по сказке + платформенный фильтр + миниатюры

- **Per-tale deep dive** — `GET /api/analytics/tale/:id?since=&platform=`: кривая удержания по
  страницам, распределение выходов (`tale_abandon`), среднее время на странице (LEAD по
  `tale_page_view` в сессии). На промо-админке — клик по сказке открывает модалку с обложкой,
  KPI и графиками. Требует, чтобы клиент слал `tale_open`/`tale_page_view`/`tale_abandon` в зеркало
  (обновлён `CLIENT_TICKET_ANALYTICS.md §5`).
- **Платформенный фильтр** — `?platform=` в `/events` и `/insights`; на вкладке селектор
  (🧪 editor / iOS / Android) — изолирует тестовые прогоны из Unity Editor от боевых.
- **Миниатюры сказок** — `scripts/gen-tale-thumbs.js` кладёт уменьшенную первую иллюстрацию
  (`page_0`) в `/var/www/bala-stories/client/tale-thumbs`, отдаётся статикой (без запроса к API).
- `GET /api/admin/tales/:id/cover` — отдача обложки для админ-превью.

## 2026-07-05 — Аналитика: дашборд, подробные логи приёма, smoke-test

- **Дашборд зеркала** — `GET /api/analytics/dashboard` (HTML, admin-key в localStorage):
  воронка монетизации (`paywall_view → purchase_start → purchase_success` + ошибки/восстановления),
  счётчики по событиям, дочитывания сказок, живой поток событий (что реально прислал клиент,
  с фильтрами по name/session/userId) и легенда «что к чему». Незнакомые имена событий
  (опечатки в билде) подсвечиваются красным.
- **Подробный лог приёма** — одна читаемая строка на каждый батч в `routes/analytics.js`:
  `[ANALYTICS] ingest session=… platform=… v… user=jwt|body|anon events=N [name×k, ?unknown×k]`.
  Флаг `?` = имя не из вайтлиста, `dropped=` = отброшенные (пустое имя). Гасится `ANALYTICS_LOG=0`.
- **`scripts/analytics-smoketest.js`** — шлёт синтетический батч формы из handoff и читает
  обратно по admin-ключу, печатает PASS/FAIL. Проверка всего пути без сборки клиента.
  Прогон приёма на проде прошёл (200 на точную форму клиента).

## 2026-07-05 — Фаза 3 задеплоена в прод + Firebase-консоль + TTS

- **Аналитика выкачена в прод:** миграция `008-analytics` прогнана на прод-БД (таблица
  `analytics_events` + индексы); код `routes/analytics.js` задеплоен (`git pull` + `pm2 restart`).
  Smoke-test на проде прошёл — `POST /api/analytics/event` принимает батч, строки с `params`
  ложатся в БД.
- **Firebase-консоль настроена** (проект `bala-stories-afb46`, GA4): зарегистрированы iOS
  `com.mozz.fairyTales` / Android `com.tokengc.balastories`, включён BigQuery-экспорт
  (Daily, регион `us`, advertising identifiers off). Детский режим: Google-сигналы off,
  персонализация рекламы 0/307, consent OK, хранение данных 14 мес.
- **`CLIENT_TICKET_ANALYTICS.md`** — тикет для Unity-разработчика (SDK, детский режим,
  user-properties, инструментирование по `ANALYTICS_SPEC.md`, критерии приёмки).
- **TTS:** мягче для сказок — `edgeTts` применяет prosody (rate −8%, pitch −2Hz; override
  через env `TTS_RATE`/`TTS_PITCH`/`TTS_VOLUME`). Добавлен `scripts/tts-playground.js` (:5055).
- Осталось (клиент): Unity SDK + инструментирование; через ~24 ч проверить датасет
  `analytics_*` в BigQuery; QA событий в DebugView.

## 2026-07-04 — Firebase-аналитика (Фаза 3): backend-копия + спеки

- **`POST /api/analytics/event`** (`routes/analytics.js`) — своя копия клиентских GA4-событий
  (§3C), fire-and-forget без auth, приём батчей (до 50). Читатели под `X-Admin-Key`:
  `GET /api/analytics/events` (сырые), `GET /api/analytics/summary` (счётчики по имени).
- Миграция **`008-analytics`** — таблица `analytics_events`; ретеншн 30д в `cleanupOldRows`.
- **`ANALYTICS_SPEC.md`** — таксономия событий/параметров/user-properties + детский комплаенс
  (ТЗ для Unity). **`FIREBASE_SETUP.md`** — пошаговая настройка консоли (apps, BigQuery, DebugView).
- Клиентская часть (Firebase Unity SDK + инструментирование) — отдельный тикет клиенту.

## 2026-07-04 — Admin control, observability, admin-site catalog management

Крупная сессия: сервер стал единым источником правды по подпискам и каталогу,
добавлен веб-контроль библиотеки через сайт, мониторинг и уведомления.

### Подписки (Fairy backend)
- **Админ-контроль** (`X-Admin-Key`): `GET /api/admin/subscriptions` (список),
  `/{userId}` (карточка: entitlement + история событий + последний снимок),
  `POST .../grant|revoke|extend`. Ручной грант — `source='admin'`.
- **Приоритет ручного гранта:** валидация стора больше не понижает активный
  `admin`/`promo` (`upsertEntitlement(..., {protectManual:true})`); `grant`
  перекрывает активную стор-запись.
- **`POST /api/subscription/sync`** — снимки состояния клиента → `subscription_snapshots`.
- **`POST /api/debug/log`** (без авторизации) + `GET` (админ) — удалённые IAP-логи.
- **S2S Apple** включены: добавлен `APPLE_APP_APPLE_ID`, сертификаты на месте.
- **Google Play** подключён (сервис-аккаунт, `com.tokengc.balastories`).
- **Триал** (Apple `is_trial_period` / Google `paymentState=2`) отдаётся как обычный
  активный премиум — отдельная логика не требуется.
- Миграции: `006` (snapshots, debug_logs, catalog columns), `007` (admin_alerts).

### Уведомления админам (on-site, без Telegram)
- Таблица `admin_alerts` + `services/alerts.js` (дедуп по `dedup_key`).
- Алерты на: покупку (`validate`), продление/возврат/истечение (S2S), промо.
- `GET /api/admin/alerts` (лента + непрочитанные), `POST /api/admin/alerts/read`.
- На сайте — вкладка **«Активность»**: лента с иконками, бейдж непрочитанного, поллинг 30с.

### Каталог библиотеки (полное управление с сайта)
- Админ-CRUD: `GET/POST/PATCH/DELETE /api/admin/tales`, `coming-soon`/`publish`/`reorder`,
  `GET /{id}` (детали для редактора), `GET /{id}/content-check`.
- **Сценарий текста — файлом, отдельно на каждый язык** (`POST /{id}/scenario?lang=`,
  JSON `{id,title,lang,pages}`); переводы опциональны. Пример — `client/example-tale.json`.
- **Обложка** (`POST /{id}/cover`) — сохраняется и отдаётся как **PNG** (`image/png`),
  cap 1024px. Иллюстрации — JPEG 2048px (mozjpeg q82), как остальные сказки.
- **Иллюстрации**: по одной (`/illustration/:page?gender=`) и **пакетно zip**
  (`/illustrations-zip`, имена `page_N[_boy|_girl]`, вложенные папки, авто-конверт).
- **content-check**: ловит нет `page_0`, непарные boy/girl, нет обложки, лишние
  иллюстрации сверх числа страниц; для bundled — предупреждения, не блок.
- **Сортировка каталога — по дате выкладки** (`min(created_at)`), новые снизу
  (поле «Порядок» убрано).
- **`langs`** в `GET /api/tales` — только языки с реальным текстом (title-only язык
  не выдаётся клиенту как перевод); `titles` — на всех языках.

### Наблюдаемость (Fairy backend)
- Стартовый баннер конфигурации (`utils/diagnostics.js`): DB/Apple/Google/certs/keys.
- Глобальный HTTP-логгер с маскировкой секретов (`[HTTP]`/`[HTTP!]`, `DEBUG_HTTP=0` для тишины).
- `GET /api/admin/debug/overview` + `/config`: конфиг, БД, счётчики entitlements, последние
  события/снимки/логи/ошибки.
- `unhandledRejection`/`uncaughtException` в лог; ежедневная чистка debug_logs>14д, snapshots>30д.
- Теги логов: `[IAP] [ADMIN] [PROXY] [PUSH]/[ALERT] [HTTP] [BOOT] [FATAL] [CLEANUP]`.

### Админ-сайт (bala-stories, аддитивно, промо не тронут)
- BFF-прокси `/api/catalog/*` и `/api/alerts` (`server/src/lib/fairyProxy.ts`) —
  инъекция `X-Admin-Key` только на сервере, стриминг multipart, `[PROXY]`-логи.
- Вкладки **«Сказки»** (редактор: ID, названия по языкам, статус/free/coming, сценарий
  по языкам, обложка, иллюстрации + zip, content-check) и **«Активность»**.
- **Прогресс-бар** загрузок (XHR upload progress + индикатор «Обработка на сервере…»).
- URL: https://promocode-stories.apiapp.kz (вход существующим админ-логином).

### Инфраструктура
- `ADMIN_KEY` в прод `.env` фейри; `FAIRY_API_URL`/`FAIRY_ADMIN_KEY` в bala `.env`.
- **nginx bala**: `client_max_body_size 1024M` + `proxy_read_timeout 600s` (дефолт 1M
  ломал загрузку архивов 413). Multer zip-лимит на фейри — 1 ГБ.

### Документация
- `API.md`: раздел «Подписки и премиум» (клиент дёргает `/status` на старте, гасит
  премиум только по `active:false`), «Админ-API» (подписки/каталог/debug).
- `DEV_PLAN_SITE_PUSH_ANALYTICS.md`: план (библиотека → пуши → Firebase-аналитика).
- `SERVER_ENTITLEMENT_SPEC.md` / `SERVER_LIBRARY_SPEC.md` — уточнены.

### Осталось / на будущее
- Фаза 3 — **Firebase-аналитика** (клиентский SDK + события; готовится `ANALYTICS_SPEC.md`).
- Не-bundled сказки без обложки (`baursak` и др.) — догрузить PNG-обложки через сайт.
- Клиентское изменение: `userId` теперь device-based (`SERVER_ENTITLEMENT_SPEC.md §0.1`);
  сервер совместим (GUID-валидации нет).
