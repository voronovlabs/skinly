-- =============================================================================
-- Skinly · DM design · АУДИТ каталога Национального каталога (READ-ONLY)
--
-- Запускать против рабочей БД:
--   psql "$DATABASE_URL" -f sql/dm/00_audit.sql
--   (или через `docker compose --profile tools run --rm tools psql ...`)
--
-- Только SELECT'ы. Ничего не меняет, не удаляет, не трогает raw.
-- Источник: "NationalCatalogRawProduct" (raw, source of truth) + "Product".
-- payload — jsonb-объект ScrapedProduct:
--   title, brand, barcode, imageUrl, compositionRaw, categoryPath[], flatAttributes{}
-- =============================================================================

\echo '=== 0. Размеры таблиц ==='
SELECT
  (SELECT count(*) FROM "NationalCatalogRawProduct")               AS raw_rows,
  (SELECT count(DISTINCT "sourceUrl") FROM "NationalCatalogRawProduct") AS raw_distinct_urls,
  (SELECT count(DISTINCT barcode) FROM "NationalCatalogRawProduct"
     WHERE barcode IS NOT NULL)                                    AS raw_distinct_barcodes,
  (SELECT count(*) FROM "Product")                                 AS products,
  (SELECT count(*) FROM "Ingredient")                              AS ingredients,
  (SELECT count(*) FROM "ProductIngredient")                       AS product_ingredient_links;

\echo '=== 1. Полнота полей в raw (NULL / пустые) ==='
SELECT
  count(*)                                                          AS total,
  count(*) FILTER (WHERE barcode IS NULL)                          AS no_barcode,
  count(*) FILTER (WHERE coalesce(payload->>'title','')      = '') AS no_title,
  count(*) FILTER (WHERE coalesce(payload->>'brand','')      = '') AS no_brand,
  count(*) FILTER (WHERE coalesce(payload->>'imageUrl','')   = '') AS no_image,
  count(*) FILTER (WHERE coalesce(payload->>'compositionRaw','') = '') AS no_composition,
  count(*) FILTER (WHERE coalesce(payload->'categoryPath'->>1,'') = '') AS no_category_lvl2
FROM "NationalCatalogRawProduct";

\echo '=== 2. Качество barcode (валидность EAN по длине) ==='
SELECT
  length(barcode)                       AS barcode_len,
  count(*)                              AS n
FROM "NationalCatalogRawProduct"
WHERE barcode IS NOT NULL
GROUP BY length(barcode)
ORDER BY n DESC;

\echo '=== 3. Дубли barcode в raw (один штрихкод — несколько sourceUrl) ==='
SELECT barcode, count(*) AS dup_rows
FROM "NationalCatalogRawProduct"
WHERE barcode IS NOT NULL
GROUP BY barcode
HAVING count(*) > 1
ORDER BY dup_rows DESC
LIMIT 25;

\echo '=== 3b. Сколько штрихкодов задублировано и сколько лишних строк ==='
WITH d AS (
  SELECT barcode, count(*) AS c
  FROM "NationalCatalogRawProduct"
  WHERE barcode IS NOT NULL
  GROUP BY barcode HAVING count(*) > 1
)
SELECT count(*) AS duplicated_barcodes, coalesce(sum(c-1),0) AS extra_rows FROM d;

\echo '=== 4. Дубли по нормализованному имени+бренду (без barcode-ключа) ==='
WITH norm AS (
  SELECT
    lower(regexp_replace(coalesce(payload->>'brand',''), '\s+', ' ', 'g'))  AS b,
    lower(regexp_replace(coalesce(payload->>'title',''), '\s+', ' ', 'g'))  AS n
  FROM "NationalCatalogRawProduct"
)
SELECT b AS brand, n AS name, count(*) AS dups
FROM norm
WHERE n <> ''
GROUP BY b, n
HAVING count(*) > 1
ORDER BY dups DESC
LIMIT 25;

\echo '=== 5. Мусорные бренды (юрлица, Unknown, числовые, слишком длинные) ==='
SELECT
  count(*) FILTER (WHERE payload->>'brand' ~* '^(ооо|оао|зао|ип|пао|ао)\M') AS legal_entity,
  count(*) FILTER (WHERE payload->>'brand' ILIKE 'unknown')                 AS literally_unknown,
  count(*) FILTER (WHERE payload->>'brand' ~ '^\s*\d+\s*$')                  AS numeric_only,
  count(*) FILTER (WHERE length(payload->>'brand') > 40)                     AS too_long,
  count(*) FILTER (WHERE payload->>'brand' ~ '["«»™®©]')                     AS has_symbols
FROM "NationalCatalogRawProduct";

\echo '=== 5b. ТОП «брендов» по частоте (увидеть мусор глазами) ==='
SELECT coalesce(payload->>'brand','(null)') AS brand, count(*) AS n
FROM "NationalCatalogRawProduct"
GROUP BY 1
ORDER BY n DESC
LIMIT 40;

\echo '=== 6. Мусорные названия (CAPS, html, слишком коротко/длинно, слэши) ==='
SELECT
  count(*) FILTER (WHERE payload->>'title' = upper(payload->>'title')
                    AND payload->>'title' ~ '[А-ЯA-Z]')             AS all_caps,
  count(*) FILTER (WHERE payload->>'title' ~ '<[^>]+>')             AS has_html,
  count(*) FILTER (WHERE length(payload->>'title') < 5)             AS too_short,
  count(*) FILTER (WHERE length(payload->>'title') > 150)           AS too_long,
  count(*) FILTER (WHERE payload->>'title' ~ '/{1,}\s*\d+\s*$')     AS trailing_slash_code
FROM "NationalCatalogRawProduct";

\echo '=== 7. Состав: наличие и средняя длина ==='
SELECT
  count(*) FILTER (WHERE coalesce(payload->>'compositionRaw','') <> '') AS with_composition,
  round(avg(length(payload->>'compositionRaw')) FILTER
        (WHERE coalesce(payload->>'compositionRaw','') <> ''))          AS avg_len,
  count(*) FILTER (WHERE coalesce(payload->>'compositionRaw','') = '')  AS without_composition
FROM "NationalCatalogRawProduct";

\echo '=== 8. Изображения: пустые / placeholder 1x1 ==='
SELECT
  count(*) FILTER (WHERE coalesce(payload->>'imageUrl','') = '')        AS no_image,
  count(*) FILTER (WHERE payload->>'imageUrl' ~* '1x1|placeholder|no[-_]image|default') AS placeholder
FROM "NationalCatalogRawProduct";

\echo '=== 9. Распределение по level-2 категории (как видит API) ==='
SELECT
  coalesce(nullif(trim(lower(payload->'categoryPath'->>1)), ''), '(нет)') AS category_lvl2,
  count(*) AS n
FROM "NationalCatalogRawProduct"
GROUP BY 1
ORDER BY n DESC
LIMIT 30;

\echo '=== 10. Product.category (ожидаем: почти всё OTHER) ==='
SELECT category, count(*) AS n FROM "Product" GROUP BY category ORDER BY n DESC;

\echo '=== 11. Разрыв raw → Product (сколько raw не доехало до Product) ==='
SELECT
  (SELECT count(DISTINCT barcode) FROM "NationalCatalogRawProduct" WHERE barcode IS NOT NULL) AS raw_barcodes,
  (SELECT count(*) FROM "Product")                                                            AS products,
  (SELECT count(*) FROM "NationalCatalogRawProduct" WHERE barcode IS NULL)                    AS raw_dropped_no_barcode;
