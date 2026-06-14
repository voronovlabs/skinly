# Skinly · DM (Silver) layer — аудит каталога и план внедрения

Цель: ввести промежуточный слой `dm_products` между raw-каталогом и приложением.

```
RAW (источник истины, не трогаем)
  └─ NationalCatalogRawProduct
        ↓  чистка/нормализация/дедуп — ТОЛЬКО в DM (не в парсере)
DM (Silver)
  └─ dm.dm_products  (materialized view, ежедневный refresh)
        ↓
API  (читает только DM)
        ↓
Mobile / Web
```

Ограничения соблюдены: raw-таблицы не изменяются, данные в raw не обновляются и
не удаляются, очистка не переносится в парсер. Все объекты DM — аддитивные, в
отдельной схеме `dm`. Анализируется только Национальный каталог (Farera и
barcode-enrichment не подключаются).

Артефакты:

- `sql/dm/00_audit.sql` — аудит-запросы (только SELECT) для реальных чисел.
- `sql/dm/10_dm_functions.sql` — нормализационные функции (схема `dm`).
- `sql/dm/20_dm_products.sql` — материализованное представление + индексы + refresh.

> Числа аудита нужно снять на рабочей БД (`psql "$DATABASE_URL" -f sql/dm/00_audit.sql`)
> — из среды разработки БД (`localhost:5432`) недоступна. Ниже — структура,
> качественные проблемы с примерами (выведены из схемы и кода нормализатора)
> и конкретный план DM.

---

## 1. Текущая структура

Два слоя уже существуют.

**RAW — `NationalCatalogRawProduct`** (источник истины, заполнен скрейпером):

| поле | тип | назначение |
|---|---|---|
| `id` | cuid | PK |
| `source` | text | `"national_catalog"` |
| `sourceUrl` | text **unique** | ключ upsert'а скрейпера |
| `barcode` | text **nullable** | EAN из паспорта или из `/product/<barcode>` URL |
| `payload` | jsonb | весь `ScrapedProduct`: `title, brand, country, imageUrl, compositionRaw, categoryPath[], flatAttributes{}` |
| `scrapedAt` | timestamptz | время скрейпа |

**Производный каталог — `Product` / `Ingredient` / `ProductIngredient`** (заполняет
`normalize-national-catalog.ts`): `Product(barcode unique, brand, name, category enum,
imageUrl, source, externalId)`.

### Как сейчас читает приложение (и почему это больно)

`lib/api/national-catalog.ts` на **каждый** запрос списка делает
`LEFT JOIN LATERAL` в `NationalCatalogRawProduct` и достаёт категорию из
`payload->categoryPath[1]` через CASE-маппинг — потому что `Product.category`
**всегда `OTHER`** (прямая цитата из кода: «Реальная категория товара НЕ лежит в
`Product.category` — там всё OTHER»). Поиск по ингредиентам **удалён** из-за
full-scan'ов на «40k+ products × ingredient links» с таймаутами в проде
(`lib/db/repositories/product.ts`). То есть нормализация по факту живёт в
query-time SQL — именно это DM должен материализовать заранее.

Масштаб: **≈40 000+ товаров** (по комментарию в `product.ts`). Точные числа — из
`00_audit.sql`.

---

## 2. Найденные проблемы (с примерами)

Источник проблем — `scrape-national-catalog`/`parser.ts` (что складывается в raw)
и `normalize-national-catalog.ts` (что и как переносится в `Product`).

