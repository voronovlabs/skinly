-- Skinly · staging layer · inn-skin.ru
--
-- Изолированный staging-слой для нового источника inn-skin.ru.
-- Живёт в ОТДЕЛЬНОЙ Postgres-схеме `scrape` (как `dm`), вне Prisma-моделей,
-- и НИКОГДА не пишет напрямую в public."Product" / public."Ingredient".
--
-- Поток данных:
--   scrape-inn-skin.ts   → scrape.inn_skin_products            (raw)
--   normalize-inn-skin.ts→ scrape.inn_skin_products_normalized (нормализованный staging)
--   merge-inn-skin.ts    → DRY-RUN отчёт сверки с public."Product" (ничего не пишет)
--
-- Идемпотентно: всё через IF NOT EXISTS, повторный запуск безопасен.
-- Файл можно гонять отдельной командой (см. ensureSchema в storage.ts) или
-- через `psql -f sql/scrape/00_inn_skin_schema.sql`.

CREATE SCHEMA IF NOT EXISTS scrape;

-- ── RAW staging ─────────────────────────────────────────────────────────────
-- Один ряд = одна product-страница inn-skin.ru. Ключ конфликта — source_url.
--
-- ВАЖНО про идентификаторы (решение пользователя):
--   * retailer_article — это артикул витрины продавца (Gold Apple, 11 цифр),
--     это НЕ EAN/UPC/GTIN. В public."Product".barcode он НЕ попадает.
--   * source_product_id — UUID карточки на inn-skin.ru.
--   * настоящий barcode (EAN) у источника отсутствует → колонка ean пока null.
CREATE TABLE IF NOT EXISTS scrape.inn_skin_products (
  id                text        PRIMARY KEY,                 -- = source_product_id (UUID)
  source            text        NOT NULL DEFAULT 'inn-skin',
  source_product_id text        NOT NULL,
  source_url        text        NOT NULL UNIQUE,
  brand             text,
  product_name      text,
  category_raw      text,                                    -- сырой ярлык/эвристика категории
  image_url         text,
  price_text        text,                                    -- "≈ 1 957 ₽"
  price_value       integer,                                 -- 1957 (рубли, целое)
  description       text,                                    -- блок «Описание»
  "usage"          text,                                     -- инструкция применения, если выделена
  ingredients_raw   text,                                    -- полная INCI-строка
  retailer          text,                                    -- 'goldapple' и т.п.
  retailer_article  text,                                    -- артикул продавца (НЕ EAN)
  seller_url        text,                                    -- ссылка «Сайт продавца»
  raw_json          jsonb       NOT NULL,                    -- полный распарсенный объект
  scraped_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inn_skin_products_brand
  ON scrape.inn_skin_products (brand);
CREATE INDEX IF NOT EXISTS idx_inn_skin_products_article
  ON scrape.inn_skin_products (retailer_article);
CREATE INDEX IF NOT EXISTS idx_inn_skin_products_scraped
  ON scrape.inn_skin_products (scraped_at DESC);

-- ── NORMALIZED staging ──────────────────────────────────────────────────────
-- Производная таблица: бренд/имя/категория приведены к канону каталога через
-- dm.*-функции, плюс ключи дедупликации (brand_key/name_key) для сверки с
-- public."Product". Тоже staging — в витрину ничего не уходит.
CREATE TABLE IF NOT EXISTS scrape.inn_skin_products_normalized (
  source_product_id        text PRIMARY KEY
                             REFERENCES scrape.inn_skin_products(id) ON DELETE CASCADE,
  source_url               text NOT NULL,
  brand_normalized         text,
  brand_key                text,                 -- dm.brand_key(brand)
  product_name_normalized  text,
  name_key                 text,                 -- dm.name_key(product_name)
  category                 text,                 -- ProductCategory enum value (как text)
  image_url                text,                 -- зеркало raw.image_url (в Product НЕ пишем)
  ingredients_raw          text,
  ingredients_normalized   text[],               -- dm.norm_ingredients(ingredients_raw)
  retailer_article         text,
  ean                      text,                 -- настоящий EAN, если когда-нибудь появится
  has_valid_ean            boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inn_skin_norm_brandkey
  ON scrape.inn_skin_products_normalized (brand_key);
CREATE INDEX IF NOT EXISTS idx_inn_skin_norm_namekey
  ON scrape.inn_skin_products_normalized (name_key);

-- ── Идемпотентные миграции для уже существующих БД ──────────────────────────
-- CREATE TABLE IF NOT EXISTS не добавит колонки в уже созданную таблицу,
-- поэтому новые поля прокатываем явным ALTER ... ADD COLUMN IF NOT EXISTS.
ALTER TABLE scrape.inn_skin_products_normalized
  ADD COLUMN IF NOT EXISTS image_url text;

-- ── EAN enrichment · УНИВЕРСАЛЬНЫЙ пул внешних идентификаторов ───────────────
-- НЕ привязано к barcode-list.ru. Один пул на ВСЕ источники EAN/GTIN; источник
-- различается полем `source` ('barcode-list', далее 'openfoodfacts', 'gs1',
-- 'wb', 'ozon', 'goldapple' …). Новый источник = новый адаптер-скрейпер,
-- который пишет в ЭТУ ЖЕ таблицу с другим `source`. Схему менять не нужно.
--
-- Это staging/краудсорс → в Product ничего не уходит автоматически.
--
-- Миграция со старого имени (баркод-специфичная таблица заменена универсальной).
DROP TABLE IF EXISTS scrape.barcode_list_products;

CREATE TABLE IF NOT EXISTS scrape.external_product_identifiers (
  id                  text        PRIMARY KEY,
  source              text        NOT NULL,        -- 'barcode-list' | 'openfoodfacts' | …
  source_query        text,                        -- что искали (обычно бренд)
  source_url          text,
  ean                 text        NOT NULL,        -- валидный EAN/GTIN (checksum)
  product_name        text,                        -- название с источника (любой язык)
  brand_guess         text,                        -- бренд, если источник его отдаёт
  normalized_name_key text,                        -- dm.name_key(product_name)
  raw_payload         jsonb       NOT NULL,
  scraped_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, ean)
);

CREATE INDEX IF NOT EXISTS idx_extid_source   ON scrape.external_product_identifiers (source);
CREATE INDEX IF NOT EXISTS idx_extid_query    ON scrape.external_product_identifiers (source, source_query);
CREATE INDEX IF NOT EXISTS idx_extid_ean      ON scrape.external_product_identifiers (ean);
CREATE INDEX IF NOT EXISTS idx_extid_namekey  ON scrape.external_product_identifiers (normalized_name_key);

-- ── Кандидаты сопоставления inn-skin ↔ внешний EAN ──────────────────────────
-- Результат matcher'а (dry-run). НИЧЕГО не пишется в Product. Каждая строка —
-- гипотеза «у этого inn-skin товара, вероятно, такой EAN» с confidence/tier/
-- reasons и указанием, из какого источника пришёл EAN.
-- Производная таблица — пересоздаётся matcher'ом, поэтому DROP безопасен.
DROP TABLE IF EXISTS scrape.inn_skin_ean_candidates;

CREATE TABLE IF NOT EXISTS scrape.inn_skin_ean_candidates (
  id                text        PRIMARY KEY,
  source_product_id text        NOT NULL
                      REFERENCES scrape.inn_skin_products(id) ON DELETE CASCADE,
  inn_skin_name     text,
  inn_skin_brand    text,
  retailer_article  text,                          -- артикул продавца (НЕ EAN)
  source            text        NOT NULL,          -- источник EAN ('barcode-list' …)
  candidate_ean     text        NOT NULL,
  external_name     text,                          -- название из источника
  confidence        numeric     NOT NULL,          -- 0..1
  tier              text        NOT NULL,          -- 'high' | 'medium' | 'low'
  match_method      text        NOT NULL,          -- 'name' | 'name+volume' | 'alias' …
  reasons           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_product_id, candidate_ean)
);

