/**
 * Skinly · staging scraper · inn-skin.ru
 *
 * Конфигурация скрейпера нового источника. Архитектурно повторяет
 * national-catalog, но это отдельный модуль и отдельный staging-слой
 * (схема `scrape`), чтобы не цеплять существующий каталог.
 */

import * as path from "node:path";

export const BASE_URL = "https://inn-skin.ru";
export const CATALOG_PATH = "/app/cosmetics";

/**
 * Бренды для скрейпа. Значения должны ТОЧНО совпадать со строкой фильтра
 * `?brand=` на inn-skin.ru (регистр и спецсимволы важны). Uriage проверен
 * вручную; остальные slug'и стоит верифицировать быстрым прогоном
 * (`--brand "..." --max-pages 1`) — если выдаёт 0 карточек, строка не та.
 */
export const TARGET_BRANDS: string[] = [
  "CeraVe",
  "Avène",
  "Uriage",
  "Ducray",
  "A-Derma",
  "COSRX",
  "Skin1004",
  "Holika Holika",
  "Missha",
  "Dr.Jart+",
  "Some By Mi",
  "Hada Labo",
  "KIKO Milano",
  "Catrice",
];

/**
 * Бренд-запросы для barcode-list.ru EAN-обогащения (этап 2, отдельно от
 * inn-skin скрейпа). Строки — ТОЧНО как ищем на barcode-list.ru; они
 * отличаются от inn-skin TARGET_BRANDS (например «EAU THERMALE AVENE»).
 */
export const BARCODE_LIST_BRANDS: string[] = [
  "EAU THERMALE AVENE",
  "Uriage",
  "Ducray",
  "A-Derma",
  "COSRX",
  "Holika Holika",
  "Missha",
  "Dr.Jart+",
  "SOME BY MI",
  "HADA LABO",
  "KIKO MILANO",
  "Catrice",
  "Sesderma",
];

/** Браузероподобные заголовки — вежливый скрейп SSR-страниц. */
export const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 SkinlyBot/1.0 " +
    "(+https://skinly.msvoronov.com; staging catalog enrichment)",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

/* ── Rate-limit / retries (вежливее национального каталога) ── */
export const MIN_INTERVAL_BETWEEN_REQUESTS_MS = 800;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_RETRIES = 4;
export const BASE_BACKOFF_MS = 1_000;

/* ── Пути файлов (JSONL ground-truth + SQL-схема staging) ── */
export const PATHS = {
  rawProductsJsonl: path.resolve("data/raw/inn-skin-products.jsonl"),
  schemaSql: path.resolve("sql/scrape/00_inn_skin_schema.sql"),
  debugDir: path.resolve("data/debug"),
};

/** URL листинга бренда с пагинацией. */
export function catalogUrl(brand: string, page: number): string {
  const sp = new URLSearchParams({ brand, page: String(page) });
  return `${BASE_URL}${CATALOG_PATH}?${sp.toString()}`;
}

/** URL детальной страницы по UUID. */
export function productUrl(sourceProductId: string): string {
  return `${BASE_URL}${CATALOG_PATH}/${sourceProductId}`;
}
