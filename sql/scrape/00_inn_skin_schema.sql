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