| # | Проблема | Где видно в коде | Пример |
|---|---|---|---|
| P1 | **`Product.category` всегда `OTHER`** — реальная категория считается на лету из raw на каждый запрос | `lib/api/national-catalog.ts` (LATERAL+CASE), normalizer пишет category, но API ему не доверяет | список/категории → JSON-операторы + LATERAL на 40k строк |
| P2 | **Поиск по составу отключён** из-за full-scan | `product.ts`: «Ingredient search … was removed … time out» | нельзя искать «ниацинамид» |
| P3 | **Мусорные бренды**: при пустом бренде ставится литерал `"Unknown"`; бренд берётся из «Товарный знак» → юрлица | `normalizer.processOne`: `brand = … || "Unknown"` | `"Unknown"`, `"ООО \"Косметик\""`, `"ИП Иванов"` |
| P4 | **Бренд не нормализован**: регистр, ™/®, кавычки, опечатки регистра | бренд пишется как есть | `"ARAVIA"`, `"Aravia®"`, `"«Чистая линия»"` — три варианта одного |
| P5 | **Название не чистится**: сырой `title`, ALL CAPS, хвостовые коды `/16`, html-артефакты | `name = titleRaw` (только trim) | `КРЕМ ДЛЯ РУК "Cream Oil" 550 мл. /16` |
| P6 | **Объём не выделен в поле** для Нацкаталога | в `Product` нет колонки volume | `"... 150 мл."` остаётся внутри name |
| P7 | **Дубли по barcode в raw**: один EAN — несколько `sourceUrl`; normalizer upsert'ит по barcode → «последний выигрывает», остальные raw-строки висят | upsert key = barcode | один товар по 2–3 URL (варианты страниц) |
| P8 | **Дубли без barcode**: товары без EAN не попадают в `Product` вообще (skip), но в raw их много | `skippedMissingBarcode++` | повторяющиеся `name+brand` без штрихкода |
| P9 | **Невалидные barcode**: длина ≠ 8/12/13/14, битая контрольная сумма (из URL-fallback) | barcode из `/product/<digits>` | `"123456"` (6 цифр), EAN с битой суммой |
| P10 | **Состав сырой**: split только по `,;/`, lower/trim; `Ingredient.inci` хранит то RU, то Latin → не каноничный INCI | `normalizeIngredient` | `"тальк"`, `"парфюмерная композиция"`, `"aqua"` — вперемешку |
| P11 | **Битые/placeholder картинки** местами проходят | parser фильтрует 1×1, но не всё | `imageUrl` пустой или `…/1x1.jpg` |
| P12 | **Нет единого quality-сигнала** — нельзя ранжировать «хорошие» товары выше | — | товар без бренда/состава/картинки наравне с полным |

---

## 3. DM-схема: `dm.dm_products`

Материализованное представление поверх raw. Колонки (как в ТЗ + служебные):

| колонка | тип | правило |
|---|---|---|
| `business_key` | text **unique** | ключ дедупа (см. §6) |
| `barcode` | text | только валидный EAN, иначе NULL |
| `is_valid_barcode` | bool | прошёл контрольную сумму |
| `brand` | text | исходный бренд (для трассировки) |
| `brand_normalized` | text | чистый бренд или NULL (мусор отброшен) |
| `product_name` | text | исходное название |
| `product_name_normalized` | text | очищенное название |
| `volume` | text | `«150 мл»` (выделен из названия) |
| `category` | text | UI-категория, **предвычислена** (не на лету) |
| `image_url` | text | пустые/placeholder → NULL допустим |
| `ingredients_raw` | text | исходная строка состава |
| `ingredients_normalized` | text[] | массив ингредиентов (split/trim/lower/dedup) |
| `source` | text | `'national_catalog'` |
| `quality_score` | int (0..100) | полнота+чистота полей |
| `raw_source_url` | text | провенанс (ссылка на raw) |
| `created_at` | timestamptz | `raw.createdAt` |
| `updated_at` | timestamptz | `raw.scrapedAt` |

DDL — `sql/dm/20_dm_products.sql`.

---

## 4. Правила очистки

Реализованы как IMMUTABLE-функции в `sql/dm/10_dm_functions.sql` (используются и в
MV, и потенциально в индексах):

| правило | функция | что делает |
|---|---|---|
| чистка пробелов/nbsp | `dm.norm_ws` | nbsp→space, схлопывание, trim, `''→NULL` |
| очистка HTML | `dm.strip_html` | снять теги и `&entities;` |
| мусорный бренд → NULL | `dm.is_garbage_brand` / `dm.norm_brand` | отбрасывает `Unknown`, юрлица (ООО/ИП/…), числовые, длиннее 50; снимает ™®©«»"" |
| нормализация названия | `dm.norm_name` | strip html → служебные префиксы (`Купить…`) → хвостовой `/16` → CAPS→Initcap |
| нормализация объёма | `dm.extract_volume` | `150мл.`/`150 ML` → `150 мл`; `g/гр→г`, `ml→мл` |
| валидный EAN | `dm.is_valid_ean` | контрольная сумма GTIN-8/12/13/14 |
| нормализация состава | `dm.norm_ingredients` | split `,;/` → trim/lower → снять `*•·«»` → dedup (порядок сохранён) |
| ключи дедупа | `dm.brand_key` / `dm.name_key` | lowercase, ё→е, только буквы/цифры |
| quality_score | `dm.quality_score` | barcode 30 + brand 20 + name 20 + image 10 + ingredients 15 + category 5 |
| объединение дублей | MV: `row_number() … PARTITION BY business_key` | внутри ключа — лучший по `quality_score`, затем свежий `scrapedAt` |
| предвычисление категории | MV: CASE по `categoryPath[1]` | устраняет LATERAL в API (P1) |

