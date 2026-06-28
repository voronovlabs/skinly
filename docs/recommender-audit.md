# Skinly — Аудит и архитектура рекомендательной системы

> Статус документа: **аудит + предложение архитектуры**. Код не менялся,
> миграций нет, БД не трогалась. Это план для текущего репозитория, а не
> теоретическая статья.
>
> Дата: 2026-06-16. Базис: `prisma/schema.prisma`, `lib/compatibility/*`,
> `lib/mock/onboarding-questions.ts`, `components/onboarding/onboarding-wizard.tsx`,
> `scripts/normalize-national-catalog.ts`, `lib/demo-store/*`.

---

## 0. TL;DR (главное за 60 секунд)

1. **Compatibility-движок уже есть и он хороший.** `lib/compatibility/*` —
   чистый детерминированный rule-engine: score 0–100, verdict, per-ingredient
   findings, мягкие формулировки. Его не надо переписывать — надо **накормить
   данными**.

2. **Главная дыра — не движок, а данные под ним.** Knowledge base ищет
   ингредиенты по английским INCI (`niacinamide`, `sodium hyaluronate`), а
   нормализатор каталога пишет в `Ingredient.inci` **русские display-строки**
   (`тальк`, `парфюмерная композиция`). Они не стыкуются → на реальных товарах
   из Национального каталога движок почти всегда уходит в `lowConfidence` и
   тянет score к baseline 75. То есть «подходит/не подходит» сейчас по-настоящему
   работает только на mock-каталоге.

3. **Онбординг собирает больше, чем сохраняет.** Анкета спрашивает возраст, пол,
   беременность, ретиноиды — но `BeautyProfile` хранит только 5 полей, и эти
   данные **выбрасываются прямо в мастере**. Беременность для beauty-приложения
   — это безопасность (ретиноиды, салицилка), а её теряют.

4. **Рекомендаций «похожих продуктов» нет вообще.** Есть только compatibility
   одного отсканированного товара. Пункт ТЗ №3 («рекомендовать похожие, но более
   подходящие») в коде не реализован ни в каком виде.

5. **История почти не используется как сигнал.** Есть `ScanHistory` (со
   snapshot-score) и `Favorite`, но нет дизлайков, нет различия
   «посмотрел / понравился / купил», нет user preference vector.

6. **DM-слоя `dm.dm_products` в репозитории нет.** Он описан в задаче, но в коде
   и схеме отсутствует. Сейчас каталог живёт в `public.Product` +
   `NationalCatalogRawProduct` (raw). Это нормально для MVP, но архитектуру DM
   надо проектировать с нуля.

**Вывод:** до ML ещё далеко и оно пока не нужно. 80% ценности даёт
**канонизация ингредиентов + расширение профиля + SQL-рекомендации поверх уже
существующего движка**. ML/embeddings — это v2.

---

## 1. Что найдено в текущем проекте

### 1.1. Профиль пользователя / онбординг

**Анкета (`lib/mock/onboarding-questions.ts`)** — 9 вопросов:
`age`, `gender`, `pregnant` (skip для male), `skinBehavior`, `breakouts`,
`skinReaction` (calm/mild/couperose/rosacea), `pores`, `goals` (multi, до 3),
`special` (allergy / retinoid / nothing).

**Хранилище (`BeautyProfile` в Prisma)** — всего 5 содержательных полей:
`skinType`, `sensitivity`, `concerns[]`, `avoidedList[]`, `goal` + `completion`.

**Маппинг (`onboarding-wizard.tsx`, функция деривации)** — и вот тут потери:

