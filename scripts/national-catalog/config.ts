/**
 * Конфигурация скрейпера.
 * Все «магические числа» здесь — чтобы крутить в одном месте без редактирования логики.
 */

export const BASE_URL = "https://xn----7sbabas4ajkhfocclk9d3cvfsa.xn--p1ai";

/**
 * Стартовая страница BFS-обхода — корневая категория «Косметика и парфюмерия».
 */
export const ROOT_CATEGORY_PATH = "/kosmetika-i-parfyumeriya/";

/**
 * Allowlist путей, которые мы считаем «косметическими» категориями.
 *
 * На националкаталог.рф подкатегории физически живут как top-level URL'ы
 * (`/parfyumeriya/`, `/kosmetika/` и т.п.), а НЕ под root-prefix'ом.
 * Поэтому BFS должен ходить по этому списку, а не по startsWith(ROOT).
 *
 * Список можно расширять по результатам `--debug`-дампа `data/debug/root-links.txt`:
 * там видны все ссылки сайта со страницы корневой категории.
 */
export const COSMETIC_CATEGORY_PREFIXES: ReadonlyArray<string> = [
  ROOT_CATEGORY_PATH,
  "/parfyumeriya/",
  "/kosmetika/",
  "/dekorativnaya-kosmetika/",
  "/uhod-za-kozhey/",
  "/uhod-za-litsom/",
  "/uhod-za-volosami/",
  "/uhod-za-telom/",
  "/uhod-za-rukami/",
  "/uhod-za-nogtyami/",
  "/sredstva-dlya-litsa/",
  "/sredstva-dlya-tela/",
  "/sredstva-dlya-volos/",
  "/sredstva-gigieny/",
  "/dezodoranty/",
  "/duhi/",
  "/parfyumernaya-voda/",
  "/tualetnaya-voda/",
  "/krem/",
  "/krem-dlya-litsa/",
  "/krem-dlya-ruk/",
  "/krem-dlya-tela/",
  "/syvorotka/",
  "/maska-dlya-litsa/",
  "/maska-dlya-volos/",
  "/shampun/",
  "/balzam-dlya-volos/",
  "/krasitel-dlya-volos/",
  "/lak-dlya-volos/",
  "/myla/",
  "/gel-dlya-dusha/",
  "/zubnaya-pasta/",
  "/zubnaya-shchetka/",
  "/oposlaktazh/",
  "/skrab/",
  "/tonik/",
  "/molochko-kosmeticheskoe/",
  "/maslo-kosmeticheskoe/",
];

export function matchesCosmeticPrefix(path: string): boolean {
  return COSMETIC_CATEGORY_PREFIXES.some((p) => path.startsWith(p));
}

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
export const MIN_INTERVAL_BETWEEN_REQUESTS_MS = 750;
export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 1_000;

/** Лимиты обхода. */
export const MAX_CATEGORY_PAGES_VISITED = 200;

/** Файлы. */
export const PATHS = {
  rawProductsJsonl: "data/raw/national-catalog-products.jsonl",
  checkpoint: "data/state/national-catalog-checkpoint.json",
} as const;

/**
 * Известные секции «паспорта» товара на detail-странице.
 */
export const KNOWN_SECTIONS: ReadonlyArray<string> = [
  "Нормативно-сопроводительная документация",
  "Идентификация товара",
  "Тип и материал упаковки",
  "Потребительские свойства",
  "Идентификация участников оборота товаров",
];
