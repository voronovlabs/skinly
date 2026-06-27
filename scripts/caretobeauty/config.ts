/**
 * Skinly · адаптер источника · Care to Beauty (caretobeauty.com)
 *
 * GTIN/EAN отдаётся прямо в статической `<head>`-мете товара:
 *   <meta property="product:gtin" content="3337875797597">
 *   <meta property="og:brand" content="La Roche-Posay">
 * — значит не нужен ни JS, ни хрупкие CSS-селекторы.
 *
 * Перечисление товаров — через ОФИЦИАЛЬНЫЙ product-sitemap магазина:
 *   https://www.caretobeauty.com/<store>/sitemaps/products_<N>.xml.gz
 * URL товара начинается со slug'а бренда (`/us/la-roche-posay-...`),
 * поэтому отбор по бренду = префиксная фильтрация без скрейпа листингов.
 */

export const BASE_URL = "https://www.caretobeauty.com";
export const DEFAULT_STORE = "us"; // англоязычная витрина

/** Браузерный User-Agent — вежливый скрейп. */
export const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/* Вежливый темп: ~1 запрос в 1.5–2.5 c. */
export const MIN_INTERVAL_MS = 1500;
export const JITTER_MS = 1000;
export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 1200;

/** Сколько product-sitemap'ов перебрать максимум (products_1..N.xml.gz). */
export const MAX_SITEMAP_PARTS = 25;

export function productSitemapUrl(store: string, part: number): string {
  return `${BASE_URL}/${store}/sitemaps/products_${part}.xml.gz`;
}

/**
 * Slug бренда для префиксной фильтрации URL товара.
 * Снимаем диакритику (Avène → avene), нижний регистр, не-alnum → '-'.
 */
export function brandSlug(brand: string): string {
  return brand
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Бренды по умолчанию, если в staging ещё нет inn-skin товаров и не передан
 * --brand. Это те же целевые бренды каталога.
 */
export const DEFAULT_BRANDS: string[] = [
  "Uriage",
  "Avène",
  "Ducray",
  "A-Derma",
  "Bioderma",
  "La Roche-Posay",
  "CeraVe",
  "COSRX",
  "Dr.Jart+",
  "Some By Mi",
  "Skin1004",
  "Hada Labo",
  "KIKO Milano",
  "Sesderma",
  "Holika Holika",
  "Missha",
];
