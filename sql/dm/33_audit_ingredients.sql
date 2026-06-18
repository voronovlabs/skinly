-- =============================================================================
-- Skinly · DM (Silver) layer · АУДИТ канонизации ингредиентов (READ-ONLY)
--
-- Только SELECT'ы. Ничего не меняет. Снимает реальные числа качества каноники:
--   • общий recognized_ratio по каталогу;
--   • топ нераспознанных ингредиентов (что добавить в aliases следующим);
--   • сколько товаров low-confidence (< 0.3);
--   • сколько товаров реально можно скорить;
--   • разброс синонимов aqua/water/вода и parfum/fragrance/отдушка;
--   • топ сырых токенов и мусор.
--
-- Зависит от: 20_dm_products.sql, 30_*, 31_*, 32_*.
-- Запуск:
--   psql "$DATABASE_URL" -f sql/dm/33_audit_ingredients.sql
-- =============================================================================

\echo '=== 0. Размеры справочников каноники ==='
SELECT
  (SELECT count(*) FROM dm.ingredients_canonical)                      AS canonical_rows,
  (SELECT count(*) FROM dm.ingredients_canonical WHERE is_junk)        AS canonical_junk,
  (SELECT count(*) FROM dm.ingredient_aliases)                         AS alias_rows,
  (SELECT count(*) FROM dm.ingredient_properties)                      AS property_rows,
  (SELECT count(*) FROM dm.dm_products)                                AS dm_products,
  (SELECT count(*) FROM dm.dm_products WHERE ingredients_normalized IS NOT NULL) AS dm_products_with_ingredients;

\echo '=== 1. ОБЩИЙ recognized_ratio по каталогу (взвешенный по ингредиентам) ==='
-- Микро-уровень: доля распознанных токенов среди всех осмысленных токенов.
SELECT
  sum(recognized_ingredients)                                         AS recognized_tokens,
  sum(total_ingredients)                                              AS total_tokens,
  round(sum(recognized_ingredients)::numeric
        / nullif(sum(total_ingredients), 0), 4)                       AS recognized_ratio_micro,
  round(avg(recognized_ratio), 4)                                     AS recognized_ratio_macro_avg
FROM dm.product_ingredient_features;

\echo '=== 2. Распределение товаров по recognized_ratio ==='
SELECT
  width_bucket(recognized_ratio, 0, 1.0001, 10) AS bucket_0_10,
  count(*)                                       AS products
FROM dm.product_ingredient_features
GROUP BY bucket_0_10
ORDER BY bucket_0_10;

\echo '=== 3. Low-confidence vs scorable ==='
SELECT
  count(*)                                                            AS products_total,
  count(*) FILTER (WHERE recognized_ratio < 0.3)                     AS low_confidence_lt_030,
  count(*) FILTER (WHERE recognized_ratio >= 0.3)                    AS confident_ge_030,
  count(*) FILTER (WHERE recognized_ratio >= 0.3
                    AND total_ingredients >= 2)                       AS scorable,   -- можно реально скорить
  round(100.0 * count(*) FILTER (WHERE recognized_ratio >= 0.3 AND total_ingredients >= 2)
        / nullif(count(*), 0), 1)                                     AS scorable_pct
FROM dm.product_ingredient_features;

\echo '=== 4. ТОП-40 нераспознанных ингредиентов (кандидаты в aliases) ==='
-- То, что встречается часто, но не имеет каноники → следующая партия алиасов.
WITH tok AS (
  SELECT dm.norm_ingredient_alias(u.ing) AS alias_norm
  FROM dm.dm_products p
  CROSS JOIN LATERAL unnest(p.ingredients_normalized) AS u(ing)
  WHERE p.ingredients_normalized IS NOT NULL
)
SELECT t.alias_norm, count(*) AS occurrences
FROM tok t
LEFT JOIN dm.ingredient_aliases a ON a.alias_norm = t.alias_norm
WHERE t.alias_norm IS NOT NULL
  AND a.canonical_id IS NULL
GROUP BY t.alias_norm
ORDER BY occurrences DESC
LIMIT 40;

\echo '=== 5. ТОП-40 сырых токенов состава (общая частота — для приоритизации) ==='
WITH tok AS (
  SELECT dm.norm_ingredient_alias(u.ing) AS alias_norm
  FROM dm.dm_products p
  CROSS JOIN LATERAL unnest(p.ingredients_normalized) AS u(ing)
  WHERE p.ingredients_normalized IS NOT NULL
)
SELECT
  t.alias_norm,
  count(*)                                  AS occurrences,
  (a.canonical_id IS NOT NULL)              AS recognized,
  a.canonical_id
FROM tok t
LEFT JOIN dm.ingredient_aliases a ON a.alias_norm = t.alias_norm
WHERE t.alias_norm IS NOT NULL
GROUP BY t.alias_norm, a.canonical_id
ORDER BY occurrences DESC
LIMIT 40;

\echo '=== 6. RU/EN дубли — как синонимы воды реально сводятся к water ==='
WITH tok AS (
  SELECT dm.norm_ingredient_alias(u.ing) AS alias_norm
  FROM dm.dm_products p
  CROSS JOIN LATERAL unnest(p.ingredients_normalized) AS u(ing)
  WHERE p.ingredients_normalized IS NOT NULL
)
SELECT
  coalesce(a.canonical_id, '(не распознан)') AS canonical_id,
  t.alias_norm,
  count(*)                                   AS occurrences
FROM tok t
LEFT JOIN dm.ingredient_aliases a ON a.alias_norm = t.alias_norm
WHERE t.alias_norm ~ '(aqua|water|вода|eau)'
   OR t.alias_norm ~ '(parfum|fragrance|отдушк|ароматизатор)'
GROUP BY a.canonical_id, t.alias_norm
ORDER BY canonical_id, occurrences DESC
LIMIT 60;

\echo '=== 7. Мусорные токены (очень короткие / числовые остатки) ==='
WITH tok AS (
  SELECT u.ing AS raw, dm.norm_ingredient_alias(u.ing) AS alias_norm
  FROM dm.dm_products p
  CROSS JOIN LATERAL unnest(p.ingredients_normalized) AS u(ing)
  WHERE p.ingredients_normalized IS NOT NULL
)
SELECT
  raw,
  alias_norm,
  count(*) AS occurrences
FROM tok
WHERE alias_norm IS NULL                       -- стало пусто после нормализации (числа/символы)
   OR length(alias_norm) <= 2                  -- слишком короткие огрызки
GROUP BY raw, alias_norm
ORDER BY occurrences DESC
LIMIT 40;

\echo '=== 8. Покрытие флагов риска по каталогу ==='
SELECT
  count(*)                                       AS products,
  count(*) FILTER (WHERE has_fragrance)          AS with_fragrance,
  count(*) FILTER (WHERE has_drying_alcohol)     AS with_drying_alcohol,
  count(*) FILTER (WHERE has_essential_oils)     AS with_essential_oils,
  count(*) FILTER (WHERE has_acids)              AS with_acids,
  count(*) FILTER (WHERE has_retinoids)          AS with_retinoids
FROM dm.product_ingredient_features;
