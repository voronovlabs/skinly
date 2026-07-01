-- Skinly · staging layer · ручные INCI из курируемых Excel-файлов
--
-- Staging для scripts/import-manual-ingredients.ts: один ряд = одна строка
-- Excel с непустым ingredients_raw (A-Derma / CeraVe / Dr.Jart+ / ...).
-- Живёт в схеме `scrape` (как inn_skin_*), вне Prisma-моделей.
--
-- Поток данных:
--   data/manual/<Brand>.xlsx
--     → scrape.manual_product_ingredients            (staging, upsert)
--     → public."Ingredient" / public."ProductIngredient"  (только в --apply)
--
-- public."Product" НИКОГДА не изменяется и не создаётся.
--
-- Ключ идемпотентности staging: (file_name, barcode) — повторный прогон
-- того же файла обновляет строки, а не плодит дубли.
--
-- Идемпотентно: IF NOT EXISTS, повторный запуск безопасен.
-- Применение: автоматически из скрипта (ensureSchema) или вручную:
--   psql "$DATABASE_URL" -f sql/scrape/01_manual_product_ingredients.sql

CREATE SCHEMA IF NOT EXISTS scrape;

CREATE TABLE IF NOT EXISTS scrape.manual_product_ingredients (
  id                      text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- резолвнутый public."Product".id; NULL = товар не найден в каталоге
  product_id              text,
  barcode                 text        NOT NULL,
  brand                   text,
  name                    text,
  -- полный INCI как в файле (verbatim, один источник)
  ingredients_raw         text        NOT NULL,
  -- dm.norm_ingredients(ingredients_raw) на момент импорта
  ingredients_normalized  text[]      NOT NULL DEFAULT '{}',
  source_name             text,
  source_url              text,
  -- official | high | medium | low | not_found
  confidence              text,
  -- basename исходного Excel, например 'ADerma.xlsx'
  file_name               text        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_product_ingredients_file_barcode_uq UNIQUE (file_name, barcode)
);

CREATE INDEX IF NOT EXISTS idx_manual_product_ingredients_barcode
  ON scrape.manual_product_ingredients (barcode);

CREATE INDEX IF NOT EXISTS idx_manual_product_ingredients_product
  ON scrape.manual_product_ingredients (product_id);

CREATE INDEX IF NOT EXISTS idx_manual_product_ingredients_brand
  ON scrape.manual_product_ingredients (brand);
