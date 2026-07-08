# FIREBASE_SETUP — настройка проекта под аналитику (DEV_PLAN §3B, §3D)

Пошаговый гайд по консоли Firebase. Все шаги — **ручные клики в консоли** (не
автоматизируются из репозитория). Firebase-проект уже существует, доступ есть.

**Приложения:**
- iOS  — bundle id `com.mozz.fairyTales`
- Android — package `com.tokengc.balastories`

---

## 1. Регистрация приложений в проекте

Firebase Console → нужный проект → ⚙ **Project settings** → **Your apps**.

### iOS
1. **Add app → iOS**. Bundle ID: `com.mozz.fairyTales`. App nickname: `FairyTales iOS`.
2. Скачать **`GoogleService-Info.plist`** → отдать клиентскому разработчику (кладётся в Unity
   `Assets/`, подхватывается Firebase Unity SDK при сборке iOS).
3. App Store ID можно указать позже (не блокирует аналитику).

### Android
1. **Add app → Android**. Package: `com.tokengc.balastories`. Nickname: `Bala Android`.
2. Скачать **`google-services.json`** → клиентскому разработчику (Unity `Assets/`, iOS/Android
   плагин Firebase раскладывает по платформам).
3. SHA-1 — не требуется для GA4 (нужен только для Auth/Dynamic Links).

> Оба конфиг-файла — секреты сборки, в git приложения их обычно не коммитят открыто.
> В этот backend-репозиторий они НЕ нужны.

---

## 2. Google Analytics включён

- При создании проекта GA должен быть включён. Проверить: **Project settings → Integrations →
  Google Analytics** = enabled, привязан GA4-property.
- Убедиться, что оба приложения (iOS/Android) видны как **data streams** в GA4:
  Google Analytics → Admin → Data streams.

---

## 3. BigQuery-экспорт (включить СРАЗУ — §3B)

Даёт SQL-доступ к сырым событиям (глубина чтения строится там).

1. Firebase Console → ⚙ **Project settings → Integrations → BigQuery → Link** (или GA4 → Admin →
   BigQuery Links).
2. Выбрать data streams (iOS + Android).
3. Тип экспорта: **Daily** (обязательно) + опц. **Streaming** (near-real-time, тарифицируется).
4. Регион датасета выбрать осознанно (менять потом нельзя) — ближе к команде/сторам.
5. После линковки в BigQuery появится датасет `analytics_<property_id>` с таблицами
   `events_YYYYMMDD` (daily) / `events_intraday_*` (streaming).

> Первый daily-экспорт приходит через ~24 ч. Для проверки «здесь и сейчас» — DebugView (§4).

---

## 4. QA событий через DebugView (до релиза — §3B)

1. Включить debug-режим на устройстве/в сборке:
   - iOS: launch argument `-FIRDebugEnabled` (в Unity — debug-сборка Firebase).
   - Android: `adb shell setprop debug.firebase.analytics.app com.tokengc.balastories`.
2. Firebase Console → Analytics → **DebugView** → выбрать устройство.
3. Прогнать сценарий из `ANALYTICS_SPEC.md §6`: открыть сказку → листать → купить (sandbox) —
   проверить, что события и параметры (`tale_id`, `page_index`, `percent`, …) корректны.
4. Отключить debug-режим перед релизом: `adb shell setprop debug.firebase.analytics.app .none`.

---

## 5. Children / комплаенс (КРИТИЧНО — §3D)

Детское приложение → без этого риск блокировки в сторах (COPPA / GDPR-K / Google Families).

- **Отключить сбор Advertising ID и персонализацию рекламы** на клиенте (Firebase Unity SDK):
  - глобально: `FirebaseAnalytics.SetAnalyticsCollectionEnabled(true)` — да, но
  - `FirebaseAnalytics.SetUserProperty("allow_personalized_ads", "false")` и НЕ линковать
    Google Ads / AdMob-персонализацию;
  - iOS: не запрашивать IDFA / ATT для рекламы; Android: не подключать `google-services` рекламные
    компоненты.
- В **GA4 → Admin → Data Settings → Data Collection**: выключить Google signals и
  ad personalization для property.
- **Tag for Child-Directed treatment**: если используется реклама/AdMob — включить child-directed
  флаги. По плану пользовательских кампаний/рекламы нет, поэтому проще не подключать рекламные SDK
  вовсе.
- **Consent-флоу** (если требуется юрисдикцией) согласовать до релиза. Sign-off — обязателен.
- **PII не собираем** (имя ребёнка и т.п.) — гарантируется таксономией `ANALYTICS_SPEC.md`.

---

## 5bis. Cloud Messaging (FCM) — для пуш-уведомлений

Нужно для подсистемы пользовательских пушей (`DEV_PLAN_PUSH_NOTIFICATIONS.md`). Тот же
Firebase-проект — отдельного заводить не надо. Все шаги — ручные клики в консоли.

### 5bis.1. APNs-ключ для iOS (обязательно, иначе iOS-пуши не уходят)
1. Apple Developer → **Certificates, Identifiers & Profiles → Keys** → **+** → включить
   **Apple Push Notifications service (APNs)** → скачать `.p8` (скачивается один раз!),
   запомнить **Key ID** и **Team ID**.
2. Firebase Console → ⚙ **Project settings → Cloud Messaging → Apple app configuration →
   APNs Authentication Key → Upload**: залить `.p8`, указать Key ID и Team ID.

### 5bis.2. Android
- FCM работает «из коробки» после регистрации приложения (§1). Отдельных ключей не нужно
  (legacy Server Key не используем — шлём через service-account, см. ниже).

### 5bis.3. Service account для нашего бэкенда (серверный секрет)
1. Firebase Console → ⚙ **Project settings → Service accounts → Generate new private key** →
   скачать JSON.
2. Положить на Fairy-сервер как секрет и прописать в `.env`:
   `FIREBASE_SERVICE_ACCOUNT=/var/www/Backend-Fairy-Tales/secrets/fcm-service-account.json`
   (или вставить сам JSON в переменную). **В git не коммитим.** Файл должен быть вне репозитория
   или в `.gitignore`.
3. Проверка: `GET /api/admin/push/tokens/stats` вернёт `{ "configured": true, ... }`.

> До появления ключа подсистема пушей деплоится и принимает токены, но `configured:false`
> и отправка отвечает `503 fcm_not_configured` — это ожидаемо.

---

## 6. Дашборды (минимум — §3E)

После наполнения данных собрать 3 отчёта (GA4 Explore или BigQuery):
1. **Воронка чтения** по `page_index` (`tale_open → tale_page_view → tale_complete`).
2. **Воронка покупки** (`paywall_view → purchase_success`).
3. **Retention** с фильтром по user_property `is_premium`.

---

## 7. Чек-лист (§3F)

- [ ] iOS и Android приложения зарегистрированы, конфиг-файлы у клиентского разработчика.
- [ ] GA4 property привязан, оба data stream видны.
- [ ] BigQuery-экспорт включён (daily), датасет создан.
- [ ] События проверены в DebugView (параметры корректны).
- [ ] Children mode: ad personalization / Advertising ID отключены, PII не улетает.
- [ ] 3 базовых отчёта собраны.

---

## Связанные документы
- `ANALYTICS_SPEC.md` — таксономия событий (ТЗ клиенту).
- `DEV_PLAN_SITE_PUSH_ANALYTICS.md` §3 — исходный план фазы.
- `routes/analytics.js` — опциональная backend-копия событий (§3C).
