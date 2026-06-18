-- =============================================================================
-- Skinly · DM (Silver) layer · MV dm.product_ingredient_features
--
-- На каждый товар из dm.dm_products считает «состав в канонике»:
--   • сколько ингредиентов распознано (recognized_ratio);
--   • массив canonical + позиция;
--   • флаги риска (отдушка / спирт / эфирные масла / кислоты / ретиноиды);
--   • max-метрики (комедогенность / раздражительность / аллергенность).
--
-- Это вход для compatibility-скоринга кандидатов и для рекомендаций. Сам
-- compatibility-engine (lib/compatibility/*) НЕ трогаем — он остаётся точечным
-- движком; здесь только дешёвый предрасчёт по каталогу.
--
-- Источник: dm.dm_products.ingredients_normalized (text[]) — уже очищенный
-- массив; здесь каждый токен → dm.norm_ingredient_alias → JOIN aliases →
-- canonical → properties.
--
-- Ключ MV — business_key (как в dm.dm_products), barcode выставляется рядом.
--
-- Зависит от: 20_dm_products.sql, 30_*, 31_*.
-- Запуск:
--   psql "$DATABASE_URL" -f sql/dm/32_product_ingredient_features.sql
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS dm.product_ingredient_features;

CREATE MATERIALIZED VIEW dm.product_ingredient_features AS
WITH exploded AS (
  -- развернуть массив состава в строки с порядком
  SELECT
    p.business_key,
    p.barcode,
    u.ord,
    dm.norm_ingredient_alias(u.ing) AS alias_norm
  FROM dm.dm_products p
  CROSS JOIN LATERAL unnest(p.ingredients_normalized) WITH ORDINALITY AS u(ing, ord)
  WHERE p.ingredients_normalized IS NOT NULL
),
matched AS (
  SELECT
    e.business_key,
    e.barcode,
    e.ord,
    e.alias_norm,
    a.canonical_id,
    coalesce(c.is_junk, false)                                   AS is_junk,
    -- распознанный «настоящий» ингредиент (не мусор, есть каноника)
    (a.canonical_id IS NOT NULL AND coalesce(c.is_junk,false) = false) AS is_recognized,
    pr.tags,
    pr.flags_avoided,
    pr.comedogenicity,
    pr.irritancy,
    pr.allergenicity
  FROM exploded e
  LEFT JOIN dm.ingredient_aliases    a  ON a.alias_norm   = e.alias_norm
  LEFT JOIN dm.ingredients_canonical c  ON c.canonical_id = a.canonical_id
  LEFT JOIN dm.ingredient_properties pr ON pr.canonical_id = a.canonical_id
),
agg AS (
  SELECT
    business_key,
    barcode,
    -- знаменатель: осмысленные токены (исключаем мусор)
    count(*) FILTER (WHERE NOT is_junk)                                 AS total_ingredients,
    count(*) FILTER (WHERE is_recognized)                               AS recognized_ingredients,
    -- состав в канонике (только распознанные, по позиции)
    jsonb_agg(jsonb_build_object('canonical_id', canonical_id, 'position', ord)
              ORDER BY ord) FILTER (WHERE is_recognized)               AS canonical_ingredients,
    (array_agg(canonical_id ORDER BY ord)
              FILTER (WHERE is_recognized))[1:5]                        AS top5_canonical,
    -- флаги риска
    coalesce(bool_or('fragrance' = ANY(tags) OR 'fragrance' = ANY(flags_avoided)), false) AS has_fragrance,
    coalesce(bool_or('alcohol_drying' = ANY(tags)), false)             AS has_drying_alcohol,
    coalesce(bool_or('essential_oil' = ANY(tags)
                     OR 'essential_oils' = ANY(flags_avoided)), false) AS has_essential_oils,
    coalesce(bool_or(tags && ARRAY['exfoliant_aha','exfoliant_bha','exfoliant_pha']), false) AS has_acids,
    coalesce(bool_or('retinoid' = ANY(tags)), false)                   AS has_retinoids,
    -- max-метрики риска
    coalesce(max(comedogenicity), 0)                                   AS comedogenicity_max,
    coalesce(max(irritancy), 0)                                        AS irritancy_max,
    coalesce(max(allergenicity), 0)                                    AS allergenicity_max
  FROM matched
  GROUP BY business_key, barcode
)
SELECT
  business_key,
  barcode,
  total_ingredients,
  recognized_ingredients,
  CASE WHEN total_ingredients > 0
       THEN round(recognized_ingredients::numeric / total_ingredients, 4)
       ELSE 0 END                                            AS recognized_ratio,
  coalesce(canonical_ingredients, '[]'::jsonb)               AS canonical_ingredients,
  coalesce(top5_canonical, '{}'::text[])                     AS top5_canonical,
  has_fragrance,
  has_drying_alcohol,
  has_essential_oils,
  has_acids,
  has_retinoids,
  comedogenicity_max,
  irritancy_max,
  allergenicity_max
FROM agg;

-- ── Индексы ─────────────────────────────────────────────────────────────────
-- UNIQUE по business_key обязателен для REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS product_ingredient_features_pk
  ON dm.product_ingredient_features (business_key);

CREATE INDEX IF NOT EXISTS product_ingredient_features_barcode
  ON dm.product_ingredient_features (barcode) WHERE barcode IS NOT NULL;

-- частичный индекс «скорируемые» товары (recognized_ratio >= 0.3)
CREATE INDEX IF NOT EXISTS product_ingredient_features_scorable
  ON dm.product_ingredient_features (recognized_ratio)
  WHERE recognized_ratio >= 0.3;

CREATE INDEX IF NOT EXISTS product_ingredient_features_top5
  ON dm.product_ingredient_features USING gin (top5_canonical);

-- ── Ежедневный refresh ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dm.refresh_product_ingredient_features()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY dm.product_ingredient_features;
$$;

-- Порядок ежедневного обновления (сначала продукты, потом фичи):
--   SELECT dm.refresh_dm_products();
--   SELECT dm.refresh_product_ingredient_features();
