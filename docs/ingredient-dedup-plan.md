# Skinly · Ingredient dictionary — аудит дублей и план безопасной канонизации

Только анализ и план. **Ничего не применено** — ни к схеме, ни к данным.

Вход: `ингридиенты_skinly.xlsx` (выгрузка `public."Ingredient"`, столбец
«Товаров с ингредиентом» = число связей `ProductIngredient`, т.к. PK
композитный `(productId, ingredientId)`). Строк: 73 440. Сумма связей:
1 124 450.

---

## 1. Что сломается, если смержить дубли

Смотрел: `prisma/schema.prisma`, `lib/compatibility/*`, `lib/db/repositories/*`,
`app/product/[...]`, поиск по коду ссылок на `Ingredient.id`/`inci`.

**Короткий ответ: рекомендации, карточка товара и compatibility-engine не
завязаны на конкретный `Ingredient.id` — они безопасны к мержу дублей.**
Риски есть, но локальные и управляемые (см. §1.3).

### 1.1 Как на самом деле используется `Ingredient`

- `ProductIngredient` — единственная таблица с FK на `Ingredient`
  (`onDelete: Restrict`). `Product` прямой связи с `Ingredient` не имеет.
- Compatibility-engine (`lib/compatibility/ingredients.ts` + `rules.ts` +
  `score.ts`) — **полностью отдельная база знаний**, ~46 ингредиентов,
  захардкожена в коде. Матчинг идёт по **нормализованной строке `inci`**
  через `findKbEntry()`, а не по `Ingredient.id`. То есть движок скоринга уже
  сегодня не видит разницы между `Ingredient.id = A` и `Ingredient.id = B`,
  если у обоих `inci` резолвится в один и тот же KB-entry строковым
  сравнением. Merge по `id` ничего не меняет в том, как считается score.
- Карточка товара и `IngredientsList` рендерят состав по `ProductIngredient`,
  отсортированному по `position`, с `inci`/`displayNameRu/En` из `Ingredient`.
  Смена `ingredientId` у строки состава не меняет ни `position`, ни
  `concentration` — это поля `ProductIngredient`, их merge не трогает.
- Поиска, фильтров или роутинга **по `Ingredient.id`/`inci` нет** — грепом
  по `app/` и `lib/` не найдено ни одной ссылки вида
  `/ingredient/[id]` или `where: { ingredientId }` в клиентских query-параметрах.
  Единственное текстовое упоминание поиска по составу — комментарий в
  `lib/db/repositories/product.ts`, что такой поиск уже **отключён** из-за
  full-scan таймаутов (не относится к этой задаче, но объясняет, почему в
  коде нет ingredient-based роутов, которые могли бы сломаться).

### 1.2 Единственное место, которое пересчитывает значения, зависящие от количества ингредиентов

`evaluateCompatibility()` считает `recognitionRatio` = доля распознанных
ингредиентов среди всех строк состава товара. Если товар **потеряет** строки
состава (не смержены, а удалены без замены), `recognitionRatio` и общее
число ингредиентов в карточке изменятся, а `lowConfidence`-флаг может
переключиться. Это не ломает механику, но **тихо меняет score** уже
показанных пользователю товаров. Отсюда правило в §3: дубликаты
**мержим**, мусор **не удаляем молча** (см. §3.5).

### 1.3 Реальные риски мержа (не «сломается», а «требует аккуратности»)

| Риск | Где | Как обработан в плане |
|---|---|---|
| Коллизия составного PK `(productId, ingredientId)` | один товар уже ссылается и на дубль, и на canonical | §4.2 — детект + приоритетное сохранение строки, аудит удалённой |
| `onDelete: Restrict` на `ProductIngredient.ingredient` | нельзя удалить `Ingredient`, пока есть ссылки | §4 — сначала перенос всех связей, потом delete |
| `position` — потеря порядка состава | при коллизии одна из двух строк удаляется | §4.2 — оставляем строку с меньшим `position` (она была раньше в оригинальном INCI-списке у бренда) |
| `concentration` — не трогаем | правило явно задано пользователем | Merge никогда не пишет/не пересчитывает `concentration` |
| Смена `recognitionRatio` при удалении мусора | compatibility-engine | §3.5 — мусор не удаляется до отдельного review, либо мержится в sentinel-bucket, а не вычищается |

