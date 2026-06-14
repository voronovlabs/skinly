/**
 * Skinly · staging scraper · FARERA (fareraparfum.ru)
 *
 * Конфиг ТОЛЬКО для источника `farera`. Полностью отделён от Национального
 * каталога: свои BASE_URL и свои файлы (`farera-*`). Тайминги/ретраи/заголовки
 * переиспользуются из общего fetcher'а (он импортит REQUEST_HEADERS и лимиты
 * из national-catalog/config) — farera не дублирует политику вежливости.
 *
 * Discovery — через XML-sitemap (`/sitemap.xml` → `products*.xml`), без BFS по
 * 126 брендам: один индекс даёт полный охват каталога.
 */

export const SOURCE = "farera" as const;

export const BASE_URL = "https://fareraparfum.ru";

/** Индекс карты сайта CS-Cart. Из него берём все `products\d+.xml`. */
export const SITEMAP_INDEX_URL = `${BASE_URL}/sitemap.xml`;

/**
 * Файлы хранения. Жёстко заданы пользователем и НЕ пересекаются с
 * `national-catalog-*`. На этапе 1 пишем только JSONL (без Postgres).
 */
export const PATHS = {
  rawProductsJsonl: "data/raw/farera-products.jsonl",
  checkpoint: "data/state/farera-checkpoint.json",
} as const;

/** Slug для lock-файла active-scrapers (`data/state/active-scrapers/farera.lock`). */
export const LOCK_SLUG = "farera";

/** Дефолтный лимит товаров за прогон (CLI `--limit` переопределяет). */
export const DEFAULT_LIMIT = 1000;

function abs(input: string): string {
  if (input.startsWith("http")) return input;
  return `${BASE_URL}${input.startsWith("/") ? "" : "/"}${input}`;
}

export { abs };
