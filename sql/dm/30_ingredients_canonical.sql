-- =============================================================================
-- Skinly · DM (Silver) layer · canonical ingredient layer — СХЕМА
--
-- Этап «canonical ingredient layer» (см. docs/recommender-audit.md §6).
-- Чинит проблему грязных ингредиентов: aqua / water / вода / вода очищенная —
-- сейчас это разные строки; здесь они сводятся к одному canonical_id.
--
-- Полностью АДДИТИВНО:
--   • raw ("NationalCatalogRawProduct") НЕ трогаем;
--   • public."Product"/"Ingredient"/"ProductIngredient" НЕ трогаем;
--   • compatibility-engine (lib/compatibility/*) НЕ трогаем;
--   • работаем только в схеме dm.
--
-- Три справочные таблицы (reference data, не MV):
--   dm.ingredients_canonical  — один канонический ингредиент = одна строка
--   dm.ingredient_aliases     — все варианты написания → canonical_id
--   dm.ingredient_properties  — семантика ингредиента для скоринга
-- + функция нормализации алиаса dm.norm_ingredient_alias(text).
--
-- Запуск (идемпотентно; зависит от 10_dm_functions.sql — dm.strip_html/norm_ws):
--   psql "$DATABASE_URL" -f sql/dm/10_dm_functions.sql
--   psql "$DATABASE_URL" -f sql/dm/30_ingredients_canonical.sql
--   psql "$DATABASE_URL" -f sql/dm/31_seed_ingredient_aliases.sql
--   psql "$DATABASE_URL" -f sql/dm/32_product_ingredient_features.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS dm;

-- ─────────────────────────────────────────────────────────────────────────────
-- Функция нормализации алиаса.
--
-- Любая входная строка (RU/EN, грязная) → стабильный ключ для матчинга.
-- Шаги:
--   1) strip html (теги + сущности) и схлопывание пробелов  (dm.strip_html);
--   2) lower + ё → е;
--   3) убрать проценты: «4 %», «0.5%», «10 %»;
--   4) пунктуацию/маркеры/слеши → пробел (сохраняя границы токенов:
--      «vitamin-c» → «vitamin c», а не «vitaminc»);
--   5) оставить только буквы (lat/cyr) / цифры / пробел;
--   6) выкинуть «голые» числовые токены («1», «230», CI-номер «77491»),
--      НО не цифры внутри слов («b3», «np», «c20»);
--   7) финальное схлопывание пробелов (dm.norm_ws).
--
-- IMMUTABLE → можно индексировать и использовать в материализациях.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dm.norm_ingredient_alias(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH a AS (  -- html прочь, lower, ё→е
    SELECT translate(lower(coalesce(dm.strip_html(s), '')), 'ё', 'е') AS v
  ),
  b AS (  -- убрать проценты
    SELECT regexp_replace(v, '\d+(?:[.,]\d+)?\s*%', ' ', 'g') AS v FROM a
  ),
  c AS (  -- всё, кроме букв/цифр/пробела → пробел (границы токенов сохраняем)
    SELECT regexp_replace(v, '[^a-zа-я0-9 ]+', ' ', 'g') AS v FROM b
  ),
  d AS (  -- выкинуть отдельно стоящие числовые токены
    SELECT regexp_replace(v, '\m\d+\M', ' ', 'g') AS v FROM c
  )
  SELECT dm.norm_ws(v) FROM d;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- dm.ingredients_canonical — один канонический ингредиент = одна строка.
--   canonical_id  — стабильный slug (`water`, `niacinamide`, `sodium_hyaluronate`).
--   inci_name     — каноническое INCI (EN), напр. `Sodium Hyaluronate`.
--   display_ru/en — человекочитаемые имена для UI.
--   is_junk       — маркетинговый мусор / не-ингредиент («и др.», «состав»).
-- Обновляется: seed (31_*) + ручное расширение при разборе нераспознанных.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm.ingredients_canonical (
  canonical_id text PRIMARY KEY,
  inci_name    text,
  display_ru   text,
  display_en   text,
  is_junk      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- dm.ingredient_aliases — все варианты написания → canonical_id.
--   alias_norm   — нормализованный ключ (dm.norm_ingredient_alias). PK ⇒ один
--                  алиас указывает ровно на один canonical_id.
--   lang         — 'ru' | 'en' | 'mixed' (информативно).
--   source       — 'seed' | 'kb' | 'manual' | 'auto' (откуда добавлен).
-- Обновляется: seed (31_*) + дозаполнение из топа нераспознанных (33_audit).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm.ingredient_aliases (
  alias_norm   text PRIMARY KEY,
  canonical_id text NOT NULL
                 REFERENCES dm.ingredients_canonical(canonical_id) ON DELETE CASCADE,
  lang         text,
  source       text NOT NULL DEFAULT 'seed'
);

CREATE INDEX IF NOT EXISTS ingredient_aliases_canonical
  ON dm.ingredient_aliases (canonical_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- dm.ingredient_properties — семантика ингредиента (вынос KB в БД).
-- Значения совместимы с lib/compatibility (lowercase id'шники):
--   tags          — IngredientTag движка (humectant, exfoliant_bha, fragrance…);
--   benefits_for  — SkinConcern (acne, aging, pigmentation, redness, pores, blackheads);
--   cautions_for  — SkinConcern, при которых нужна осторожность;
--   flags_avoided — AvoidedIngredient (fragrance, alcohol, sulfates, parabens, essential_oils);
--   functions     — высокоуровневые функции (humectant, occlusive, uv_filter, surfactant…);
--   comedogenicity 0..5, irritancy 0..3, allergenicity 0..3 — seed-эвристики;
--   pregnancy_caution — мягкий safety-флаг (ретиноиды, BHA в высокой концентрации).
-- Обновляется: seed (31_*) + ручное расширение.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm.ingredient_properties (
  canonical_id      text PRIMARY KEY
                      REFERENCES dm.ingredients_canonical(canonical_id) ON DELETE CASCADE,
  functions         text[]  NOT NULL DEFAULT '{}',
  tags              text[]  NOT NULL DEFAULT '{}',
  benefits_for      text[]  NOT NULL DEFAULT '{}',
  cautions_for      text[]  NOT NULL DEFAULT '{}',
  flags_avoided     text[]  NOT NULL DEFAULT '{}',
  comedogenicity    int     NOT NULL DEFAULT 0,
  irritancy         int     NOT NULL DEFAULT 0,
  allergenicity     int     NOT NULL DEFAULT 0,
  pregnancy_caution boolean NOT NULL DEFAULT false
);

-- GIN-индексы под features-MV (фильтры по тегам/флагам).
CREATE INDEX IF NOT EXISTS ingredient_properties_tags
  ON dm.ingredient_properties USING gin (tags);
CREATE INDEX IF NOT EXISTS ingredient_properties_flags
  ON dm.ingredient_properties USING gin (flags_avoided);

-- =============================================================================
-- SMOKE: самопроверка нормализатора алиасов (падает, если правило сломано).
-- =============================================================================
DO $smoke$
BEGIN
  -- синонимы воды сводятся к одной форме
  ASSERT dm.norm_ingredient_alias('Вода очищенная')   = 'вода очищенная';
  ASSERT dm.norm_ingredient_alias('AQUA')             = 'aqua';
  ASSERT dm.norm_ingredient_alias('Water')            = 'water';
  -- проценты и номера выкидываются
  ASSERT dm.norm_ingredient_alias('Niacinamide 4%')   = 'niacinamide';
  ASSERT dm.norm_ingredient_alias('CI 77491')         = 'ci';
  ASSERT dm.norm_ingredient_alias('  1  ')            IS NULL;        -- только число → пусто
  -- цифры ВНУТРИ слова сохраняются
  ASSERT dm.norm_ingredient_alias('Vitamin B3')       = 'vitamin b3';
  ASSERT dm.norm_ingredient_alias('Ceramide NP')      = 'ceramide np';
  -- пунктуация/слеши → границы токенов
  ASSERT dm.norm_ingredient_alias('Vitamin-C')        = 'vitamin c';
  ASSERT dm.norm_ingredient_alias('Parfum/Fragrance') = 'parfum fragrance';
  -- ё → е, регистр, html
  ASSERT dm.norm_ingredient_alias('Пантёнол')         = 'пантенол';
  ASSERT dm.norm_ingredient_alias('<b>Glycerin</b>')  = 'glycerin';
  RAISE NOTICE 'dm.norm_ingredient_alias smoke: OK';
END
$smoke$;