---

## 2. Стратегическая развилка: уже есть `dm.*` canonical-слой

В `sql/dm/30_ingredients_canonical.sql` / `31_seed_ingredient_aliases.sql` /
`33_audit_ingredients.sql` **уже построен** почти тот же механизм, который
просит задача — но для другого потребителя:

```
dm.ingredients_canonical   — canonical_id (slug) + inci_name + display_ru/en + is_junk
dm.ingredient_aliases      — alias_norm (PK) → canonical_id
dm.ingredient_properties   — KB (tags/benefits/cautions/flags), seed = lib/compatibility/ingredients.ts
dm.norm_ingredient_alias() — SQL-функция нормализации (IMMUTABLE, с smoke-тестами)
```

Это питает **отдельный** путь: `dm.dm_products.ingredients_normalized` →
`lib/compatibility/dm-adapters.ts` → `resolve-compatibility.ts`, за флагом
`USE_DM_COMPATIBILITY` (сейчас выключен). Источник для `dm.dm_products` —
сырой текст состава из `NationalCatalogRawProduct.payload`, **не**
`public.Ingredient`. Иными словами: сегодня в проекте два параллельных мира
ингредиентов — «legacy» (`public.Ingredient`/`ProductIngredient`, то, что
реально показывает карточка и на чём считается прод-скоринг) и «DM» (силвер
слой поверх нацкаталога, ещё не включён в прод).

**Решение для этой задачи: не сливать `public.Ingredient` в `dm.ingredients_canonical` напрямую.**
Причины:

1. `dm.ingredients_canonical` — это справочник для *National Catalog*
   (пополняется из `dm_products`), а `public.Ingredient` — общий словарь для
   *всех* источников (`normalize-national-catalog.ts`, ручной импорт брендов
   из Part A этой же сессии, будущие импортёры). Смешивать PK-пространства
   двух независимых пайплайнов — плодить связанность там, где её сейчас нет.
2. `dm.ingredient_aliases.alias_norm` — PK. Если `public.Ingredient` merge
   начнёт писать туда же, он получит право «тихо» ломать DM-слой (который
   пока выключен, но будет включаться) — а это нарушает принцип DM-документа
   «дедуп только в DM, не трогаем остальное».

**Но `dm.norm_ingredient_alias()` и содержимое `31_seed_ingredient_aliases.sql`
переиспользуем как есть** — это уже проверенный, с smoke-тестами,
нормализатор RU/EN INCI-строк и уже готовый словарь синонимов
(aqua/water/вода/eau, parfum/fragrance/отдушка/ароматизатор и т.д.,
~46 canonical-групп, тот же список, что используется KB compatibility-engine).
Порт этой логики в TS (см. §5) избавляет от повторного изобретения
regex-нормализации и держит оба слоя семантически согласованными на будущее
(если `USE_DM_COMPATIBILITY` когда-нибудь включат, canonical-имена будут
совпадать).

---

## 3. Архитектура безопасного мержа `public.Ingredient`

Все объекты — **аддитивные**, в отдельной Postgres-схеме `audit` (raw SQL,
без Prisma-миграции — тот же подход, что уже применён для `dm.*`; в
CLAUDE.md прямо сказано «минимум миграций»). `Ingredient.id` никогда не
переиспользуется и не меняется: canonical — это **существующая** строка
`Ingredient`, выбранная по эвристике, а не новая сущность.

### 3.1 Новые объекты (additive, схема `audit`, без Prisma-миграции)