---

## 5. Архитектура SQL / Materialized View

PostgreSQL 16, materialized view + ежедневный refresh:

1. `CREATE MATERIALIZED VIEW dm.dm_products AS …` — материализует очистку+дедуп.
2. **UNIQUE index** на `business_key` → разрешает `REFRESH MATERIALIZED VIEW
   CONCURRENTLY` (читатели не блокируются во время обновления).
3. Поисковые индексы: `pg_trgm` GIN на `product_name_normalized` и
   `brand_normalized` (быстрый `ILIKE %q%` вместо full-scan — лечит часть P2),
   btree на `category`, `barcode`, `quality_score`.
4. `dm.refresh_dm_products()` → `REFRESH … CONCURRENTLY`. Расписание:
   - pg_cron: `SELECT cron.schedule('dm_products_daily','0 4 * * *', …)`, либо
   - внешний планировщик/app scheduler: `SELECT dm.refresh_dm_products();`.

Почему MV, а не таблица+триггеры: каталог пополняется батчами скрейпера, real-time
не нужен; суточный refresh достаточен и дёшев. Если позже понадобится стабильный
«первое появление в DM» по строке — заменить MV на таблицу с `MERGE` в
`refresh`-функции (created_at тогда переживает refresh). На текущем этапе
`created_at = raw.createdAt` это уже обеспечивает.

---

## 6. Бизнес-ключ (приоритет)

```
1) barcode (валидный EAN)            → business_key = 'bc:' || barcode
2) barcode + brand                   → при коллизии EAN расширяем до 'bc:'||barcode||'|'||brand_key
3) normalized_name + brand + volume  → 'nb:' || brand_key || '|' || name_key || '|' || volume
   (если бренда нет)                  → 'nv:' || name_key || '|' || volume
```

Логика: валидный штрихкод — самый сильный идентификатор (приоритет 1). Коллизии
одного EAN на разные бренды редки — по умолчанию ключ `'bc:'||barcode`, дедуп
берёт строку с лучшим `quality_score`; при необходимости ключ расширяется брендом
(приоритет 2, закомментированный вариант в DDL). Без валидного штрихкода —
композитный ключ из нормализованных имени, бренда и объёма (приоритет 3). Это и
объединяет дубли (P7), и разводит реально разные товары без EAN (P8).

---

## 7. Итоговая архитектура и план внедрения

```
RAW   NationalCatalogRawProduct         (не трогаем; скрейпер пишет как раньше)
  │
  │   dm.*-функции (10_) + MV (20_)      ← вся очистка/нормализация/дедуп здесь
  ▼
DM    dm.dm_products  (MV, daily refresh, business_key unique, trgm-индексы)
  │
  │   репозиторий читает только dm.dm_products
  ▼
API   listProducts / categories / product-by-barcode  → SELECT из dm.dm_products
  │   (без LATERAL в raw, категория и поиск уже готовы)
  ▼
Mobile / Web
```

Порядок внедрения:

1. Снять реальный аудит: `psql -f sql/dm/00_audit.sql` → зафиксировать числа
   (товары, бренды, дубли, пропуски) как базовую линию.
2. Применить `10_dm_functions.sql`, затем `20_dm_products.sql` (создаёт схему
   `dm`, функции, MV, индексы; первичная материализация — сразу).
3. Провалидировать DM против аудита: сравнить `count(*)`, распределение
   `quality_score`, дубли «до/после», `category != 'Прочее'`.
4. Переключить чтение API на `dm.dm_products` (новый репозиторий
   `lib/db/repositories/dm-products.ts`), убрав LATERAL-в-raw. Контракты
   `ProductListItem` сохраняются — это внутренняя замена источника.
5. Повесить ежедневный `dm.refresh_dm_products()`.
6. После переключения `Product`/`Ingredient`-путь чтения становится
   избыточным — нормализатор можно остановить позже отдельным решением (сейчас
   не удаляем, чтобы не ломать существующее).

Farera, barcode-enrichment и прочие источники — следующий этап: они вливаются в
тот же `dm.dm_products` добавлением UNION-ветки с `source='farera'` и общим
бизнес-ключом, без изменения контракта API.
