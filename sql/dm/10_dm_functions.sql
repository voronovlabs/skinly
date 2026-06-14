-- =============================================================================
-- Skinly · DM (Silver) layer · нормализационные функции
--
-- Всё в схеме `dm` — АДДИТИВНО. Raw-таблицы не изменяются, не читаются на
-- запись. Функции IMMUTABLE → их можно использовать в индексах/материализациях.
--
-- Запуск (идемпотентно):
--   psql "$DATABASE_URL" -f sql/dm/10_dm_functions.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS dm;

-- ── базовая чистка пробелов / nbsp ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION dm.norm_ws(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    btrim(regexp_replace(replace(coalesce(s,''), chr(160), ' '), '\s+', ' ', 'g')),
    ''
  );
$$;

-- ── снять html-теги и html-сущности ────────────────────────────────────────
CREATE OR REPLACE FUNCTION dm.strip_html(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT dm.norm_ws(
    regexp_replace(
      regexp_replace(coalesce(s,''), '<[^>]+>', ' ', 'g'),
      '&[a-z#0-9]+;', ' ', 'gi'
    )
  );
$$;

-- ── валидный GTIN (EAN-8 / UPC-12 / EAN-13 / GTIN-14) по контрольной сумме ──
CREATE OR REPLACE FUNCTION dm.is_valid_ean(code text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n int; s int := 0; i int; w int;
BEGIN
  IF code IS NULL OR code !~ '^\d+$' THEN RETURN false; END IF;
  n := length(code);
  IF n NOT IN (8,12,13,14) THEN RETURN false; END IF;
  FOR i IN 1..n-1 LOOP
    -- вес 3/1, начиная с крайней правой цифры данных
    w := CASE WHEN ((n-1-i) % 2) = 0 THEN 3 ELSE 1 END;
    s := s + substr(code, i, 1)::int * w;
  END LOOP;
  RETURN ((10 - (s % 10)) % 10) = substr(code, n, 1)::int;
END $$;

-- ── мусорный ли бренд (юрлицо / Unknown / число / слишком длинный) ──────────
CREATE OR REPLACE FUNCTION dm.is_garbage_brand(s text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    s IS NULL
    OR dm.norm_ws(s) IS NULL
    OR dm.norm_ws(s) ILIKE 'unknown'
    OR dm.norm_ws(s) ~ '^\s*\d+\s*$'                              -- только цифры
    OR dm.norm_ws(s) ~* '^(ооо|оао|зао|пао|ип|ао|тоо|чп)\M'       -- юрлицо
    OR length(dm.norm_ws(s)) > 50;
$$;

-- ── нормализованный бренд: чистый бренд или NULL (если мусор) ───────────────
CREATE OR REPLACE FUNCTION dm.norm_brand(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN dm.is_garbage_brand(s) THEN NULL
    ELSE dm.norm_ws(
      regexp_replace(            -- снять ™®© « » " ' и обрамляющие кавычки
        regexp_replace(coalesce(s,''), '[™®©«»"'']', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    )
  END;
$$;

-- ── ключ дедупликации бренда (lowercase, без знаков) ────────────────────────
CREATE OR REPLACE FUNCTION dm.brand_key(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(coalesce(dm.norm_brand(s), ''));
$$;

-- ── нормализованное название товара ─────────────────────────────────────────
-- strip html → снять служебные префиксы → снять хвостовой «/16» код →
-- схлопнуть пробелы → CAPS-строки привести к Initcap.
CREATE OR REPLACE FUNCTION dm.norm_name(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH a AS (SELECT dm.strip_html(s) AS v),
  b AS (  -- служебные префиксы маркетплейса/каталога
    SELECT regexp_replace(v, '^(купить|заказать|товар|product)\s*[:—-]?\s*', '', 'i') AS v FROM a
  ),
  c AS (  -- хвостовой служебный код вида « /16», « / 230»
    SELECT regexp_replace(v, '\s*/+\s*\d+\s*$', '', 'g') AS v FROM b
  ),
  d AS (SELECT dm.norm_ws(v) AS v FROM c)
  SELECT CASE
    WHEN v IS NULL THEN NULL
    -- ALL CAPS (рус/лат, >3 буквенных символов) → аккуратный регистр
    WHEN v = upper(v) AND v ~ '[А-ЯA-Z].*[А-ЯA-Z].*[А-ЯA-Z]'
      THEN initcap(lower(v))
    ELSE v
  END
  FROM d;
$$;

-- ── ключ дедупликации имени (lowercase, ё→е, только буквы/цифры) ────────────
CREATE OR REPLACE FUNCTION dm.name_key(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    regexp_replace(
      translate(lower(coalesce(dm.norm_name(s), '')), 'ё', 'е'),
      '[^a-zа-я0-9]+', '', 'g'
    ),
    ''
  );
$$;

-- ── извлечь нормализованный объём из названия («150мл.»/«150 ML» → «150 мл») ─
CREATE OR REPLACE FUNCTION dm.extract_volume(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (
    SELECT (regexp_match(
      coalesce(s,''),
      '(\d+(?:[.,]\d+)?)\s*(мл|ml|мг|mg|гр|г|g|л|l|шт)\M', 'i'
    )) AS g
  )
  SELECT CASE WHEN g IS NULL THEN NULL ELSE
    replace(g[1], ',', '.') || ' ' ||
    CASE lower(g[2])
      WHEN 'ml' THEN 'мл' WHEN 'l' THEN 'л' WHEN 'g' THEN 'г'
      WHEN 'гр' THEN 'г' WHEN 'mg' THEN 'мг' ELSE lower(g[2])
    END
  END
  FROM m;
$$;

-- ── INCI/состав: сырую строку → нормализованный массив ──────────────────────
-- split по , ; / → trim → lower → снять маркеры *•· и кавычки → dedup (порядок).
CREATE OR REPLACE FUNCTION dm.norm_ingredients(raw text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  WITH parts AS (
    SELECT ord, dm.norm_ws(
      regexp_replace(lower(tok), '[*•·«»"'']', '', 'g')
    ) AS ing
    FROM regexp_split_to_table(coalesce(raw,''), '[,;/]') WITH ORDINALITY AS t(tok, ord)
  ),
  filt AS (
    SELECT ord, ing FROM parts
    WHERE ing IS NOT NULL AND length(ing) BETWEEN 2 AND 200
  ),
  dedup AS (  -- первый по порядку экземпляр каждого ингредиента
    SELECT DISTINCT ON (ing) ord, ing FROM filt ORDER BY ing, ord
  )
  SELECT array_agg(ing ORDER BY ord) FROM dedup;
$$;

-- ── quality_score 0..100 (полнота + чистота полей) ──────────────────────────
CREATE OR REPLACE FUNCTION dm.quality_score(
  has_valid_barcode boolean,
  brand text,            -- уже нормализованный (NULL = мусор/нет)
  name  text,            -- уже нормализованное
  image text,
  ingredients text[],
  category text          -- NULL/'Прочее' = не распознана
)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT least(100, greatest(0,
      (CASE WHEN has_valid_barcode THEN 30 ELSE 0 END)
    + (CASE WHEN brand IS NOT NULL THEN 20 ELSE 0 END)
    + (CASE WHEN name IS NOT NULL AND length(name) BETWEEN 5 AND 150 THEN 20 ELSE 0 END)
    + (CASE WHEN image IS NOT NULL AND image <> ''
              AND image !~* '1x1|placeholder|no[-_]image|default' THEN 10 ELSE 0 END)
    + (CASE WHEN ingredients IS NOT NULL AND cardinality(ingredients) >= 2 THEN 15 ELSE 0 END)
    + (CASE WHEN category IS NOT NULL AND category <> 'Прочее' THEN 5 ELSE 0 END)
  ));
$$;