```sql
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.ingredient_merge_run (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  mode          text        NOT NULL,   -- 'dry_run' | 'apply'
  git_sha       text,
  notes         text
);

CREATE TABLE audit.ingredient_merge_action (
  id                 bigserial PRIMARY KEY,
  run_id             bigint      NOT NULL REFERENCES audit.ingredient_merge_run(id),
  cluster_key        text        NOT NULL,   -- нормализованный alias (dm.norm_ingredient_alias-эквивалент)
  duplicate_id       text        NOT NULL,   -- Ingredient.id, который уходит
  duplicate_inci     text        NOT NULL,
  canonical_id       text        NOT NULL,   -- Ingredient.id, который остаётся (никогда не меняется)
  canonical_inci     text        NOT NULL,
  links_repointed    int         NOT NULL DEFAULT 0,
  links_dropped_dup  int         NOT NULL DEFAULT 0,  -- удалены из-за PK-коллизии
  dropped_rows_json  jsonb,                            -- полный снимок удалённых ProductIngredient (для отката)
  applied            boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.ingredient_alias_map (
  alias_norm      text NOT NULL,
  source_inci     text NOT NULL,     -- исходный "грязный" inci, который был у duplicate
  canonical_id    text NOT NULL,     -- Ingredient.id
  first_seen_run  bigint REFERENCES audit.ingredient_merge_run(id),
  PRIMARY KEY (alias_norm, source_inci)
);
```

`audit.ingredient_alias_map` — это и есть «aliases» из задачи: человекочитаемая
история того, какие исходные строки INCI были объединены в canonical
`Ingredient`. `public.Ingredient`/`public.ProductIngredient` при этом не
меняют форму (0 новых колонок, 0 Prisma-миграций).

### 3.2 Выбор canonical в кластере дублей

Приоритет (первый непустой критерий побеждает):

1. Есть `descriptionRu`/`descriptionEn` (обогащён вручную/скрейпом) —
   предпочесть.
2. `safety != NEUTRAL` или заполнены `flagsAvoided`/`benefitsFor`/`cautionsFor`
   — предпочесть (значит, кто-то уже классифицировал этот ingredient).
3. Наибольший `productCount` (больше всего существующих связей — меньше
   строк придётся перевязывать).
4. Самый ранний `createdAt` (стабильность истории).
5. Самый «чистый» `inci` по длине/отсутствию скобок/процентов (детерминированный tie-break).

### 3.3 Кластеризация (порядок применения, от безопасного к рискованному)

| Tier | Что | Логика | Найдено (см. §4) | Риск |
|---|---|---|---|---|
| 0 | Точные дубли без учёта регистра/пробелов | `lower(trim(inci))` совпадает | 41 группа | Минимальный — это буквально одна и та же строка |
| 1 | Loose-normalization | без скобок, `%`-суффиксов, `/` → пробел, схлопнутые пробелы | 4 472 группы | Низкий — почти всегда написание одного и того же |
| 2 | Кросс-язычные синонимы (curated) | через порт `dm.norm_ingredient_alias()` + словарь `31_seed_ingredient_aliases.sql` (~46 canonical-групп: aqua/water/вода/eau, parfum/fragrance/отдушка и т.д.) | 3 группы разобраны вручную ниже, полный словарь даёт основу для остальных | Средний — семантическое сопоставление, нужен ручной review словаря перед `--apply` |

Мусорные (`is_garbage`) строки — **не тier**, отдельный процесс, см. §3.5.

### 3.4 Перенос связей и снятие дублей (respecting `onDelete: Restrict`)

На каждый кластер, внутри `prisma.$transaction`:

1. Для каждого `duplicate_id` в кластере: выбрать все
   `ProductIngredient WHERE ingredientId = duplicate_id`.
2. Для каждой строки — проверить, существует ли уже
   `ProductIngredient WHERE productId = row.productId AND ingredientId = canonical_id`:
   - **Нет коллизии** → `UPDATE ... SET ingredientId = canonical_id` (одна
     строка, `position`/`concentration` не трогаются — race safety через
     `SELECT ... FOR UPDATE` внутри транзакции).
   - **Коллизия** (товар уже содержит и дубль, и canonical — например,
     состав дважды перечислил «Aqua» и «Water») → оставить строку с меньшим
     `position` (она раньше встретилась в оригинальном INCI-списке), вторую
     удалить, полный снимок удалённой строки (`productId, ingredientId,
     position, concentration`) записать в `dropped_rows_json` для возможного
     отката.