| Вопрос анкеты | Куда попадает | Потеря |
|---|---|---|
| `age` | **никуда** | ❌ выброшен |
| `gender` | **никуда** | ❌ выброшен |
| `pregnant` | **никуда** | ❌ выброшен (это **safety-сигнал**) |
| `special: retinoid` | **никуда** (используется только `allergy`) | ❌ выброшен |
| `skinBehavior` | `skinType` | ок |
| `skinReaction: couperose→high, rosacea→reactive` | `sensitivity` | ⚠️ диагноз (розацеа/купероз) схлопнут в «уровень чувствительности» |
| `breakouts` | `concerns += acne` | ок (но теряется частота) |
| `pores` | `concerns += pores/blackheads` | ок |
| `goals` | `concerns` + один primary `goal` | ⚠️ multi-цель → одна |
| `special: allergy` | `avoidedList += fragrance, essential_oils` | ⚠️ «аллергия» грубо = только отдушки |

**Отдельно есть `HairProfile`** (`HairType`, `ScalpType`, `HairConcern[]`,
`HaircareGoal`) — модель заведена (Phase 15 по комментариям), но в онбординге
кожи не используется и в compatibility-движок не заходит. Перхоть (`DANDRUFF`)
и окрашивание сейчас никак не влияют на скоринг.

### 1.2. Каталог продуктов

Три слоя:

- `NationalCatalogRawProduct` — raw JSON payload скрейпера (не трогаем, верно).
- `Product` — нормализованный товар: `barcode` (unique), `brand`, `name`,
  `category` (enum из 14 значений), `emoji`, `imageUrl`, `descriptionRu/En`,
  `source`, `externalId`. Индексы: `[brand,name]`, `[category]`.
- `Ingredient` / `ProductIngredient` — состав с `position` и опциональной
  `concentration` (`Decimal(5,2)`, на практике пустая).

Скрейперы: `scrape-national-catalog.ts`, `scrape-farera.ts`,
`enrich-farera-barcodes.ts` — то есть второй источник (Farera) уже подключают.

**Чего нет в каталоге для рекомендаций:** нет `quality_score`, нет
нормализованного бренда (`brand_normalized`), нет признака «мусорный бренд /
хорошее изображение», нет product-фич (агрегатов по составу), нет связи товар↔товар
(похожесть). Всё это нужно будет считать.

> ⚠️ DM-слой `dm.dm_products` (barcode, brand_normalized, product_name_normalized,
> category, image_url, ingredients_raw, ingredients_normalized, quality_score),
> описанный в задаче, **в репозитории отсутствует**. Его придётся спроектировать
> и материализовать — см. §6.

### 1.3. Состав продукта (ключевая проблема)

Нормализатор (`scripts/normalize-national-catalog.ts`):

```
parseComposition: split по [,;/] → trim → дедуп
normalizeIngredient: trim → lowercase → схлопнуть пробелы → убрать *•·«»"'
Ingredient.inci = normalizeIngredient(display)   // ← вот ключ
```

Проблемы:

1. **`Ingredient.inci` — это НЕ канонический INCI.** Это просто lowercase
   исходной строки, часто **русской**: `тальк`, `парфюмерная композиция`,
   `вода`. Уникальность по этому полю → один и тот же ингредиент под разными
   написаниями плодит дубли (`aqua`, `water`, `вода`, `вода очищенная` — четыре
   разных `Ingredient`).

2. **KB ищет по английским INCI/aliases** (`lib/compatibility/ingredients.ts`):
   `niacinamide`, `sodium hyaluronate`, `parfum`, `alcohol denat`. Российская
   строка `ниацинамид` или `парфюмерная композиция` в KB не находится → fact
   получает `kbId = null` → нейтрален. На товаре с RU-составом распознаётся ~0%,
   срабатывает `recognitionRatio < 0.3` → score тянется к 75. **«Подходит/не
   подходит» на реальных данных деградирует до «непонятно».**

3. **Нет канонизации синонимов.** `aqua/water/вода`, `parfum/fragrance/отдушка`,
   `tocopherol/vitamin e/витамин e` не сводятся. Нет отделения «мусора»
   (маркетинговые строки, `*натуральный компонент`, проценты, `и др.`).

