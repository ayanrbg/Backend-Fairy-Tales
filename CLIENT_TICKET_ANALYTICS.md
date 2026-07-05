# [Клиент/Unity] Firebase-аналитика (GA4): подключение SDK + инструментирование событий

**Тип:** Feature · **Приоритет:** High · **Компонент:** Unity-клиент (iOS + Android)
**Связанные документы:** `ANALYTICS_SPEC.md` (таксономия — источник правды), `FIREBASE_SETUP.md`
**Фаза:** 3 (аналитика) из `DEV_PLAN_SITE_PUSH_ANALYTICS.md`

---

## Контекст

Backend и Firebase-проект уже готовы:
- Firebase-проект **`bala-stories-afb46`** (GA4), BigQuery-экспорт включён.
- Приложения зарегистрированы: iOS `com.mozz.fairyTales`, Android `com.tokengc.balastories`.
- Детский режим в GA4 настроен (Google signals off, ad personalization off).
- Опциональный backend-приёмник событий живой: `POST /api/analytics/event`.

**Осталась клиентская часть — это ядро фазы.** Событие «докуда дочитал ребёнок» знает только
приложение, сервер тут вторичен.

## Что даётся разработчику

1. `GoogleService-Info.plist` (iOS) — положить в `Assets/`.
2. `google-services.json` (Android) — положить в `Assets/`.
3. `ANALYTICS_SPEC.md` — **полная таксономия событий, параметров и user-properties. Реализовывать
   строго по ней** (имена событий/параметров менять нельзя — на них завязаны дашборды и BigQuery).

---

## Задачи

### 1. Подключить Firebase Unity SDK (GA4)
- Импортировать Firebase Analytics SDK, разложить конфиг-файлы (plist/json) по платформам.
- Инициализировать на старте, проверить `FirebaseApp` доступен до первого события.

### 2. Детский режим (ОБЯЗАТЕЛЬНО — требование сторов, `ANALYTICS_SPEC.md §Правило №1`)
- **Не собирать Advertising ID / IDFA**, не запрашивать ATT ради рекламы.
- Отключить ad personalization: `SetUserProperty("allow_personalized_ads", "false")`, не подключать
  рекламные/AdMob SDK.
- **Не отправлять PII** (имя ребёнка, email) ни в одном событии/параметре. Пол — только
  `child_gender` (`boy`/`girl`/`unset`).

### 3. User properties (`ANALYTICS_SPEC.md §1`)
Проставлять на старте и обновлять при изменении:
`is_premium`, `premium_source`, `app_language`, `child_gender`, `has_cloned_voice`.
`SetUserId(...)` = тот же device-based `userId`, что уходит на backend (это не PII).

### 4. Инструментировать события (`ANALYTICS_SPEC.md §2`)
Полный список — в спеке. Обязательный минимум по группам:
- **Онбординг:** `onboarding_start/step/complete`, `profile_set`.
- **Библиотека:** `library_view`, `tale_card_click`, `tale_download_start/complete/error`.
- **Чтение (ядро — «глубина дочитывания»):** `tale_open`, **`tale_page_view`** (`page_index`,
  `percent`, `total_pages` — слать на каждую смену страницы, дебаунс ~1 c), `tale_complete`,
  `tale_abandon`.
- **Озвучка:** `narration_play/pause/complete`, `voice_clone_start/success/error`.
- **Монетизация:** `paywall_view`, `purchase_start`, **`purchase_success`** (ровно 1 раз на покупку),
  `purchase_error`, `promo_redeem`.
- **Ошибки:** `app_error`, `content_missing`.

> `tale_id` во всех событиях сказки = серверный **slug** (стабильный id из `GET /api/tales`), НЕ
> локализованный заголовок.

### 5. Дублировать события в наш backend (`ANALYTICS_SPEC.md §5`)
Для быстрого дебага и **своего дашборда аналитики** (на промо-админке есть вкладка «Аналитика»
поверх этого зеркала):
- `POST https://<fairy-host>:3000/api/analytics/event`, без авторизации, fire-and-forget, батч ≤ 50.
- **Монетизация/итоги (обязательно):** `paywall_view`, `paywall_dismiss`, `purchase_start`,
  `purchase_success`, `purchase_error`, `purchase_restore`, `promo_redeem`, `tale_complete`.
- **Чтение — для по-страничной аналитики на нашем сайте (новое, желательно):** `tale_open`,
  **`tale_page_view`** (`tale_id`, `page_index`, `total_pages` — можно с дебаунсом ~1 c),
  `tale_abandon` (`tale_id`, `page_index`, `percent`).
  > Именно эти три события строят на нашем сайте экран по сказке: кривую удержания по страницам,
  > где выходят из сказки и сколько времени читают каждую страницу. Без них этот экран пустой
  > (в GA4/BigQuery данные всё равно есть, но на нашей админке — нет).
  > Объём: у детского приложения поток `tale_page_view` умеренный, а зеркало хранит лишь 30 дней,
  > так что дублировать их сюда — ок. Если поток окажется большим — дебаунс/сэмплирование на клиенте.
- `platform`: слать `ios`/`android` на устройствах и **`editor`** в Unity Editor (по нему на сайте
  отделяются тестовые прогоны от боевых).
- Формат тела — в `ANALYTICS_SPEC.md §5`.

---

## Критерии приёмки (Definition of Done)

- [ ] Все события из §2 спеки видны в Firebase **DebugView** с корректными параметрами.
- [ ] `tale_page_view` строит воронку по `page_index` (проверить на 1 сказке end-to-end).
- [ ] `purchase_success` срабатывает **ровно один раз** на покупку (не дублируется).
- [ ] User properties проставляются и обновляются (`is_premium` меняется после покупки/истечения).
- [ ] Детский режим: Advertising ID / ad personalization НЕ собираются; PII не улетает
      (ни в GA4, ни в `/api/analytics/event`).
- [ ] Собран тестовый прогон: онбординг → открыть сказку → долистать до конца → тест-покупка
      (sandbox) — все события в DebugView в правильном порядке.

## Вне scope этого тикета
- Настройка Firebase-консоли, BigQuery, дашбордов (сделано на стороне бэкенда/консоли).
- Backend-приёмник `/api/analytics/event` (реализован и задеплоен).

## Как проверять (DebugView)
- iOS: launch argument `-FIRDebugEnabled`.
- Android: `adb shell setprop debug.firebase.analytics.app com.tokengc.balastories`.
- Firebase Console → Analytics → **DebugView** → выбрать устройство.
- Выключить перед релизом: `adb shell setprop debug.firebase.analytics.app .none`.
