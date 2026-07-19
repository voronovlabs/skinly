/**
 * Магнит Косметик (cosmetic.magnit.ru) — конфигурация скрейпера.
 *
 * Источник данных: Nuxt 3 SSR-сайт. Полный каталог доступен через
 * sitemap (`/__sitemap__/products.xml`), карточки — обычные SSR-страницы
 * с описанием, составом и характеристиками. Внутренний JSON API
 * (web-gateway.middle-api.magnit.ru) существует, но требует POST со
 * спец-заголовками — используется опционально (`--use-api`) с fallback.
 */

import * as path from "node:path";

export const SOURCE = "magnit_cosmetic";

export const BASE_URL = "https://cosmetic.magnit.ru";
export const SITEMAP_PRODUCTS_URL = `${BASE_URL}/__sitemap__/products.xml`;
export const SITEMAP_CATALOG_URL = `${BASE_URL}/__sitemap__/catalog.xml`;

/**
 * Экспериментальный внутренний API (документирован сообществом для magnit.ru).
 * shopType для М.Косметик — "6" (у "Магнит у дома" — "1").
 */
export const WEB_GATEWAY_URL = "https://web-gateway.middle-api.magnit.ru";

/**
 * Магазин по умолчанию. Сайт без cookies подставляет магазин
 * shopCode=942311 (Краснодар, ул. им. Максима Горького 112) — его же
 * используем как канонический регион. Влияет только на цены/наличие,
 * карточки товаров (название/состав/описание) от региона не зависят.
 * Переопределяется флагом `--shop-code`.
 */
export const DEFAULT_SHOP_CODE = "942311";
export const DEFAULT_SHOP_TYPE = "cosmetic";

/** Плейсхолдер-barcode: `mc:<externalId>`. Настоящие EAN появятся на этапе 2. */
export const BARCODE_PREFIX = "mc:";

/* ───────── Browser (Playwright, основной транспорт карточек) ───────── */

/** Навигация page.goto (domcontentloaded). */
export const NAV_TIMEOUT_MS = 30_000;
/** Ожидание ключевого элемента страницы после goto. */
export const SELECTOR_TIMEOUT_MS = 15_000;
/** Ожидание модалок (магазин / cookies) при прогреве сессии. */
export const OVERLAY_TIMEOUT_MS = 4_000;
/** Минимальный интервал между карточками (тот же ≈1 req/s). */
export const CARD_MIN_INTERVAL_MS = 1_000;
export const CARD_JITTER_MS = 500;

/* ───────── HTTP (только экспериментальный api.ts; карточки — браузер) ───────── */

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_RETRIES = 4;
export const BASE_BACKOFF_MS = 1_500;
/** Глобальный rate-limit между запросами (на все воркеры суммарно). */
export const MIN_INTERVAL_BETWEEN_REQUESTS_MS = 400;
/** Небольшой случайный джиттер поверх rate-limit. */
export const JITTER_MS = 150;
export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 8;

export const REQUEST_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
};

/* ───────── Images (этап 3) ───────── */

/**
 * Локальное хранилище изображений — тот же формат, что у
 * scripts/migrate-product-images.ts: <dir>/ab/cd/<sha256(url)>.<ext>,
 * публичный URL <base>/product-images/ab/cd/<hash>.<ext>.
 */
export const IMAGE_URL_PREFIX = "/product-images";
export const IMAGE_MIN_BYTES = 100;
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_FETCH_TIMEOUT_MS = 15_000;
export const IMAGE_RETRIES = 2;
/** Темп скачивания изображений (CDN, не за QRATOR — но не наглеем). */
export const IMAGE_MIN_INTERVAL_MS = 150;

/* ───────── Paths ───────── */

const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT, "data", "magnit-cosmetic");

export const PATHS = {
  dataDir: DATA_DIR,
  /**
   * Append-only ground truth (git-ignored, как data/raw/* других источников).
   * Единственный источник истины о скачанных карточках: resume читает его,
   * state.json больше не используется.
   */
  rawJsonl: path.join(ROOT, "data", "raw", "magnit-cosmetic-products.jsonl"),
  /** Неудачные карточки этапа 1 (append; retry-failed переписывает атомарно). */
  failedJsonl: path.join(DATA_DIR, "failed-products.jsonl"),
  /** Результат этапа 2 (переписывается атомарно при каждом запуске). */
  normalizedJsonl: path.join(DATA_DIR, "normalized-products.jsonl"),
  /** Пропущенные нормализацией (не-косметика, мусор) — для аудита. */
  skippedJsonl: path.join(DATA_DIR, "skipped-products.jsonl"),
  /** Ошибки скачивания изображений (этап 3). */
  imagesFailedJsonl: path.join(DATA_DIR, "failed-images.jsonl"),
  /** Кандидаты EAN с barcode-list.ru (этап 4, append-only + resume). */
  barcodeMatchesJsonl: path.join(ROOT, "data", "raw", "magnit-cosmetic-barcode-matches.jsonl"),
  /** Локальное хранилище изображений (общее с migrate-product-images). */
  imagesDir: process.env.SKINLY_STORAGE_DIR ?? path.join(ROOT, "storage", "product-images"),
  categoriesJson: path.join(DATA_DIR, "categories.json"),
  catalogProductsJson: path.join(DATA_DIR, "catalog-products.json"),
  summaryJson: path.join(DATA_DIR, "summary.json"),
  debugDir: path.join(DATA_DIR, "debug"),
  /** persistent-профиль Chrome (общий со smoke-скриптом) */
  chromeProfile: path.join(DATA_DIR, "chrome-profile"),
};
