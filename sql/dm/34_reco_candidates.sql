-- =============================================================================
-- Skinly · DM (Silver) layer · MV для recommendations pipeline (perf P0/P1)
--
-- Контекст (bench 2026-07-11, каталог ~42k, категория «Волосы» ~20k):
--   getRecoSeedCandidates p50 1.7–2.4 s — Seq Scan + jsonb_array_elements
--   ДВАЖДЫ на каждого из ~17.6k кандидатов (фильтр overlap >= 1 + сортировка).
--   getRecoProfileCandidates p50 ~0.95 s — скан/джойн 42k строк без LIMIT-aware
--   доступа (ORDER BY идёт по колонкам двух разных таблиц).
--
-- Решение:
--   1) dm.product_canonical — НОРМАЛИЗОВАННАЯ витрина «товар ↔ canonical-
--      ингредиент» (1 строка = 1 вхождение ингредиента). Overlap считается
--      count(*)-агрегацией по btree-индексу (category, canonical_id)
--      INCLUDE (business_key) — index-only scan по posting-строкам только
--      ингредиентов seed'а. Per-row jsonb исчезает из плана полностью.
--      Результат бит-в-бит совпадает с legacy-запросом (count тех же
--      вхождений, включая дубли canonical_id в составе).
--   2) dm.reco_profile_feed — материализованный результат profile-запроса:
--      он НЕ зависит от параметров запроса (профиль в SQL не входит),
--      статичен между refresh'ами DM → top-500 хранится готовым.
--
-- Код: lib/db/repositories/dm-recommendations.ts автоматически использует
-- эти MV, если они есть (to_regclass), иначе падает на legacy SQL.
-- Форс legacy: env RECO_LEGACY_SQL=1 (для A/B в bench).
--
-- Зависит от: 20_dm_products.sql, 32_product_ingredient_features.sql.
-- Запуск:
--   psql "$DATABASE_URL" -f sql/dm/34_reco_candidates.sql
-- или:
--   docker compose --profile tools run --rm tools \
--     npx prisma db execute --file sql/dm/34_reco_candidates.sql
-- =============================================================================

-- ── 1. product_canonical: товар ↔ canonical-ингредиент ──────────────────────

DROP MATERIALIZED VIEW IF EXISTS dm.product_canonical;

CREATE MATERIALIZED VIEW dm.product_canonical AS
SELECT
  f.business_key,
  p.category,
  ci.canonical_id,
  ci.position
FROM dm.product_ingredient_features f
JOIN dm.dm_products p USING (business_key)
CROSS JOIN LATERAL jsonb_to_recordset(f.canonical_ingredients)
       AS ci(canonical_id text, position int)
WHERE ci.canonical_id IS NOT NULL;

-- UNIQUE для REFRESH ... CONCURRENTLY: position уникален внутри товара
-- (ordinality из 32_product_ingredient_features).
CREATE UNIQUE INDEX IF NOT EXISTS product_canonical_pk
  ON dm.product_canonical (business_key, position);

-- Рабочий индекс getRecoSeedCandidates: predicate (category, canonical_id),
-- business_key в INCLUDE → index-only scan, heap не трогается.
CREATE INDEX IF NOT EXISTS product_canonical_cat_ing
  ON dm.product_canonical (category, canonical_id) INCLUDE (business_key);

-- Обратный lookup «все ингредиенты товара» (будущие фичи, отладка).
CREATE INDEX IF NOT EXISTS product_canonical_ing
  ON dm.product_canonical (canonical_id);

-- ── 2. reco_profile_feed: готовый top профильной ленты ──────────────────────
--
-- ⚠️ WHERE-условия — точная копия GATES из
-- lib/db/repositories/dm-recommendations.ts. При изменении GATES обновить
-- и здесь (и наоборот). LIMIT 500 = 5× POOL_SIZE — запас на рост пула.

DROP MATERIALIZED VIEW IF EXISTS dm.reco_profile_feed;

CREATE MATERIALIZED VIEW dm.reco_profile_feed AS
SELECT
  p.business_key,
  p.barcode,
  p.brand_normalized                       AS brand,
  p.product_name_normalized                AS name,
  p.category,
  p.image_url,
  p.quality_score::int                     AS quality_score,
  f.recognized_ratio::float8               AS recognized_ratio,
  f.has_fragrance, f.has_drying_alcohol, f.has_essential_oils,
  f.has_acids, f.has_retinoids,
  f.comedogenicity_max, f.irritancy_max, f.allergenicity_max,
  coalesce(f.top5_canonical, '{}'::text[]) AS top5_canonical
FROM dm.dm_products p
JOIN dm.product_ingredient_features f USING (business_key)
WHERE p.barcode IS NOT NULL
  AND p.image_url IS NOT NULL
  AND p.image_url !~* '1x1|placeholder|no[-_]image|default'
  AND p.brand_normalized IS NOT NULL
  AND p.category <> 'Прочее'
  AND p.quality_score >= 50
  AND f.recognized_ratio >= 0.3
ORDER BY p.quality_score DESC, f.recognized_ratio DESC
LIMIT 500;

CREATE UNIQUE INDEX IF NOT EXISTS reco_profile_feed_pk
  ON dm.reco_profile_feed (business_key);

-- ── 3. Refresh ───────────────────────────────────────────────────────────────
-- Вызывать ПОСЛЕ dm.refresh_dm_products() и
-- dm.refresh_product_ingredient_features() (обе MV производные от них).

CREATE OR REPLACE FUNCTION dm.refresh_reco_candidates()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY dm.product_canonical;
  REFRESH MATERIALIZED VIEW CONCURRENTLY dm.reco_profile_feed;
$$;

-- Порядок ежедневного обновления DM-слоя теперь:
--   SELECT dm.refresh_dm_products();
--   SELECT dm.refresh_product_ingredient_features();
--   SELECT dm.refresh_reco_candidates();

ANALYZE dm.product_canonical;
ANALYZE dm.reco_profile_feed;
