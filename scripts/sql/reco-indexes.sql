-- ─────────────────────────────────────────────────────────────────────────
-- Индексы для recommendations pipeline (Phase perf-refactor).
--
-- dm.* — вне Prisma schema (materialized views + reference tables), поэтому
-- НЕ миграция Prisma, а ручной SQL. Применять через tools-контейнер:
--
--   docker compose --profile tools run --rm tools \
--     npx prisma db execute --file scripts/sql/reco-indexes.sql
--
-- или напрямую psql. Индексы на materialized view переживают
-- REFRESH MATERIALIZED VIEW (пересоздавать не нужно).
--
-- UserProductEvent индексы НЕ нужны — уже есть в Prisma schema:
--   @@index([userId, createdAt]) / @@index([anonymousId, createdAt]) /
--   @@index([barcode]).
-- ─────────────────────────────────────────────────────────────────────────

-- 1. getRecoSeed / queryCompatRows: точечный lookup по barcode.
CREATE INDEX IF NOT EXISTS idx_dm_products_barcode
  ON dm.dm_products (barcode);

-- 2. JOIN dm_products ⋈ product_ingredient_features USING (business_key).
--    UNIQUE обязателен и для REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_products_business_key
  ON dm.dm_products (business_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pif_business_key
  ON dm.product_ingredient_features (business_key);

-- 3. getRecoSeedCandidates: скан категории + сортировка по качеству.
--    Составной индекс закрывает WHERE category = $1 и большую часть ORDER BY.
CREATE INDEX IF NOT EXISTS idx_dm_products_category_quality
  ON dm.dm_products (category, quality_score DESC);

-- 4. getRecoProfileCandidates: partial index под gates + ORDER BY quality.
--    Условия повторяют GATES из dm-recommendations.ts (кроме image_url-regex
--    и recognized_ratio — они дешёвые фильтры поверх уже суженного набора).
CREATE INDEX IF NOT EXISTS idx_dm_products_profile_feed
  ON dm.dm_products (quality_score DESC)
  WHERE barcode IS NOT NULL
    AND image_url IS NOT NULL
    AND brand_normalized IS NOT NULL
    AND category <> 'Прочее'
    AND quality_score >= 50;

-- 5. queryCompatRows: lookup справочников по canonical_id.
--    Если это PK — команды безвредны (IF NOT EXISTS / уже unique).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredients_canonical_id
  ON dm.ingredients_canonical (canonical_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_properties_id
  ON dm.ingredient_properties (canonical_id);

-- Проверка планов после применения:
--   EXPLAIN (ANALYZE, BUFFERS) SELECT ... ;  -- запросы из dm-recommendations.ts
ANALYZE dm.dm_products;
ANALYZE dm.product_ingredient_features;
