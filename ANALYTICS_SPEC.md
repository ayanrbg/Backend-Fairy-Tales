# ANALYTICS_SPEC — таксономия событий (Firebase GA4)

ТЗ для клиента (Unity). Версия таксономии: **v1**. Источник — `DEV_PLAN_SITE_PUSH_ANALYTICS.md`
Фаза 3. Backend вторичен: аналитику знает только приложение (докуда дочитал, какой экран).

> **Правило №1 (детское приложение).** НЕ отправлять PII. Имя ребёнка, email, точную
> геолокацию — **никогда**. Пол ребёнка — только как параметр `child_gender`. Детский
> режим (отключение Advertising ID / персонализации рекламы) — обязателен, см.
> `FIREBASE_SETUP.md §Children`.

---

## 0. Соглашения

- **Имена событий и параметров**: `snake_case`, латиница, ≤ 40 символов (лимит GA4).
- **Не более 25 параметров** на событие (лимит GA4). Значения строк ≤ 100 символов.
- **`tale_id`** во всех событиях сказки = серверный `slug` (стабильный id из `GET /api/tales`),
  НЕ локализованный заголовок.
- **Время**: события шлём в момент действия; клиент буферизует офлайн и досылает (см. §5).
- **Версионирование**: при изменении смысла события — не переименовывать, а добавлять новое
  (`*_v2`) либо новый параметр. Значение `schema_version` можно слать как user_property.

---

## 1. User properties (свойства пользователя)

Ставятся один раз при старте и обновляются при изменении. Задаются
`FirebaseAnalytics.SetUserProperty(...)`.

| Property | Тип/значения | Когда обновлять |
|----------|--------------|-----------------|
| `is_premium` | `"true"` / `"false"` | при старте по `/api/subscription/status` и после покупки/истечения |
| `premium_source` | `apple` / `google` / `promo` / `admin` / `none` | вместе с `is_premium` |
| `app_language` | `ru` / `kk` / `en` / … | при старте и при смене языка интерфейса |
| `child_gender` | `boy` / `girl` / `unset` | после онбординга/смены профиля |
| `has_cloned_voice` | `"true"` / `"false"` | после успешного клонирования голоса |
| `app_language_content` | язык контента, если отличается от UI | при выборе языка сказки |

> `SetUserId` — можно ставить device-based `userId` (тот же, что уходит на backend,
> см. `SERVER_ENTITLEMENT_SPEC §0.1`). Это НЕ PII (IDFV/Android id). Позволяет сшить
> аналитику с подписками в BigQuery.

---

## 2. События

Ниже — канонический список. Колонка «Параметры» — обязательные жирным.

### 2.1 Онбординг

| Событие | Когда | Параметры |
|---------|-------|-----------|
| `app_open` | холодный старт (GA4 шлёт `session_start` сам; это доп. маркер) | `is_premium` |
| `onboarding_start` | показан первый экран онбординга | — |
| `onboarding_step` | завершён шаг | **`step_index`** (int), `step_name` |
| `onboarding_complete` | онбординг пройден | `child_gender`, `app_language` |
| `profile_set` | задан/изменён профиль ребёнка | `child_gender` |

### 2.2 Библиотека / каталог

| Событие | Когда | Параметры |
|---------|-------|-----------|
| `library_view` | открыт экран библиотеки | `tales_count` (int) |
| `tale_card_click` | тап по карточке сказки | **`tale_id`**, `is_free` (bool), `coming_soon` (bool) |
| `tale_coming_soon_click` | тап по «Скоро» | **`tale_id`** |
| `tale_download_start` | начата загрузка контента сказки | **`tale_id`**, `download_size_mb` (number) |
| `tale_download_complete` | загрузка завершена | **`tale_id`**, `duration_ms` (int) |
| `tale_download_error` | ошибка загрузки | **`tale_id`**, **`error_code`**, `error_message` |

### 2.3 Чтение (ядро — «докуда дочитал»)

| Событие | Когда | Параметры |
|---------|-------|-----------|
| `tale_open` | открыт ридер сказки | **`tale_id`**, `is_free`, `language`, `child_gender` |
| `tale_page_view` | показана страница | **`tale_id`**, **`page_index`** (int, с 0), **`percent`** (0–100), `total_pages` (int) |
| `tale_complete` | достигнута последняя страница | **`tale_id`**, `total_pages`, `duration_ms` |
| `tale_abandon` | выход из ридера до конца | **`tale_id`**, **`page_index`**, **`percent`**, `duration_ms` |

> **Глубина дочитывания — главный запрос продукта.** `tale_page_view` с `page_index`/`percent`
> строит воронку. Слать на КАЖДУЮ смену страницы (дебаунс ~1 c, чтобы быстрый пролистывания
> не раздували объём). `tale_abandon` — при выходе/сворачивании, если не было `tale_complete`.

### 2.4 Озвучка / персонализация

