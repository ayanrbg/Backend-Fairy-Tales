# [Клиент/Unity] Дублировать события чтения в зеркало аналитики

**Тип:** Feature (небольшая) · **Приоритет:** Medium · **Компонент:** Unity-клиент (iOS + Android)
**Связано:** `CLIENT_TICKET_ANALYTICS.md §5`, `ANALYTICS_SPEC.md §2.3 / §5`, `SERVER_ANALYTICS_MIRROR_HANDOFF.md`

**Зачем:** на нашей админке (`promocode-stories.apiapp.kz` → вкладка «Аналитика» → клик по сказке)
есть экран по каждой сказке: кривая удержания по страницам, где выходят из сказки, сколько времени
читают каждую страницу. Чтобы он наполнился, клиент должен слать 3 события чтения **ещё и в наш
backend** (в Firebase GA4 они уже уходят — их не трогаем, просто добавляем ту же отправку в наш
endpoint).

**На сервере менять ничего не надо** — приёмник уже принимает эти события. Нужен только клиент.

## Endpoint (тот же, что для остального зеркала)

```
POST https://bala-stories.apiapp.kz:3000/api/analytics/event
Content-Type: application/json
```

Fire-and-forget (ответ игнорируем, всегда 200), батч ≤ 50 событий, тот же батч-механизм, что уже
используется для `purchase_*` / `tale_complete`.

## Что добавить в зеркало

| Событие | Когда шлём | Параметры (тип) |
|---|---|---|
| `tale_open` | открыт ридер сказки | `tale_id` (string) |
| `tale_page_view` | показана страница (на **каждую** смену страницы, дебаунс ~1 c) | `tale_id` (string), `page_index` (int, с 0), `total_pages` (int) |
| `tale_abandon` | вышел/свернул до конца (если не было `tale_complete`) | `tale_id` (string), `page_index` (int), `percent` (int 0–100) |

`tale_complete` уже в зеркале — оставляем как есть.

## Обязательные правила

- `tale_id` = **серверный slug** (стабильный id из `GET /api/tales`), не локализованный заголовок.
- `page_index` — **с 0**.
- `ts` — Unix epoch в **миллисекундах**.
- `platform` — `"ios"` / `"android"` на устройстве и **`"editor"`** в Unity Editor (по нему на сайте
  отделяются тестовые прогоны от боевых).
- **Без PII** (имя ребёнка, email и т.п.) — как и в остальной аналитике.

## Пример тела запроса

```json
{
  "session": "a1b2c3d4e5f6",
  "platform": "ios",
  "appVersion": "1.4.0",
  "events": [
    { "name": "tale_open",      "ts": 1720099200000, "params": { "tale_id": "white_camel" } },
    { "name": "tale_page_view", "ts": 1720099205000, "params": { "tale_id": "white_camel", "page_index": 0, "total_pages": 12 } },
    { "name": "tale_page_view", "ts": 1720099230000, "params": { "tale_id": "white_camel", "page_index": 1, "total_pages": 12 } },
    { "name": "tale_abandon",   "ts": 1720099260000, "params": { "tale_id": "white_camel", "page_index": 1, "percent": 8 } }
  ]
}
```

## Пример на C# (в тех же местах, где уже шлёте в GA4)

Предполагается, что у вас уже есть хелпер отправки в зеркало (как для `purchase_*`). Просто добавьте
те же вызовы:

```csharp
// при открытии сказки
Mirror.Track("tale_open", new() { ["tale_id"] = taleSlug });

// на каждой смене страницы (дебаунс ~1 c, чтобы быстрое пролистывание не раздувало объём)
Mirror.Track("tale_page_view", new() {
    ["tale_id"] = taleSlug, ["page_index"] = pageIndex, ["total_pages"] = totalPages });

// при выходе из ридера, если сказку НЕ дочитали
if (!completed)
    Mirror.Track("tale_abandon", new() {
        ["tale_id"] = taleSlug, ["page_index"] = pageIndex,
        ["percent"] = Mathf.RoundToInt(100f * (pageIndex + 1) / totalPages) });

// platform: "editor" в редакторе
string platform = Application.isEditor ? "editor"
                : Application.platform == RuntimePlatform.IPhonePlayer ? "ios" : "android";
```

## Объём

Поток `tale_page_view` — самый частый. У детского приложения он умеренный, а зеркало хранит только
30 дней, так что дублировать ок. Если окажется много — дебаунс ~1 c (уже рекомендован) или
сэмплирование на клиенте.

## Как проверить (без релиза, из Unity Editor)

1. Запусти игру в Editor (клиент шлёт `platform: "editor"`).
2. На сайте → **Аналитика** → выбери платформу **🧪 editor (тест)**, включи **авто 10с**.
3. Открой сказку, полистай, выйди на середине / дочитай.
4. Через ~15 c: в **живом потоке** появятся `tale_open` / `tale_page_view` / `tale_abandon`, а по
   клику на сказку — **кривая удержания, выходы и время на странице**. Незнакомое/опечатанное имя
   события подсветится красным `?`.

## Definition of Done

- [ ] `tale_open`, `tale_page_view`, `tale_abandon` уходят в `POST /api/analytics/event` (не только в GA4).
- [ ] `tale_id` = slug, `page_index` с 0, `ts` в мс, `platform=editor` в редакторе.
- [ ] На сайте по одной сказке end-to-end видно удержание по страницам и точку выхода.
- [ ] Без PII.
