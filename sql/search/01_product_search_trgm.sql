-- =============================================================================
-- Skinly · ускорение поиска /api/v1/products (pg_trgm)
--
-- Контекст: БД — postgres:16-alpine (musl, локаль C). Кириллический
-- case-insensitive поиск реализован в lib/db/repositories/product.ts как
--   lower(translate(col, 'АБВ…Я', 'абв…я')) LIKE '%token%'
-- Без индекса это seq scan → q=шампунь ~3.2s.
--
-- Эти GIN/pg_trgm индексы ускоряют LIKE '%…%'. ВЫРАЖЕНИЕ ИНДЕКСА ДОЛЖНО
-- ПОБАЙТОВО СОВПАДАТЬ с выражением в WHERE (те же константы-литералы, тот же
-- порядок) — иначе планировщик индекс не возьмёт.
--
-- ⚠️ CREATE INDEX CONCURRENTLY НЕЛЬЗЯ запускать в транзакции. Поэтому это
-- РУЧНОЙ SQL-файл, а не Prisma migration (которая оборачивает всё в BEGIN/COMMIT).
-- Запускать через psql напрямую (см. команды внизу). IF NOT EXISTS делает файл
-- идемпотентным; при сбое CONCURRENTLY может остаться INVALID-индекс — тогда
-- DROP INDEX и повторить.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) folded name
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_name_folded_trgm
  ON "Product"
  USING gin ((lower(translate("name", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))) gin_trgm_ops);

-- 2) folded brand
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_brand_folded_trgm
  ON "Product"
  USING gin ((lower(translate("brand", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))) gin_trgm_ops);

-- 3) folded category (cast enum → text, как в WHERE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_category_folded_trgm
  ON "Product"
  USING gin ((lower(translate("category"::text, 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))) gin_trgm_ops);

-- 4) barcode (под отдельную ветку "barcode" LIKE '%q%')
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_barcode_trgm
  ON "Product"
  USING gin ("barcode" gin_trgm_ops);

-- Обновить статистику планировщика после создания индексов.
ANALYZE "Product";

-- =============================================================================
-- Запуск на сервере (psql напрямую, БЕЗ транзакции):
--
--   docker compose exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < sql/search/01_product_search_trgm.sql
--
--   # или скопировать файл в контейнер и применить:
--   docker compose cp sql/search/01_product_search_trgm.sql postgres:/tmp/idx.sql
--   docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/idx.sql
--
--   # tools-сервис тоже подойдёт:
--   docker compose --profile tools run --rm tools \
--     psql "$DATABASE_URL" -f sql/search/01_product_search_trgm.sql
--
-- Проверить, что индексы валидны:
--   SELECT indexrelid::regclass, indisvalid
--   FROM pg_index WHERE indexrelid::regclass::text LIKE 'product_%trgm';
-- =============================================================================

-- =============================================================================
-- EXPLAIN ANALYZE — до/после (выражение ДОЛЖНО совпадать с кодом продукта):
--
--   EXPLAIN ANALYZE
--   SELECT "id","barcode","brand","name","category"::text,"emoji","imageUrl"
--   FROM "Product"
--   WHERE (
--       lower(translate("brand",    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя')) LIKE '%шампунь%'
--    OR lower(translate("name",     'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя')) LIKE '%шампунь%'
--    OR lower(translate("category"::text,'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя')) LIKE '%шампунь%'
--   ) OR "barcode" LIKE '%шампунь%'
--   ORDER BY "createdAt" DESC, "id" DESC
--   LIMIT 21;
--
-- ДО:    Seq Scan on "Product" … Execution Time: ~3000+ ms
-- ПОСЛЕ: Bitmap Heap Scan / BitmapOr поверх product_*_trgm … ~10–50 ms
-- =============================================================================