4. **`Ingredient.flagsAvoided/benefitsFor/cautionsFor` в БД пустые** (по
   CLAUDE.md и по нормализатору — они не заполняются). Знание живёт только
   in-code в KB. То есть БД-ингредиенты — «немые», вся семантика на стороне KB,
   к которой они не подключены из-за пункта (2).

### 1.4. История пользователя

- `ScanHistory` — `userId`, `productId`, `matchScore` (snapshot движка),
  `scannedAt`. Индекс `[userId, scannedAt desc]`.
- `Favorite` — `userId`, `productId`, unique `[userId,productId]`.
- `User` — email/pass/name/locale.

Чего нет: дизлайков, рейтингов/отзывов, событий «открыл карточку / досмотрел /
добавил в рутину / купил», дедупликации повторных сканов (один товар сканится
5 раз — 5 строк, сигнал «интерес» не выделен), никакого
`user_preference_vector`. То есть **поведенческого сигнала под рекомендации
сейчас почти нет** — только «сканил» и «лайкнул».

### 1.5. Движок совместимости (это сильная сторона)

`lib/compatibility/*` — чистый, расширяемый, корректный:

- `score.ts`: baseline 75, сумма весов, diminishing returns после +30, clamp
  [25,100], hard-cap 60 при срабатывании `avoidedList`, anti-overconfidence при
  `lowConfidence`, verdict по порогам, мягкий сдвиг в `mixed`.
- `rules.ts`: 9 декларативных правил (avoidedList, sensitivity, strong actives,
  concern match, skin-type, goal). Правила опираются на **семантические теги
  fact'а**, а не на конкретные INCI — то есть расширение KB автоматически
  расширяет покрытие.
- `ingredients.ts`: KB ~35 ингредиентов с aliases, tags, benefitsFor.
- Уже даёт `positives` / `warnings` / `rows` / `ingredientFindings` /
  `lowConfidence` — это ровно то, что нужно для explainability.

**Чего движок не делает (и не должен):** рекомендации похожих товаров, учёт
истории/лайков, учёт концентрации и порядка как системы, pH/фотостабильность.

---

## 2. Какие данные уже можно использовать (без новых таблиц)

- **Профиль кожи** (5 полей) — уже заходит в движок через адаптеры. Рабочий
  сигнал прямо сейчас.
- **Состав mock-каталога** — на нём движок работает корректно (для демо/тестов).
- **`ProductIngredient.position`** — позиция в INCI уже есть, можно использовать
  как прокси концентрации (топ-5 ингредиентов весят больше).
- **`Product.category`** — 14 категорий, готовая ось для «похожих по категории».
- **`ScanHistory.matchScore` + `Favorite`** — минимальный, но реальный
  поведенческий сигнал для «лучше по score, чем то, что ты лайкал».
- **`barcode`** — стабильный ключ для матчинга между источниками (Нац.каталог,
  Farera, OpenBeautyFacts).
- **Farera/раскладка barcode** — второй источник состава уже скрейпится.

## 3. Какие данные нужно добавить (приоритет)

**P0 — без этого рекомендации не взлетят:**

1. **Канонический ингредиентный слой** (`ingredients_canonical` + `aliases` +
   `properties`). Свести RU/EN/синонимы к одному canonical_id; повесить
   функции/риски. Это «починка» §1.3 — без неё движок слеп на реальном каталоге.
2. **DM-слой продукта** с `ingredients_normalized` (массив canonical_id),
   `brand_normalized`, `quality_score`, `image_ok`. Материализованная витрина
   для быстрых SQL-рекомендаций.
3. **Расширение профиля**: сохранять `age_band`, `gender`, `pregnant`,
   `uses_retinoids`, явный список аллергенов; вынести в `user_skin_profile`
   (и опционально `user_hair_profile`, который уже есть как `HairProfile`).

**P1 — для качества рекомендаций и обучения:**

4. **`user_product_events`** — единый лог поведения (view/scan/favorite/
   unfavorite/dislike/dismiss) с типом и весом.
