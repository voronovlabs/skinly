-- =============================================================================
-- Skinly · DM (Silver) layer · материализованное представление dm.dm_products
--
-- raw ("NationalCatalogRawProduct") → dm.dm_products → API → Mobile/Web.
-- Полностью АДДИТИВНО: ничего в raw не меняется. Очистка — здесь, не в парсере.
--
-- Запуск (после 10_dm_functions.sql):
--   psql "$DATABASE_URL" -f sql/dm/20_dm_products.sql
--
-- Бизнес-ключ (приоритет):
--   1) barcode (валидный EAN)                         → 'bc:<barcode>'
--   2) barcode+brand (когда штрихкод неуникален)      → дедуп внутри 'bc:'
--   3) normalized_name + brand + volume               → 'nb:'/'nv:'
-- Дедуп: внутри ключа берём строку с максимальным quality_score, затем
-- самую свежую (scrapedAt).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP MATERIALIZED VIEW IF EXISTS dm.dm_products;

CREATE MATERIALIZED VIEW dm.dm_products AS
WITH base AS (
  SELECT
    r.barcode                                                        AS barcode_src,
    dm.is_valid_ean(r.barcode)                                       AS is_valid_barcode,
    r.payload->>'brand'                                              AS brand_src,
    dm.norm_brand(r.payload->>'brand')                               AS brand_normalized,
    r.payload->>'title'                                              AS name_src,
    dm.norm_name(r.payload->>'title')                                AS product_name_normalized,
    dm.extract_volume(r.payload->>'title')                           AS volume,
    nullif(btrim(r.payload->>'imageUrl'), '')                        AS image_url,
    r.payload->>'compositionRaw'                                     AS ingredients_raw,
    dm.norm_ingredients(r.payload->>'compositionRaw')                AS ingredients_normalized,
    btrim(regexp_replace(translate(lower(coalesce(r.payload->'categoryPath'->>1,'')),'ё','е'),
                         '\s+',' ','g'))                             AS lvl2,
    r."sourceUrl"                                                    AS raw_source_url,
    r."scrapedAt"                                                    AS scraped_at,
    r."createdAt"                                                    AS raw_created_at
  FROM "NationalCatalogRawProduct" r
  WHERE r.source = 'national_catalog'
),
mapped AS (
  SELECT b.*,
    CASE b.lvl2
      WHEN 'средства и аксессуары для волос'                  THEN 'Волосы'
      WHEN 'косметика для волос'                              THEN 'Волосы'
      WHEN 'декоративная и уходовая косметика'                THEN 'Лицо'
      WHEN 'парфюмерия'                                       THEN 'Парфюм'
      WHEN 'мыло и средства для мытья'                        THEN 'Очищение'
      WHEN 'косметические и туалетные средства'               THEN 'Тело'
      WHEN 'средства для ухода за полостью рта'               THEN 'Полость рта'
      WHEN 'средства для гигиены полости рта'                 THEN 'Полость рта'
      WHEN 'средства и инструменты для бритья и депиляции'    THEN 'Бритьё и депиляция'
      WHEN 'дезодоранты, антиперспиранты'                     THEN 'Дезодоранты'
      WHEN 'дезодоранты и антиперспиранты'                    THEN 'Дезодоранты'
      ELSE 'Прочее'
    END AS category,
    CASE
      WHEN dm.is_valid_ean(b.barcode_src)
        THEN 'bc:' || b.barcode_src
      WHEN dm.brand_key(b.brand_src) <> ''
        THEN 'nb:' || dm.brand_key(b.brand_src) || '|' ||
             coalesce(dm.name_key(b.name_src), '') || '|' || coalesce(b.volume, '')
      ELSE 'nv:' || coalesce(dm.name_key(b.name_src), '') || '|' || coalesce(b.volume, '')
    END AS business_key
  FROM base b
  WHERE dm.name_key(b.name_src) IS NOT NULL      -- строки без осмысленного имени отбрасываем
),
scored AS (
  SELECT m.*,
    dm.quality_score(m.is_valid_barcode, m.brand_normalized,
                     m.product_name_normalized, m.image_url,
                     m.ingredients_normalized, m.category) AS quality_score
  FROM mapped m
),
ranked AS (
  SELECT s.*,
    row_number() OVER (
      PARTITION BY s.business_key
      ORDER BY s.quality_score DESC, s.scraped_at DESC NULLS LAST
    ) AS rn
  FROM scored s
)
SELECT
  business_key,
  CASE WHEN is_valid_barcode THEN barcode_src ELSE NULL END  AS barcode,
  is_valid_barcode,
  brand_src                                                  AS brand,
  brand_normalized,
  name_src                                                   AS product_name,
  product_name_normalized,
  volume,
  category,
  image_url,
  ingredients_raw,
  ingredients_normalized,
  'national_catalog'                                         AS source,
  quality_score,
  raw_source_url,
  raw_created_at                                             AS created_at,
  scraped_at                                                 AS updated_at
FROM ranked
WHERE rn = 1;

-- ── Индексы ─────────────────────────────────────────────────────────────────
-- UNIQUE по business_key обязателен для REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS dm_products_pk
  ON dm.dm_products (business_key);

CREATE INDEX IF NOT EXISTS dm_products_barcode
  ON dm.dm_products (barcode) WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS dm_products_category
  ON dm.dm_products (category);

CREATE INDEX IF NOT EXISTS dm_products_quality
  ON dm.dm_products (quality_score DESC);

-- Быстрый поиск по имени/бренду (ILIKE %q%) — триграммы вместо full scan.
CREATE INDEX IF NOT EXISTS dm_products_name_trgm
  ON dm.dm_products USING gin (product_name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dm_products_brand_trgm
  ON dm.dm_products USING gin (brand_normalized gin_trgm_ops);

-- ── Ежедневный refresh ──────────────────────────────────────────────────────
-- CONCURRENTLY не блокирует читателей (нужен UNIQUE-индекс выше).
CREATE OR REPLACE FUNCTION dm.refresh_dm_products()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY dm.dm_products;
$$;

-- Вариант A — pg_cron (если расширение установлено):
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule('dm_products_daily', '0 4 * * *', $$SELECT dm.refresh_dm_products();$$);
--
-- Вариант B — внешний планировщик (cron на сервере / app scheduler):
--   psql "$DATABASE_URL" -c "SELECT dm.refresh_dm_products();"
--
-- Первичная материализация уже выполнена CREATE MATERIALIZED VIEW выше.
