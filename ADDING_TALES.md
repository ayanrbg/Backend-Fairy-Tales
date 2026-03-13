# Как добавить новую сказку

## 1. Создать JSON-файлы

Для каждого языка создать файл в `data/tales/{lang}/{slug}.json`.

Пример для сказки "goldfish" на 3 языках:

### `data/tales/ru/goldfish.json`
```json
{
  "id": "goldfish",
  "title": "Золотая рыбка",
  "lang": "ru",
  "pages": [
    "Жили-были старик со старухой. А с ними {m:жил|f:жила} {childName}.",
    "{childName} {m:пошёл|f:пошла} на море и {m:увидел|f:увидела} золотую рыбку.",
    "Рыбка сказала: «Отпусти меня, и я исполню три желания!» {childName} {m:обрадовался|f:обрадовалась}."
  ]
}
```

### `data/tales/kz/goldfish.json`
```json
{
  "id": "goldfish",
  "title": "Алтын балық",
  "lang": "kz",
  "pages": [
    "Баяғыда бір шал мен кемпір тұрыпты. Олармен бірге {childName} {m:тұрды|f:тұрды}.",
    "{childName} теңізге {m:барды|f:барды} және алтын балықты {m:көрді|f:көрді}.",
    "Балық айтты: «Мені жібер, мен үш тілегіңді орындаймын!»"
  ]
}
```

### `data/tales/en/goldfish.json`
```json
{
  "id": "goldfish",
  "title": "The Goldfish",
  "lang": "en",
  "pages": [
    "Once upon a time, there lived an old man and an old woman. With them lived {childName}.",
    "{childName} went to the sea and saw a golden fish.",
    "The fish said: 'Let me go, and I will grant you three wishes!' {childName} was delighted."
  ]
}
```

## 2. Правила текста страниц

### Плейсхолдер имени
```
{childName}  — заменяется на имя ребёнка
```

### Гендерные формы
```
{m:мужская форма|f:женская форма}
```
Примеры:
```
{m:пошёл|f:пошла}
{m:он|f:она}
{m:сказал|f:сказала}
{m:увидел золотую рыбку|f:увидела золотую рыбку}
```

Для суффиксов (наблюдал/наблюдала):
```
наблюдал{m:|f:а}    → м: "наблюдал",  ж: "наблюдала"
```

## 3. Зарегистрировать в index.json

Открыть `data/tales/index.json` и добавить записи для **каждого языка**:

```json
[
  { "id": "kolobok",     "title": "Колобок",        "lang": "ru", "file": "ru/kolobok.json" },
  { "id": "teremok",     "title": "Теремок",        "lang": "ru", "file": "ru/teremok.json" },
  { "id": "three-bears", "title": "Three Bears",     "lang": "en", "file": "en/three-bears.json" },

  { "id": "goldfish",    "title": "Золотая рыбка",  "lang": "ru", "file": "ru/goldfish.json" },
  { "id": "goldfish",    "title": "Алтын балық",     "lang": "kz", "file": "kz/goldfish.json" },
  { "id": "goldfish",    "title": "The Goldfish",    "lang": "en", "file": "en/goldfish.json" }
]
```

**Важно:** `id` (slug) одинаковый для всех языков одной сказки, отличается только `lang` и `file`.

## 4. Загрузить в базу данных

```bash
node db/seed.js
```

Скрипт использует `ON CONFLICT (slug, lang) DO UPDATE` — можно запускать повторно, данные обновятся.

## 5. Проверить

```bash
# Список всех сказок
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/tales

# Список сказок на конкретном языке
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/tales?lang=ru

# Конкретная сказка
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/tales/goldfish?lang=ru
```

## 6. Первый запуск (миграция)

Если база уже существовала до мультиязычности, выполнить миграцию один раз:

```bash
psql -d fairy_tales -f db/migrate-001-multilang.sql
```

Или через node:
```bash
node -e "require('dotenv').config(); const pool = require('./db'); const fs = require('fs'); pool.query(fs.readFileSync('./db/migrate-001-multilang.sql','utf-8')).then(() => { console.log('Done'); pool.end(); })"
```

## Чеклист добавления сказки

- [ ] Создать `data/tales/ru/{slug}.json`
- [ ] Создать `data/tales/kz/{slug}.json`
- [ ] Создать `data/tales/en/{slug}.json`
- [ ] Добавить 3 записи в `data/tales/index.json`
- [ ] Запустить `node db/seed.js`
- [ ] Проверить через API