CREATE INDEX IF NOT EXISTS idx_ean_cand_product ON scrape.inn_skin_ean_candidates (source_product_id);
CREATE INDEX IF NOT EXISTS idx_ean_cand_tier    ON scrape.inn_skin_ean_candidates (tier);
CREATE INDEX IF NOT EXISTS idx_ean_cand_conf    ON scrape.inn_skin_ean_candidates (confidence DESC);

-- ── Care to Beauty · ВЫДЕЛЕННЫЙ staging (намеренно НЕ универсальный) ─────────
-- Полный слепок данных Care to Beauty для последующего анализа/merge. Это
-- ОТДЕЛЬНАЯ от external_product_identifiers таблица: GTIN-поток в общий пул
-- продолжает работать как раньше, а здесь копим ВСЁ, что отдаёт источник
-- (название, бренд, картинка, INCI, описание, объём, категория). Значения
-- складываем СЫРЫМИ, без нормализации. В Product НИЧЕГО не уходит.
CREATE TABLE IF NOT EXISTS scrape.caretobeauty_products (
  id              bigserial   PRIMARY KEY,
  ean             text        NOT NULL,
  brand           text,
  product_name    text,
  image_url       text,
  ingredients_raw text,
  description     text,
  volume          text,
  category        text,
  source_url      text,
  raw_payload     jsonb,
  scraped_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ean)
);

CREATE INDEX IF NOT EXISTS idx_c2b_brand ON scrape.caretobeauty_products (brand);
CREATE INDEX IF NOT EXISTS idx_c2b_name  ON scrape.caretobeauty_products (product_name);