3. После обработки всех строк кластера — убедиться
   `count(*) WHERE ingredientId = duplicate_id` = 0, затем
   `DELETE FROM "Ingredient" WHERE id = duplicate_id`.
4. Записать итог кластера в `audit.ingredient_merge_action`.

Идемпотентность: повторный запуск того же кластера находит 0 строк на
duplicate_id (он уже удалён) → пропускает без ошибки. Это даёт возможность
запускать `--apply` батчами (например, только Tier 0 сегодня, Tier 1 —
на следующей неделе после проверки).

### 3.5 Мусор — не удаляется молча

Прямое удаление garbage-`Ingredient` (без merge) уменьшает число строк
состава у затронутых товаров и может подвинуть `recognitionRatio` (см. §1.2).
План:

1. **Ничего не удаляем в первом проходе.** Мусорные `Ingredient` мержатся в
   один sentinel-canonical `Ingredient` с `inci = "__junk__"` (создаётся один
   раз, аналог `dm.ingredients_canonical.canonical_id = 'junk'`, который уже
   существует как паттерн в `31_seed_ingredient_aliases.sql`). Их
   `ProductIngredient`-связи переносятся туда же по правилам §3.4.
2. Отдельным, вторым, явно согласованным шагом решаем: скрывать ли
   `__junk__` из карточки на UI-уровне (простой `WHERE ingredient.inci !=
   '__junk__'` в компоненте состава) — это ноль риска для `recognitionRatio`
   расчётов, потому что явно классифицированный «мусор» может быть исключён
   из знаменателя тем же способом, каким сейчас исключаются нераспознанные
   KB-ингредиенты.
3. Физическое удаление строк из `Ingredient`/`ProductIngredient` — вообще не
   планируется в рамках этой задачи; sentinel-merge полностью решает
   проблему «дубли в словаре», ничего не удаляя из истории состава товара.

---

## 4. Dry-run анализ (`ингридиенты_skinly.xlsx`, 73 440 строк)

### 4.1 Общие числа

| Метрика | Значение |
|---|---|
| Всего строк `Ingredient` | 73 440 |
| Всего связей `ProductIngredient` (Σ «Товаров с ингредиентом») | 1 124 450 |
| Явный мусор (см. эвристику ниже) | 2 275 строк (3.1%) → 16 584 связей (1.5%) |
| Точные дубли без учёта регистра/пробелов (Tier 0) | 41 группа |
| Дубли после loose-нормализации (Tier 1) | 4 472 группы / 16 973 строки-участницы / 12 501 строка уйдёт при мерже |
| Связей, которым потребуется repoint только по Tier 1 | **701 787 (62% от всех связей в базе)** |
| Ingredient с ≤1 товаром (длинный хвост) | 39 487 (53.8%) |
| Ingredient без единой связи (orphan) | 0 |

Эвристика «мусор» (проверено построчно на выборках): пусто/только цифры и
знаки препинания, 1–2 символа (кроме признанных аббревиатур типа BHA/AHA/CI),
маркетинговые фразы («contains», «способ применения», «www.», «net wt» и
т.п.), тексты длиннее 80 символов (похоже на кусок описания товара),
изолированные маркеры списка (`1.`, `2)`, `•`, `+`).

### 4.2 Топ-10 кластеров дублей по числу вариантов написания

