/**
 * Конфигурация скрейпера.
 * Все «магические числа» здесь — чтобы крутить в одном месте без редактирования логики.
 */

export const BASE_URL = "https://xn----7sbabas4ajkhfocclk9d3cvfsa.xn--p1ai";
export const ROOT_CATEGORY_PATH = "/kosmetika-i-parfyumeriya/";

/** Заголовки запросов. User-Agent подписан, чтобы быть честным. */
export const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; SkinlyStagingScraper/0.1; +https://skinly.msvoronov.com)",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
};

/** Тайминги — в миллисекундах. */
export const FETCH_TIMEOUT_MS = 30_000;
export const MIN_INTERVAL_BETWEEN_REQUESTS_MS = 750; // ≈ 1.3 RPS, в рамках вежливости
export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 1_000;

/** Лимиты обхода. Защищают от бесконечного BFS на самописных категориях. */
export const MAX_CATEGORY_PAGES_VISITED = 200;

/** Файлы. */
export const PATHS = {
  rawProductsJsonl: "data/raw/national-catalog-products.jsonl",
  checkpoint: "data/state/national-catalog-checkpoint.json",
} as const;

/**
 * Известные секции «паспорта» товара на detail-странице.
 * Используются для фильтрации заголовков, на которые навешивать парсинг
 * key-value пар — чтобы не наловить случайные `<h2>` из футера или меню.
 */
export const KNOWN_SECTIONS: ReadonlyArray<string> = [
  "Нормативно-сопроводительная документация",
  "Идентификация товара",
  "Тип и материал упаковки",
  "Потребительские свойства",
  "Идентификация участников оборота товаров",
];
