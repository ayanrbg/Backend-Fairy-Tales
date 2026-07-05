# [Сервер] `farhad` ошибочно помечен `bundled: true` → клиент не показывает размер скачивания

**Тип:** Bug (данные каталога) · **Приоритет:** Medium · **Компонент:** Backend (каталог `GET /api/tales`)
**Связано:** `API.md §5` (поля `bundled`/`downloadSize`), `SERVER_LIBRARY_SPEC.md`

## Симптом (клиент)

В библиотеке у сказки **«Фархад»** карточка показывает кнопку скачивания, но **без размера** («53,4 МБ» и т.п.).
У всех остальных серверных сказок (Баурсак, Волшебная птица, Одеялко…) размер отображается.

## Причина

`GET /api/tales` отдаёт по `farhad`:

```json
{ "id": "farhad", "bundled": true, "comingSoon": false }   // downloadSize ОТСУТСТВУЕТ
```

По спеке (`API.md §5`) у `bundled: true` сервер **намеренно не отдаёт** `downloadSize`
(«Отсутствует если `bundled: true`»). Клиент показывает размер только когда `downloadSize > 0`,
поэтому текст скрыт.

**Но `farhad` НЕ встроен в клиент.** Клиент встраивает ровно одну сказку — `golden_egg`
(`StreamingAssets/BundledTales/manifest.json`). Флаг `bundled` из API клиент для этого не читает,
поэтому `farhad` он честно качает с сервера — и иллюстрации там реально есть:

```
GET /api/tales/farhad            → totalPages: 131, bundled: true
GET /api/tales/farhad/illustration/0 → HTTP 200, 241570 байт
```

Итого: у сказки есть 131 страница иллюстраций на сервере, но она помечена как «встроенная»,
из-за чего размер не считается и не отдаётся.

## Что не так с данными

`bundled: true` должно означать «иллюстрации вшиты в клиент, скачивать нечего». Для `farhad` это
неверно — правильный флаг **`bundled: false`** с реальным `downloadSize` (как у `white_camel`,
`baursak`, `magic_bird` и остальных).

`bundled`/`downloadSize` не редактируются через `PATCH /api/admin/tales/{id}` (их там нет), значит
они выставляются/вычисляются на бэке при загрузке сказки. Скорее всего у `farhad` в БД стоит
`bundled=true`, а расчёт `downloadSize` для bundled-сказок пропускается — отсюда пустое поле.

## Fix

1. Проставить `farhad` → **`bundled = false`**.
2. Пересчитать и записать `downloadSize` = суммарный размер всех иллюстраций в байтах,
   **включая обе гендерные версии** (`page_N_boy` + `page_N_girl`) — как для прочих серверных сказок.
3. Проверить, почему `farhad` вообще получил `bundled=true` (ошибка импорта? ручная правка?),
   чтобы не повторилось на новых загрузках.

**Проверка после фикса** — в ответе `GET /api/tales` должно быть:

```json
{ "id": "farhad", "bundled": false, "downloadSize": <реальные байты>, "comingSoon": false }
```

Клиент подхватит автоматически, изменений на клиенте не требуется.

## Аудит остального каталога (проверено 2026-07-05)

`bundled: true` в проде стоит у двух сказок:

| id | bundled | downloadSize | Встроена в клиент (manifest.json)? | Вердикт |
|----|---------|--------------|-----------------------------------|---------|
| `golden_egg` | true | — | **да** (единственная) | ✅ корректно |
| `farhad` | true | — | **нет** | ❌ баг — см. выше |

Все прочие готовые сказки: `bundled: false` + ненулевой `downloadSize` — ок
(`white_camel` 40.9 МБ, `baursak` 56.0 МБ, `magic_bird` 67.7 МБ, `odeyalko` 55.3 МБ,
`old_books` 33.1 МБ, `three_batyrs` 39.5 МБ, `space_race` 28.8 МБ, `testovaya` 31.1 МБ).
Coming-soon сказки без размера — ожидаемо (у них нет страниц).

> **Правило на будущее:** `bundled: true` допустимо **только** если сказка есть в клиентском
> `StreamingAssets/BundledTales/manifest.json`. Сейчас там один `golden_egg`. Любая другая сказка,
> помеченная `bundled: true`, повторит этот баг.

## Definition of Done

- [x] `GET /api/tales` для `farhad` отдаёт `bundled: false` + реальный `downloadSize` (обе гендерные версии). — проверено на проде: `bundled:false, downloadSize:48961652` (46.7 МБ).
- [ ] В библиотеке на карточке «Фархад» виден размер скачивания. — на стороне клиента; API отдаёт корректно, изменений на клиенте не требуется.
- [x] Установлена причина ошибочного `bundled=true` (чтобы не повторялось при импорте).
- [x] Проверено, что `golden_egg` остаётся единственным `bundled: true` в каталоге.

## Резолюция (2026-07-05)

Причина оказалась не в БД/импорте, а в **захардкоженном множестве** в коде:
`services/talesService.js` → `const BUNDLED_TALES = new Set([...])`. Флаг `bundled`
не хранится в БД и не считается при загрузке — он выводится из этого сета
(`bundled = BUNDLED_TALES.has(id)`), а `downloadSize` пропускается для bundled-сказок.

В коммите `047832e` (2026-06-07, «Add new tales…») в сет сознательно внесли обе
сказки — `golden_egg` **и** `farhad` («built into Unity client»), но клиент вшил
только `golden_egg`. Отсюда и баг.

**Фикс:** убрал `farhad` из `BUNDLED_TALES` → `new Set(['golden_egg'])` (+ комментарий,
что сет обязан совпадать с клиентским `manifest.json`). `downloadSize` теперь считается
автоматически из `data/illustrations/farhad` (обе гендерные версии, `getDownloadSize`).

Коммит `64b5820` → push в `origin/main` → на проде `git pull --ff-only` +
`pm2 restart fairy-backend`. Проверка прямым вызовом `getTalesList('ru')` на проде:

```
farhad     : bundled:false, downloadSize:48961652 (46.7 MB), comingSoon:false
golden_egg : bundled:true
bundled=true: ['golden_egg']   ← единственная
```
