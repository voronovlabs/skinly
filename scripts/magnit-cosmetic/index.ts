/**
 * Магнит Косметик → Prisma Product. CLI: пять независимых этапов.
 *
 * Транспорт этапа 1: Playwright + установленный Google Chrome (сайт за
 * QRATOR, HTTP-клиент блокируется). Остальные этапы офлайновые (кроме
 * images/barcodes — обычный fetch к CDN/barcode-list.ru), работают потоково
 * и не держат каталог в памяти.
 *
 *   ЭТАП 1  scrape        sitemap → карточки → data/raw/magnit-cosmetic-products.jsonl
 *           retry-failed  повтор неудачных карточек из failed-products.jsonl
 *   ЭТАП 2  normalize     raw JSONL → normalized-products.jsonl (без БД)
 *   ЭТАП 3  images        скачивание изображений → storage/product-images,
 *                         imageUrl → внутренний URL (sourceImageUrl — оригинал)
 *   ЭТАП 4  barcodes      поиск настоящих EAN на barcode-list.ru → matches JSONL
 *   ЭТАП 5  import        normalized JSONL (+EAN) → upsertProduct() → Postgres
 *
 * Resume этапа 1 — из самого JSONL (запись есть → карточку не качаем),
 * state.json упразднён. Ошибки не тормозят проход: failed-products.jsonl +
 * отдельная команда retry-failed.
 *
 * Примеры:
 *   npm run magnit:scrape -- --experimental --limit 5            # проба
 *   npm run magnit:scrape -- --experimental --all                # весь каталог
 *   npm run magnit:retry-failed -- --experimental
 *   npm run magnit:normalize
 *   npm run magnit:images
 *   npm run magnit:barcodes -- --limit 200
 *   npm run magnit:import -- --dry-run
 *   npm run magnit:import
 */

import { parseArgs } from "node:util";
import { log, setDebug } from "./logger";
import { runScrape, runRetryFailed } from "./stage-scrape";
import { runNormalize } from "./stage-normalize";
import { runImages } from "./stage-images";
import { runBarcodes } from "./stage-barcodes";
import { runImport } from "./stage-import";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string", default: "0" },
    offset: { type: "string", default: "0" },
    "category-url": { type: "string" },
    "product-url": { type: "string" },
    all: { type: "boolean", default: false },
    "sample-categories": { type: "boolean", default: false },
    "save-json": { type: "boolean", default: false },
    /** Скачивать заново, даже если карточка уже есть в JSONL (этап 1). */
    refetch: { type: "boolean", default: false },
    headful: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    /** images: база публичного URL ("" → относительный /product-images/...). */
    "public-base-url": { type: "string" },
    /** barcodes: повторить товары со status=error. */
    "retry-errors": { type: "boolean", default: false },
    /** import */
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    /** Осознанный запуск браузерного скрейпа (этапы 1 / retry-failed). */
    experimental: { type: "boolean", default: false },
  },
});

const LIMIT = parseInt(args.limit ?? "0", 10) || 0;
const OFFSET = parseInt(args.offset ?? "0", 10) || 0;
setDebug(args.debug ?? false);

function usage(): void {
  log("Магнит Косметик — пайплайн из 5 независимых этапов:");
  log("  scrape        этап 1: карточки → data/raw/magnit-cosmetic-products.jsonl");
  log("  retry-failed  этап 1: повтор неудачных из failed-products.jsonl");
  log("  normalize     этап 2: raw JSONL → normalized-products.jsonl");
  log("  images        этап 3: изображения → storage/product-images (+замена imageUrl)");
  log("  barcodes      этап 4: поиск EAN на barcode-list.ru → matches JSONL");
  log("  import        этап 5: normalized JSONL → Postgres (upsertProduct)");
  log("");
  log("Флаги: --limit N --offset N --all --sample-categories --category-url URL");
  log("  --product-url URL --refetch --save-json --headful --debug --verbose");
  log("  --public-base-url URL --retry-errors --dry-run --force --experimental");
  log("");
  log("Проба: npm run magnit:scrape -- --experimental --limit 5");
}

/** Браузерные команды закрыты флагом --experimental (защита от случайного массового прогона). */
function requireExperimental(cmd: string): boolean {
  if (args.experimental) return true;
  log(`Команда «${cmd}» использует браузерный транспорт (Playwright/Chrome) и закрыта флагом --experimental.`);
  log(`Пример: npm run magnit:${cmd} -- --experimental --limit 5`);
  process.exitCode = 1;
  return false;
}

async function main(): Promise<void> {
  const cmd = positionals[0];

  switch (cmd) {
    case "scrape":
      if (!requireExperimental("scrape")) return;
      await runScrape({
        limit: LIMIT,
        offset: OFFSET,
        categoryUrl: args["category-url"],
        productUrl: args["product-url"],
        all: args.all ?? false,
        sampleCategories: args["sample-categories"] ?? false,
        saveJson: args["save-json"] ?? false,
        headful: args.headful ?? false,
        debug: args.debug ?? false,
        refetch: args.refetch ?? false,
      });
      return;

    case "retry-failed":
      if (!requireExperimental("retry-failed")) return;
      await runRetryFailed({
        limit: LIMIT,
        headful: args.headful ?? false,
        debug: args.debug ?? false,
      });
      return;

    case "normalize":
      await runNormalize({ limit: LIMIT, verbose: args.verbose ?? false });
      return;

    case "images":
      await runImages({
        limit: LIMIT,
        publicBaseUrl:
          args["public-base-url"] ?? process.env.SKINLY_PUBLIC_BASE_URL ?? "",
        dryRun: args["dry-run"] ?? false,
      });
      return;

    case "barcodes":
      await runBarcodes({
        limit: LIMIT,
        dryRun: args["dry-run"] ?? false,
        retryErrors: args["retry-errors"] ?? false,
      });
      return;

    case "import":
      await runImport({
        limit: LIMIT,
        dryRun: args["dry-run"] ?? false,
        force: args.force ?? false,
      });
      return;

    default:
      usage();
      process.exitCode = cmd ? 1 : 0;
      if (cmd) log(`\nНеизвестная команда: ${cmd}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
