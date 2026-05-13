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
  // ── Phase 13 (scraper sweep): top-level cosmetic categories националкаталог.рф
  "/sredstva-kosmeticheskie-antisepticheskie/",
  "/dezodoranty-antiperspiranty/",
  "/sredstva-i-aksessuary-dlya-manikyura-i-pedikyura-dusha-bani-i-sauny/",
  "/kosmetika-dlya-volos/",
  "/mylo-i-sredstva-dlya-mytya/",
  "/sredstva-dlya-gigieny-polosti-rta/",
  "/sredstva-i-instrumenty-dlya-britya-i-depilyacii/",
  "/dekorativnaya-i-uhodovaya-kosmetika2/",
  "/kosmeticheskie-aksessuary/",
  "/kosmeticheskie-i-tualetnye-sredstva/",
  "/odnorazovye-sredstva-lichnoy-gigieny/",
  "/apparatnaya-kosmetologiya-i-massazh/",
];

export function matchesCosmeticPrefix(path: string): boolean {
  return COSMETIC_CATEGORY_PREFIXES.some((p) => path.startsWith(p));
}

/* ───────── Start-path helpers (Phase 13 multi-category scraping) ───────── */

/**
 * Нормализовать --start-path:
 *   - должен начинаться с `/`
 *   - в конце дописываем `/`, если нет
 *   - срезаем `?...` и `#...`
 *
 * Бросает Error с понятным сообщением, если путь невалиден.
 */
export function normalizeStartPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("--start-path must be a non-empty string");
  }
  if (!input.startsWith("/")) {
    throw new Error(`--start-path must start with "/", got "${input}"`);
  }
  // Срезаем query/fragment — они бессмысленны для BFS-стартовой точки.
  const cleanPath = input.split("?")[0].split("#")[0];
  if (!cleanPath || cleanPath === "/") {
    throw new Error(`--start-path must not be empty / "/"`);
  }
  return cleanPath.endsWith("/") ? cleanPath : cleanPath + "/";
}

/**
 * Извлечь path из --start-url. Хост обязан совпадать с BASE_URL — иначе ошибка
 * (это защита от случайного запуска по чужому домену).
 */
export function pathFromUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`--start-url is not a valid URL: ${input}`);
  }
  const baseHost = new URL(BASE_URL).host;
  if (parsed.host !== baseHost) {
    throw new Error(
      `--start-url host "${parsed.host}" does not match BASE_URL host "${baseHost}"`,
    );
  }
  return normalizeStartPath(parsed.pathname);
}

/**
 * Slug-имя для checkpoint-файла. `/parfyumeriya/` → `parfyumeriya`,
 * `/sredstva/podkat/` → `sredstva-podkat`.
 *
 * Только `[a-z0-9-]` — остальное вырезается; коллизии маловероятны
 * (источник — slug'и национального каталога).
 */
export function slugifyStartPath(p: string): string {
  const trimmed = p.replace(/^\/+|\/+$/g, "").replace(/\//g, "-").toLowerCase();
  return trimmed.replace(/[^a-z0-9-]+/g, "") || "root";
}

/**
 * Полный путь до checkpoint-файла:
 *   - `slug = null` → старое поведение (общий checkpoint, как до Phase 13).
 *   - `slug = "parfyumeriya"` →
 *     `data/state/national-catalog-checkpoint-parfyumeriya.json`
 */
export function checkpointFilePath(slug: string | null): string {
  if (!slug) return PATHS.checkpoint;
  return `data/state/national-catalog-checkpoint-${slug}.json`;
}

/**
 * Phase 13.1: путь до JSONL append-only лога продуктов.
 *   - `slug = null` → старый общий файл `data/raw/national-catalog-products.jsonl`
 *     (backward-compat для запусков без --start-path и для legacy дампов).
 *   - `slug = "parfyumeriya"` →
 *     `data/raw/national-catalog-products-parfyumeriya.jsonl`
 *
 * Per-category файл устраняет write-race condition при параллельных запусках:
 * каждый процесс пишет в свой файл; нет interleaved строк.
 *
 * Cross-category дедупликация всё ещё происходит на уровне Postgres
 * (raw upsert по sourceUrl) — JSONL остаётся per-category audit log'ом.
 */
export function jsonlFilePath(slug: string | null): string {
  if (!slug) return PATHS.rawProductsJsonl;
  return `data/raw/national-catalog-products-${slug}.jsonl`;
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
  /** Каталог lock-файлов для active-scrapers (Phase 13.1). */
  activeScrapersDir: "data/state/active-scrapers",
} as const;

/**
 * Phase 13.1: рекомендуемый предел параллельных scraper-процессов на
 * один хост. На сайт мы стучим один общий «фронт» — при сильно
 * больших значениях национальный каталог отдаёт 429 / медленнее.
 *
 * При превышении мы не падаем — только пишем warning. Сам throttling
 * (per-process MIN_INTERVAL_BETWEEN_REQUESTS_MS) и так есть.
 */
export const MAX_RECOMMENDED_PARALLEL_PROCESSES = 3;

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