| Событие | Когда | Параметры |
|---------|-------|-----------|
| `narration_play` | запущено воспроизведение озвучки | **`tale_id`**, `voice_type` (`default`/`cloned`), `page_index` |
| `narration_pause` | пауза | **`tale_id`**, `page_index` |
| `narration_complete` | озвучка страницы/сказки доиграла | **`tale_id`** |
| `voice_clone_start` | пользователь начал клонирование голоса | — |
| `voice_clone_success` | голос склонирован | `duration_ms` |
| `voice_clone_error` | ошибка клонирования | **`error_code`**, `error_message` |

### 2.5 Монетизация

| Событие | Когда | Параметры |
|---------|-------|-----------|
| `paywall_view` | показан пейволл | **`source`** (`tale_locked`/`onboarding`/`settings`/…), `tale_id` (если из сказки) |
| `paywall_dismiss` | закрыт без покупки | **`source`** |
| `purchase_start` | тап по кнопке покупки | **`product_id`**, **`source`** |
| `purchase_success` | покупка подтверждена (после `validate` = active) | **`product_id`**, `price`, `currency`, `is_trial` (bool) |
| `purchase_error` | ошибка/отмена покупки | **`product_id`**, **`error_code`** |
| `purchase_restore` | восстановление покупок | `restored` (bool) |
| `promo_redeem` | активирован промокод | `success` (bool) |

> Для дохода в GA4 используйте штатное событие `purchase` с `value` + `currency`, если хотите
> денежные отчёты «из коробки»; наши `purchase_*` — продуктовая воронка. Можно слать оба.

### 2.6 Ошибки / системное

| Событие | Когда | Параметры |
|---------|-------|-----------|
| `app_error` | пойманная негромкая ошибка | **`error_code`**, `error_message`, `context` |
| `content_missing` | клиент решил, что контент сказки не докачан | **`tale_id`**, `missing` (что именно) |

---

## 3. Стандартные значения enum

- `child_gender`: `boy` | `girl` | `unset`
- `voice_type`: `default` | `cloned`
- `premium_source`: `apple` | `google` | `promo` | `admin` | `none`
- `paywall source`: `tale_locked` | `onboarding` | `settings` | `library` | `deep_link`
- `platform` (для backend-копии, §5): `ios` | `android` | `editor`

---

## 4. Воронки, которые из этого собираются (§3E плана)

1. **Глубина чтения**: `tale_open` → `tale_page_view (page_index=0..N)` → `tale_complete`.
   По `percent`/`page_index` видно, где бросают.
2. **Деньги**: `paywall_view` → `purchase_start` → `purchase_success`.
3. **Retention по `is_premium`**: стандартный GA4 retention с фильтром по user_property.

---

## 5. Дублирование в наш backend (опционально, §3C — уже реализовано)

Клиент МОЖЕТ (не обязан) дублировать критичные события в наш API, чтобы иметь копию данных
независимо от Google. Это НЕ замена GA4, а страховка/быстрый дебаг.

**Endpoint:** `POST https://<fairy-host>/api/analytics/event` — без авторизации (как
`/api/debug/log`); если есть JWT — userId берётся из токена. Всегда `200`, fire-and-forget.

**Батч (рекомендуется):**
```json
{
  "session": "<uuid сессии>",
  "platform": "ios",
  "appVersion": "1.4.0",
  "events": [
    { "name": "tale_open",      "ts": 1720099200000, "params": { "tale_id": "goldfish", "is_free": true, "language": "ru" } },
    { "name": "tale_page_view", "ts": 1720099210000, "params": { "tale_id": "goldfish", "page_index": 0, "percent": 8, "total_pages": 12 } }
  ]
}
```
Одиночное событие тоже принимается: `{ "name": "...", "ts": ..., "params": {...}, "session": ..., "platform": ..., "appVersion": ... }`.

Лимиты: до **50** событий на запрос, имя события ≤ 64 символа. `ts` — Unix ms.
**Не слать PII** и сюда — те же правила, что для GA4.

**Что дублировать:** минимально — монетизацию (`purchase_*`, `paywall_view`) и `tale_complete`.
Полный поток `tale_page_view` дублировать не нужно (объём) — для глубины чтения есть BigQuery.

**Чтение (админ, `X-Admin-Key`):**
- `GET /api/analytics/events?name=&userId=&session=&since=&limit=` — сырые события.
- `GET /api/analytics/summary?since=` — счётчики по имени события (быстрый sanity-check).

Хранение — 30 дней (это копия, не хранилище). Долгую аналитику держит BigQuery.

---

## 6. Чек-лист сдачи клиентской части (из §3F)

- [ ] События из §2 видны в Firebase **DebugView** с корректными параметрами.
- [ ] `tale_page_view` строит воронку по `page_index` (проверить на 1 сказке end-to-end).
- [ ] `purchase_success` срабатывает ровно один раз на покупку.
- [ ] User properties проставляются и обновляются (`is_premium` после покупки).
- [ ] Детский режим включён: Advertising ID / ad personalization НЕ собираются.
- [ ] PII (имя ребёнка) не улетает ни в GA4, ни в `/api/analytics/event`.
- [ ] BigQuery-экспорт наполняется (см. `FIREBASE_SETUP.md`).