5. **`product_ingredient_features`** — агрегаты по составу на товар
   (есть_кислоты, есть_отдушка, comedogenic_max, active_set, hydration_score…).
6. **`recommendation_logs`** — что показали, что выбрали (для оффлайн-оценки и
   будущего A/B).

**P2 — v2:**

7. Embeddings продуктов и профиля, рейтинги/отзывы, явная обратная связь
   «подошло/не подошло после использования».

---

## 4. MVP-архитектура (без сложного ML)

Принцип: **всё детерминированно, всё объяснимо, всё в Postgres + существующий
rule-engine.** Никаких векторов, никакого LLM в критическом пути.

### 4.1. Поток данных

```
raw (Нац.каталог, Farera, OBF)
   │  normalize (существующий + новый ingredient-canonicalizer)
   ▼
dm.dm_products  ──┐
dm.ingredient_*   │  (canonical + properties + product features)
   │              │
   ▼              ▼
[A] Compatibility (online, per request)
     evaluateCompatibility(profile, facts)   ← УЖЕ ЕСТЬ, чиним вход
   │
   ▼
[B] Recommendations (offline materialized + online rerank)
     SQL: похожие по категории/активам → фильтры качества →
     сорт по (compatibility, risk, quality)
   │
   ▼
API → mobile
```

### 4.2. Компоненты

