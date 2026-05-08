/**
 * Skinly · staging scraper · National Catalog of Goods (RF)
 *
 * Запуск:
 *   npm run scrape:national-catalog -- --limit 20
 *   npm run scrape:national-catalog -- --limit 200 --resume
 *
 * Что делает:
 *   1. discovery: BFS по /kosmetika-i-parfyumeriya/ → набор product-URL'ов
 *   2. detail:    скачивает каждую product-страницу, парсит, пишет JSONL
 *   3. checkpoint: сохраняет прогресс на диск; --resume продолжает с него
 *
 * НЕ:
 *   - не пишет в Postgres / Prisma
 *   - не нормализует ингредиенты
 *   - не enrichит AI
 *
 * Это namely staging RAW-слой. Импорт в БД — отдельной фазой.
 */

import { parseArgs } from "node:util";
import { BASE_URL } from "./national-catalog/config";
import { discoverProducts } from "./national-catalog/discovery";
import { fetchHtml } from "./national-catalog/fetcher";
import { parseProductPage } from "./national-catalog/parser";
import {
  appendProduct,
  ensureDirs,
  loadCheckpoint,
  loadExistingKeys,
  saveCheckpoint,
} from "./national-catalog/storage";
import type { ScrapeStats } from "./national-catalog/types";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

interface CliArgs {
  limit: number;
  resume: boolean;
  rediscover: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "20" },
      resume: { type: "boolean", default: false },
      rediscover: { type: "boolean", default: false },
    },
  });
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return {
    limit,
    resume: Boolean(values.resume),
    rediscover: Boolean(values.rediscover),
  };
}

function abs(p: string): string {
  return `${BASE_URL}${p}`;
}

async function main(): Promise<void> {
  const args = parseCli();
  log(
    `Starting · limit=${args.limit} resume=${args.resume} rediscover=${args.rediscover}`,
  );

  await ensureDirs();
  const checkpoint = await loadCheckpoint();
  const existing = await loadExistingKeys();

  log(
    `Existing JSONL: ${existing.urls.size} url, ${existing.barcodes.size} barcode`,
  );
  log(
    `Checkpoint: ${checkpoint.processedUrls.length} processed, ${checkpoint.failed.length} failed`,
  );

  // ── Discovery ─────────────────────────────────────────────
  const needsDiscovery =
    args.rediscover ||
    checkpoint.discoveredUrls.length === 0 ||
    !args.resume;

  if (needsDiscovery) {
    log("Discovery phase…");
    // Берём чуть больше limit'а, чтобы остался запас на dedup и фейлы.
    const target = Math.max(args.limit * 2, 30);
    const { urls, stats } = await discoverProducts({
      limit: target,
      log,
    });
    log(
      `Discovery done · pages=${stats.pagesVisited}, categories=${stats.categoriesFound}, products=${stats.productsFound}`,
    );
    checkpoint.discoveredUrls = urls;
    await saveCheckpoint(checkpoint);
  } else {
    log(
      `Skipping discovery (resume): ${checkpoint.discoveredUrls.length} URLs from previous run`,
    );
  }

  const remaining = checkpoint.discoveredUrls.filter(
    (u) => !checkpoint.processedUrls.includes(u),
  );
  log(`Remaining to process: ${remaining.length}`);

  // ── Detail phase ──────────────────────────────────────────
  const stats: ScrapeStats = {
    productsScraped: 0,
    productsWithoutBarcode: 0,
    productsWithoutImage: 0,
    productsWithoutAttributes: 0,
    duplicatesSkipped: 0,
    failures: 0,
  };

  let scrapedThisRun = 0;
  for (const path of remaining) {
    if (scrapedThisRun >= args.limit) break;

    // Дедуп по sourceUrl
    if (existing.urls.has(path)) {
      stats.duplicatesSkipped++;
      checkpoint.processedUrls.push(path);
      log(`SKIP duplicate-url ${path}`);
      continue;
    }

    const url = abs(path);
    log(
      `[${scrapedThisRun + 1}/${args.limit}] fetch ${path}`,
    );

    try {
      const html = await fetchHtml(url, log);
      const product = parseProductPage(html, url);

      // Дедуп по barcode (после парсинга — раньше нельзя)
      if (product.barcode && existing.barcodes.has(product.barcode)) {
        stats.duplicatesSkipped++;
        checkpoint.processedUrls.push(path);
        log(`SKIP duplicate-barcode ${product.barcode} (${path})`);
        continue;
      }

      if (!product.barcode) stats.productsWithoutBarcode++;
      if (!product.imageUrl) stats.productsWithoutImage++;
      if (Object.keys(product.flatAttributes).length === 0) {
        stats.productsWithoutAttributes++;
      }

      await appendProduct(product);
      stats.productsScraped++;
      scrapedThisRun++;

      existing.urls.add(path);
      if (product.barcode) existing.barcodes.add(product.barcode);
      checkpoint.processedUrls.push(path);

      log(
        `OK ${path} · barcode=${product.barcode ?? "—"} brand=${product.brand ?? "—"} attrs=${Object.keys(product.flatAttributes).length}`,
      );

      // Checkpoint каждые 5 успешных карточек
      if (stats.productsScraped % 5 === 0) {
        await saveCheckpoint(checkpoint);
        log(`Checkpoint saved (${stats.productsScraped})`);
      }
    } catch (e) {
      stats.failures++;
      const reason = e instanceof Error ? e.message : String(e);
      checkpoint.failed.push({ url: path, reason, at: new Date().toISOString() });
      log(`FAIL ${path}: ${reason}`);
    }
  }

  await saveCheckpoint(checkpoint);

  // ── Final report ──────────────────────────────────────────
  log("──────────────────────────────────────────────");
  log("DONE");
  log(`  scraped:                ${stats.productsScraped}`);
  log(`  duplicates skipped:     ${stats.duplicatesSkipped}`);
  log(`  without barcode:        ${stats.productsWithoutBarcode}`);
  log(`  without image:          ${stats.productsWithoutImage}`);
  log(`  without attributes:     ${stats.productsWithoutAttributes}`);
  log(`  failures (this run):    ${stats.failures}`);
  log(`  total processed:        ${checkpoint.processedUrls.length}`);
  log(`  total failed (cumul.):  ${checkpoint.failed.length}`);
  log("──────────────────────────────────────────────");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