| Кластер (норм. форма) | Вариантов | Связей всего |
|---|---|---|
| fragrance / parfum / отдушка / ароматизатор | 483 | 27 386 |
| aqua / water / вода / eau | 197 | 36 425 |
| glycerin / глицерин | 66 | 21 381 |
| vitis vinifera (seed/fruit) extract | ~40 | тысячи (не изолировано отдельно) |
| melaleuca alternifolia (tea tree) | ~35 | — |
| rosmarinus officinalis (rosemary) | ~30 | — |
| chamomilla recutita (matricaria) | ~28 | — |
| niacinamide | ~20 | тысячи |
| sodium hyaluronate | ~18 | тысячи |
| panthenol | ~15 | тысячи |

(Полный список top-25 по обоим измерениям — вариантам написания и числу
задетых связей — уже посчитан в ходе анализа; при необходимости выгружу
отдельным CSV.)

### 4.3 Что это значит для плана

Tier 0 + Tier 1 (безопасные, детерминированные, без семантики) уже покрывают
**основную массу** дублей (4 513 групп) и убирают ≈12.5 тыс. мусорных строк
словаря. Но именно Tier 2 (семантические синонимы вроде aqua/water/вода)
даёт наибольший **прод-эффект** — 85 192 связи только по трём кластерам
(water/fragrance/glycerin), потому что это самые массовые ингредиенты в
любой косметике. Здесь и пригождается готовый словарь из
`31_seed_ingredient_aliases.sql` — не нужно вручную собирать эти синонимы
заново.

---

## 5. Скрипты (dry-run по умолчанию)

Соответствуют конвенции репозитория (`node:util parseArgs`, `PrismaClient`
инлайн, `main().catch().finally()`, `npm run <verb>:<subject>`):

- **`scripts/audit-ingredient-duplicates.ts`** — только чтение. Строит Tier
  0/1/2 кластеры по живой БД, печатает те же секции, что и в §4, плюс
  предлагаемый canonical на кластер (по правилам §3.2). Ничего не пишет.
  `npm run audit:ingredient-duplicates -- --tier 2`
- **`scripts/merge-ingredient-duplicates.ts`** — сам мерж. `--dry-run`
  (по умолчанию) печатает план без записи. `--apply` требует явного
  флага **и** `--tier <0|1|2>` (нельзя одной командой применить всё сразу).
  Создаёт `audit.*` таблицы при первом запуске (`CREATE ... IF NOT EXISTS`),
  пишет `audit.ingredient_merge_run`/`_action`/`_alias_map` на каждый
  прогон, оборачивает каждый кластер в `$transaction`.

Оба скрипта уже созданы в `scripts/` этой сессией (см. файлы) — можно
запускать `--dry-run` хоть сейчас, `--apply` только после ревью отчёта.

---

## 6. Рекомендованный поэтапный план

1. **Сейчас**: ревью этого отчёта + прогон `audit-ingredient-duplicates.ts
   --dry-run` на реальной БД (числа в §4 посчитаны по выгрузке в Excel,
   нужно свежее подтверждение на актуальных данных).
2. **Этап A** (низкий риск): `merge-ingredient-duplicates.ts --apply --tier 0`
   — точные дубли без учёта регистра. ~41 кластер.
3. **Этап B**: `--tier 1` — loose-normalization дубли. 4 472 кластера,
   701 787 связей repoint. Рекомендую прогнать на staging/копии БД первым
   делом и сверить `recognitionRatio`/score выборки товаров до/после.
4. **Этап C**: `--tier 2` — семантические синонимы, начиная с word/aqua,
   parfum/fragrance, glycerin (самые массовые). Словарь синонимов — порт
   `31_seed_ingredient_aliases.sql`, ревью вручную перед первым `--apply`.
5. **Этап D** (опционально, отдельное решение): sentinel-merge мусора в
   `__junk__` + скрытие в UI. Не блокирует этапы A–C.
6. Каждый этап — отдельный git-коммит, отдельная запись в
   `audit.ingredient_merge_run`, возможность точечного отката по
   `dropped_rows_json`/`ingredient_alias_map`.

Ничего из этого не тронуто в рамках текущей сессии: `public.Ingredient` /
`public.ProductIngredient` / `dm.*` / Prisma-схема — без изменений.