-- ── Care to Beauty · НОРМАЛИЗОВАННЫЙ staging (ПО-ИСТОЧНИКОВО) ────────────────
-- Решение по архитектуре: общий ДВИЖОК нормализации (normalizeSource()), но
-- РАЗДЕЛЬНЫЕ таблицы результата на каждый источник. Пара на источник:
--     scrape.<source>_products            (raw)
--     scrape.<source>_products_normalized (результат normalize)
-- Объединение источников делает ОТДЕЛЬНЫЙ merge-слой, а не normalize.
--
-- Структура максимально повторяет scrape.inn_skin_products_normalized
-- (brand_normalized/brand_key/product_name_normalized/name_key/category/
-- image_url/ingredients_raw/ingredients_normalized/ean/has_valid_ean) плюс
-- доступные у Care to Beauty поля (raw brand/name, product_key, volume,
-- description). Это canonical-форма вывода движка для будущих источников.
--
-- Откат прошлой (отменённой) идеи единой таблицы:
DROP TABLE IF EXISTS scrape.normalized_products;

CREATE TABLE IF NOT EXISTS scrape.caretobeauty_products_normalized (
  source_ref               text        PRIMARY KEY,  -- = ean (back-ptr на caretobeauty_products)
  ean                      text,
  has_valid_ean            boolean     NOT NULL DEFAULT false,
  brand                    text,                       -- сырой
  brand_normalized         text,                       -- dm.norm_brand
  brand_key                text,                       -- dm.brand_key
  name                     text,                       -- сырое название
  product_name_normalized  text,                       -- dm.norm_name
  name_key                 text,                       -- dm.name_key
  product_key              text,                       -- 'bc:'||ean | 'nb:'||brand_key||'|'||name_key
  volume                   text,                       -- raw volume | dm.extract_volume(name)
  category                 text,                       -- ProductCategory enum (как text)
  ingredients_raw          text,
  ingredients_normalized   text[],                     -- dm.norm_ingredients
  description              text,
  image_url                text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_c2bn_brand_key   ON scrape.caretobeauty_products_normalized (brand_key);
CREATE INDEX IF NOT EXISTS idx_c2bn_name_key    ON scrape.caretobeauty_products_normalized (name_key);
CREATE INDEX IF NOT EXISTS idx_c2bn_product_key ON scrape.caretobeauty_products_normalized (product_key);
CREATE INDEX IF NOT EXISTS idx_c2bn_ean         ON scrape.caretobeauty_products_normalized (ean);

-- ── Care to Beauty · DRY-RUN MERGE кандидаты (анализ пересечения с Product) ──
-- Результат сопоставления scrape.caretobeauty_products_normalized ↔ public."Product".
-- ЧИСТО АНАЛИТИКА: ни одной записи в Product. Таблица пересоздаётся каждый
-- dry-run. По одной (лучшей) строке-классификации на товар Care to Beauty.
--   match_type: MATCH_BY_EAN | MATCH_BY_KEYS | FUZZY | NO_MATCH
--   conflict:   overlay-флаг (EAN указывает на один Product, ключи — на другой;
--               либо ключи совпали, но объём различается)
CREATE TABLE IF NOT EXISTS scrape.caretobeauty_merge_candidates (
  id              bigserial   PRIMARY KEY,
  c2b_ref         text        NOT NULL,   -- caretobeauty source_ref (= ean)
  ean             text,
  brand_key       text,
  name_key        text,
  volume          text,
  match_type      text        NOT NULL,
  conflict        boolean     NOT NULL DEFAULT false,
  product_id      text,                    -- public."Product".id (cuid), NULL если нет
  product_barcode text,
  product_brand   text,
  product_name    text,
  product_volume  text,
  confidence      numeric     NOT NULL DEFAULT 0,  -- 0..1
  reason          text,
  comments        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (c2b_ref)
);

CREATE INDEX IF NOT EXISTS idx_c2bmc_type     ON scrape.caretobeauty_merge_candidates (match_type);
CREATE INDEX IF NOT EXISTS idx_c2bmc_conflict ON scrape.caretobeauty_merge_candidates (conflict);
CREATE INDEX IF NOT EXISTS idx_c2bmc_product  ON scrape.caretobeauty_merge_candidates (product_id);

-- ── INGREDIENT ENRICHMENT · многоисточниковый INCI (provenance) ──────────────
-- Результат провайдер-цепочки getIngredients(): откуда взят настоящий INCI для
-- товара Care to Beauty, когда на самой карточке состава нет. Только staging:
-- сюда пишем провенанс, а в scrape.caretobeauty_products.ingredients_raw
-- заполняем INCI лишь там, где он был пуст. В Product ничего не пишется.
CREATE TABLE IF NOT EXISTS scrape.caretobeauty_ingredient_enrichment (
  ean             text        PRIMARY KEY,   -- товар Care to Beauty (EAN)
  source          text        NOT NULL,      -- 'caretobeauty'|'openbeautyfacts'|<site>
  source_url      text,
  method          text,                       -- 'staging'|'ean'|'brand-html'|'retailer-html'
  confidence      numeric,
  ingredients_raw text        NOT NULL,       -- ТОЛЬКО валидный INCI (isLikelyInci)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_c2bie_source ON scrape.caretobeauty_ingredient_enrichment (source);