**Ingredient canonicalizer (offline, batch).** Расширяет нормализатор: каждую
строку состава мапит на `canonical_ingredient_id` через таблицу алиасов
(RU+EN+синонимы+мусор-фильтр). Результат — `dm_products.ingredients_normalized`
= массив canonical_id с позицией. Источник правды для `flagsAvoided/benefitsFor`
переносится из in-code KB в `ingredient_properties` (KB остаётся seed'ом).

**Compatibility (online).** Тот же `evaluateCompatibility`, но факты строятся
из `ingredients_normalized` + `ingredient_properties` (а не из RU-строки через
KB-lookup). Один фикс входа лечит §1.3.

**Recommendations (rule + SQL).** Кандидаты добываются SQL'ом:

```
кандидаты = товары той же category
            (опц.) с пересечением active_set / функции
исключить  = сам товар, мусорные бренды, без image, с risk-флагами профиля
score_rec  = w1*compatibility_score(profile, cand)
           − w2*risk_score(profile, cand)
           + w3*quality_score
           + w4*history_affinity(user, cand)   // лайкал похожее
сорт desc, top-N
```

На MVP `compatibility_score(profile, cand)` для кандидатов считается из
предрассчитанных `product_ingredient_features` дешёвым SQL-приближением, а точный
движок добивает только top-N перед отдачей (rerank). Это держит запрос быстрым.

**Materialized views (daily refresh):**
- `mv_product_features` — агрегаты состава на товар.
- `mv_product_neighbors` — топ-K похожих товаров на товар (по
  категория+активы+бренд), пересчёт раз в сутки. «Похожие» становятся
  O(1)-чтением.

**Explainability.** Объяснения НЕ генерим LLM на MVP. Берём из движка
(`reasons`, `positives`, `warnings`, `ingredientFindings`) + шаблонные i18n-фразы
(уже есть `compatibility.reasons.*`). Кэшируем вместе с рекомендацией.

### 4.3. Что online, что offline

| Слой | Когда считается | Где |
|---|---|---|
| Ingredient canonicalization | offline, при ingest/normalize | batch script |
| Product features, neighbors | offline, daily refresh | materialized views |
| Compatibility конкретного товара | online, per request | rule-engine (есть) |
| Recommendations (кандидаты) | offline (neighbors) + online (rerank top-N) | SQL + engine |
| Объяснения | online из движка, кэш | engine + cache |

---

## 5. V2-архитектура (следующий этап)

Подключать **только когда есть объём поведенческих данных** (events) и MVP
упирается в потолок качества.

1. **Product embeddings.** Вектор товара из (canonical ingredients + category +
   функции). Изначально — простой bag-of-ingredients / TF-IDF по составу, потом
   обученный энкодер. Хранение: `pgvector`. Даёт «похожие по смыслу», а не только
   по категории.
2. **User profile embedding.** Из явного профиля + агрегата лайков/сканов
   (mean-pooling эмбеддингов понравившихся товаров).
3. **Collaborative filtering.** ALS/implicit по матрице user×product из
   `user_product_events` (лайк=сильный сигнал, повторный скан=средний,
   dismiss=негатив). Решает cold-catalog/ long-tail.
4. **Hybrid retrieval + reranker.** Кандидаты: SQL-фильтры ∪ vector-kNN ∪ CF.
   Реранкер (gradient boosting / небольшой learned model) поверх фич
   {compatibility, risk, quality, similarity, cf_score, history_affinity}.
5. **LLM для объяснений.** Phase 10.2 из CLAUDE.md: LLM генерит человеческое
   объяснение **поверх** детерминированного результата движка (движок = факты,
   LLM = формулировка). Никогда не в роли скоринга. Кэшировать per (product,
   profile-bucket).
6. **A/B и оффлайн-оценка.** `recommendation_logs` → CTR / save-rate /
   add-to-routine-rate. Сравнение rule-MVP vs hybrid. Калибровка весов
   (Phase 10.3 ML scoring).

---

## 6. Предлагаемая схема БД

> Принцип проекта: «минимум миграций». Поэтому DM-слой и ingredient-канон —
> в отдельной схеме `dm.*` (витрина, можно дропать/пересобирать), а
> пользовательские профили/события — аккуратные новые таблицы в `public`.
> Существующие таблицы и миграции не трогаем.

### dm.ingredients_canonical
- **Назначение:** одна строка = один реальный ингредиент (canonical).
- **Поля:** `id` (canonical key, напр. `niacinamide`), `inci_name` (EN),
  `display_ru`, `display_en`, `is_junk` (bool — маркетинговый мусор),
  `created_at`.
- **Обновление:** seed из in-code KB + ручное/полуавтомат. расширение при
  встрече новых строк.
- **Индексы:** PK(`id`), unique(`inci_name`).

### dm.ingredient_aliases
- **Назначение:** все варианты написания → canonical.
- **Поля:** `alias_norm` (lowercase, нормализованный; PK), `canonical_id` (FK),
  `lang` (`ru`/`en`/`mixed`), `source`.
- **Обновление:** batch при нормализации + дозаполнение при «неопознанных».
- **Индексы:** PK(`alias_norm`), index(`canonical_id`).
- **Это и есть починка §1.3**: `aqua/water/вода → water`, `парфюмерная
  композиция/parfum → fragrance`.

### dm.ingredient_properties
- **Назначение:** семантика ингредиента для движка (вынос KB в БД).
- **Поля:** `canonical_id` (PK/FK), `functions[]` (humectant/occlusive/
  exfoliant_aha…), `tags[]`, `benefits_for[]` (SkinConcern), `cautions_for[]`,
  `flags_avoided[]` (AvoidedIngredient), `comedogenicity` (0–5),
  `irritancy` (0–3), `allergenicity` (0–3), `base_safety`
  (beneficial/neutral/caution/danger), `pregnancy_caution` (bool),
  `incompatible_with[]` (canonical_id — для interaction graph, Phase 10.4).
- **Обновление:** seed из KB, расширение вручную/из источников.
- **Индексы:** PK(`canonical_id`), GIN по `tags`, `flags_avoided`.

### dm.dm_products
- **Назначение:** витрина каталога для матчинга/рекомендаций (как в задаче).
- **Поля:** `barcode` (PK), `brand_normalized`, `product_name_normalized`,
  `category`, `image_url`, `image_ok` (bool), `ingredients_raw`,
  `ingredients_normalized` (jsonb: `[{canonical_id, position}]`),
  `quality_score` (0–100), `source`, `updated_at`.
- **Обновление:** materialized из `Product`/`NationalCatalogRawProduct` +
  canonicalizer; daily refresh.
- **Индексы:** PK(`barcode`), index(`category`), index(`brand_normalized`),
  GIN по `ingredients_normalized`.

### dm.product_ingredient_features
- **Назначение:** агрегаты состава на товар (быстрый SQL-скоринг кандидатов).
- **Поля:** `barcode` (PK), `active_set[]` (canonical_id активов),
  `has_fragrance`, `has_alcohol_drying`, `has_essential_oils`,
  `comedogenic_max`, `irritancy_max`, `hydration_score`, `actives_count`,
  `recognized_ratio` (доля распознанных — зеркало `lowConfidence`),
  `top5_canonical[]`.
- **Обновление:** пересчёт из `dm_products.ingredients_normalized` +
  `ingredient_properties`; daily.
- **Индексы:** PK(`barcode`), GIN по `active_set`.

### public.user_skin_profile (или расширение BeautyProfile)
- **Назначение:** полный профиль кожи без потерь онбординга.
- **Поля:** существующие 5 + `age_band`, `gender`, `pregnant`,
  `uses_retinoids`, `allergens[]` (canonical_id / категории), `dryness_level`,
  `oiliness_level`, `pigmentation` (bool), `conditions[]`
  (couperose/rosacea — отдельно от sensitivity).
- **Обновление:** запись из онбординга + экран «Предпочтения».
- **Индексы:** PK(`user_id`).
- **Замечание:** можно реализовать как новые nullable-колонки в `BeautyProfile`
  (одна аддитивная миграция, в духе «минимум миграций»), а не отдельную таблицу.

### public.user_hair_profile
- Уже существует как `HairProfile`. Доп. поля при необходимости: `is_colored`,
  `has_dandruff` (хотя `HairConcern.DANDRUFF` уже есть). Подключить к движку
  для hair-категорий.

### public.user_product_events
- **Назначение:** единый поведенческий лог (основа preference vector и CF).
- **Поля:** `id`, `user_id`, `barcode`/`product_id`, `event_type`
  (view/scan/open/favorite/unfavorite/dislike/dismiss/add_routine/purchase),
  `weight` (число — лайк +3, повторный скан +1, dismiss −2…), `score_snapshot`,
  `created_at`.
- **Обновление:** append-only из клиента/actions.
- **Индексы:** index(`user_id, created_at desc`), index(`product_id`),
  index(`user_id, event_type`).
- **Различение «посмотрел/понравилось»:** именно `event_type` + `weight`.
  Повторные сканы агрегируются по `(user_id, product_id)` в §next.

### public.user_product_preferences
- **Назначение:** материализованный preference-профиль (derived из events).
- **Поля:** `user_id` (PK), `liked_active_set[]`, `disliked_active_set[]`,
  `liked_brands[]`, `category_affinity` (jsonb), `avoided_inferred[]`
  (выведенные неявные предпочтения), `updated_at`.
- **Обновление:** пересчёт из `user_product_events` (online при событии или
  daily). Это и есть **user preference vector** на MVP (без эмбеддингов —
  множества и счётчики).
- **Индексы:** PK(`user_id`).

### public.recommendation_logs
- **Назначение:** оффлайн-оценка и будущий A/B.
- **Поля:** `id`, `user_id`, `context` (scan/me/product), `seed_barcode`,
  `shown[]` (barcodes + позиции + score), `algo_version`, `chosen_barcode`
  (nullable), `created_at`.
- **Обновление:** append при отдаче рекомендаций + апдейт `chosen` при клике.
- **Индексы:** index(`user_id, created_at`), index(`algo_version`).

---

## 7. Предлагаемые API

> Стек проекта — Next.js server actions, без отдельного backend. Эндпоинты ниже
> реализуются как **route handlers** (`app/api/...`) для мобильного клиента
> и/или как server actions для web. DTO одинаковые.

### GET /products/:barcode/compatibility
Вход: `barcode` + профиль из сессии (user/guest).
DTO:
```jsonc
{
  "barcode": "...",
  "compatibility_score": 0-100,
  "risk_score": 0-100,
  "verdict": "excellent|good|mixed|risky",
  "confidence": "high|low",          // из lowConfidence
  "positive_factors": [{ "ingredient", "reason_key", "args" }],
  "negative_factors": [{ "ingredient", "reason_key", "args", "severity" }],
  "unknown_factors": [{ "ingredient" }],   // нераспознанные
  "explanation": "мягкая шаблонная фраза"
}
```
Источник: существующий `evaluateCompatibility`, вход — из `dm_products`.

### GET /products/:barcode/recommendations
Вход: `barcode` + профиль. Возврат: похожие, но лучше подходящие.
DTO: `{ seed, items: [{ barcode, brand, name, image_url, compatibility_score, quality_score, why: ["лучше по составу", "без отдушек"] }] }`.
Источник: `mv_product_neighbors` → фильтры качества → rerank движком top-N.

### GET /me/recommendations
Вход: профиль + `user_product_preferences`. Возврат: персональная лента
(не привязана к одному товару).
DTO: как выше + `section` (по категориям / по целям).

### Вспомогательные
- `POST /me/events` — запись `user_product_events` (view/like/dislike/dismiss).
- `GET /me/profile`, `PUT /me/profile` — чтение/обновление расширенного профиля.

### Кэш и скорость
- `compatibility` и `recommendations` кэшировать per `(barcode, profile_hash)`
  (короткий TTL; профиль меняется редко). `profile_hash` = хэш значимых полей.
- Тяжёлое (neighbors, features) — оффлайн в materialized views; запрос читает
  готовое.
- Rerank движком — только top-N (≤30), pure-функция, дёшево.
- Избегать N+1: состав кандидатов брать из `dm_products.ingredients_normalized`
  (jsonb), а не join'ом по `ProductIngredient` на каждый товар.

---

## 8. Риски и ограничения

1. **Качество исходных составов.** Нац.каталог даёт грязные RU-строки; без
   хорошего canonicalizer + alias-таблицы recognition останется низким и
   рекомендации будут «приблизительными». Это главный риск. Метрика для контроля:
   `recognized_ratio` по каталогу.
2. **Не медицина.** Беременность, аллергии, розацеа — чувствительные темы.
   Формулировки строго мягкие («может не подойти», «стоит обратить внимание»,
   «протестируйте на небольшом участке»). Никаких диагнозов и директив. Любой
   safety-флаг (pregnancy + ретиноид/салицилка) — это **предупреждение**, не
   запрет.
3. **Холодный старт пользователя.** Пока нет событий — рекомендации опираются
   только на профиль (это ок). CF включать после накопления данных.
4. **Холодный старт товара / long tail.** Товары без распознанного состава
   нельзя ранжировать по совместимости — показывать ниже и помечать
   «состав уточняется».
5. **Концентрация и порядок.** Движок не моделирует %; `position` — лишь
   прокси. Не обещать точность «по дозировке».
6. **Дубли ингредиентов** до канонизации искажают features. Канон — блокер для
   §6 features.
7. **Guest mode.** Всё должно деградировать на demo store: рекомендации для
   гостя — по профилю из localStorage, без серверного preference vector.
   (Принцип проекта — guest не ломаем.)
8. **Производительность refresh.** Materialized views на большом каталоге —
   следить за временем daily refresh; при росте — инкрементальный пересчёт.

---

## 9. Пошаговый план реализации

Порядок выбран так, чтобы каждый шаг давал ценность и не блокировал guest mode.
Код — только после отдельного подтверждения.

**Этап 0 — Аудит моделей (этот документ).** ✅ Готово.

**Этап 1 — Канонизация ингредиентов (P0, разблокирует всё).**
- Спроектировать `dm.ingredients_canonical / aliases / properties`.
- Seed из существующего in-code KB (~35 записей) + топ-N частых строк каталога.
- Расширить нормализатор: строка состава → `canonical_id` через alias-таблицу;
  отчёт по `recognized_ratio` и списку «неопознанных» для дозаполнения.
- *Критерий готовности:* recognized_ratio по каталогу > ~60% на топовых брендах.

**Этап 2 — DM products + features.**
- Материализовать `dm.dm_products` (с `ingredients_normalized`,
  `brand_normalized`, `quality_score`, `image_ok`).
- Посчитать `product_ingredient_features` + `mv_product_neighbors` (daily).

**Этап 3 — Расширение профиля (P0).**
- Перестать терять `age/gender/pregnant/retinoid/allergy` в мастере.
- Аддитивные nullable-поля в `BeautyProfile` (одна миграция) или
  `user_skin_profile`. Обновить адаптер движка, чтобы читать новые поля.
- Добавить safety-правило: pregnancy + (ретиноид/высокая салицилка) →
  мягкое предупреждение.

**Этап 4 — Compatibility на реальных данных.**
- Переключить вход движка с KB-lookup по RU-строке на
  `ingredients_normalized + ingredient_properties`.
- Добавить `risk_score` рядом с `compatibility_score` (из warnings/flags).
- *Критерий:* на реальном отсканированном товаре verdict перестаёт всегда быть
  «mixed/непонятно».

**Этап 5 — Recommendations SQL MVP.**
- `GET /products/:barcode/recommendations` через neighbors + rerank.
- Фильтры: мусорные бренды, без image, risk-флаги профиля.
- `recommendation_logs` для оценки.

**Этап 6 — Поведенческий сигнал.**
- `user_product_events` (+ запись из клиента) и
  `user_product_preferences` (derived).
- `GET /me/recommendations` с history_affinity.

**Этап 7 — API + mobile integration.**
- Финализировать DTO §7, кэш per `(barcode, profile_hash)`.
- UI: карточка «подходит/не подходит» (verdict + причины + предупреждения),
  блок «похожие, но лучше», экран «Предпочтения», улучшенная анкета.

**Этап 8 — V2 (после данных).**
- Embeddings (pgvector) + CF (implicit/ALS) + reranker + LLM-объяснения
  (Phase 10.2) + A/B (Phase 10.3). Калибровка весов по логам.

---

## Приложение A. Оценка ценности полей анкеты

| Поле | Ценность для рекомендаций | Статус сейчас | Действие |
|---|---|---|---|
| Тип кожи | 🟢 высокая | хранится | оставить |
| Чувствительность | 🟢 высокая | хранится | оставить, отделить от диагнозов |
| Акне / breakouts | 🟢 высокая | хранится (теряется частота) | хранить частоту |
| Сухость | 🟢 высокая | косвенно (skinType) | вынести уровнем |
| Жирность | 🟢 высокая | косвенно (skinType) | вынести уровнем |
| Пигментация | 🟢 высокая | через concern/goal | ок |
| Возраст | 🟡 средняя | **теряется** | хранить age_band |
| Пол | 🟡 средняя | **теряется** | хранить (влияет на категории/hair) |
| Беременность/лактация | 🟢 высокая (**safety**) | **теряется** | хранить + safety-правило |
| Аллергии | 🟢 высокая | грубо (только отдушки) | хранить список аллергенов |
| Ретиноиды (исп.) | 🟡 средняя | **теряется** | хранить (interaction graph) |
| Тип волос | 🟡 средняя (hair-категории) | есть HairProfile, не used | подключить |
| Окрашены волосы | 🟡 средняя | нет | добавить (color protection) |
| Перхоть | 🟡 средняя | HairConcern.DANDRUFF есть | подключить |
| Цели ухода | 🟢 высокая | хранится (multi→single) | хранить все цели |

🟢 — использовать в скоринге сразу; 🟡 — полезно, фильтр/буст; красным выделены
данные, которые **уже собираются, но выбрасываются** (быстрый выигрыш).
