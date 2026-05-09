/**
 * Skinly · staging scraper · National Catalog of Goods (RF)
 *
 * Запуск:
 *   npm run scrape:national-catalog -- --limit 20
 *   npm run scrape:national-catalog -- --limit 200 --resume
 *
 * Debug-режим (для диагностики discovery):
 *   npm run scrape:national-catalog -- --limit 5 --debug
 *   npm run scrape:national-catalog -- --limit 5 --debug --unsafe-accept-all
 *
 * Что делает:
 *   1. discovery: BFS по /kosmetika-i-parfyumeriya/ → набор product-URL'ов
 *   2. detail:    скачивает каждую product-страницу, парсит, пишет JSONL
 *   3. checkpoint: сохраняет прогресс на диск; --resume продолжает с него
 */

import { parseArgs } from "node:util";
import { BASE_URL } from "./national-catalog/config";
import { discoverProducts } from "./national-catalog/discovery";
import { fetchHtml } from "./national-catalog/fetcher";
import { parseProductPage } from "./national-catalog/parser";
import {
  appendProduct,
  closeDb,
  ensureDirs,
  loadCheckpoint,
  loadExistingKeys,
  saveCheckpoint,
  saveRawProduct,
} from "./national-catalog/storage";
import type { ScrapeStats } from "./national-catalog/types";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

interface CliArgs {
  limit: number;
  resume: boolean;
  rediscover: boolean;
  debug: boolean;
  unsafeAcceptAll: boolean;
  discoveryOnly: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "20" },
      resume: { type: "boolean", default: false },
      rediscover: { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
      "unsafe-accept-all": { type: "boolean", default: false },
      "discovery-only": { type: "boolean", default: false },
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
    debug: Boolean(values.debug),
    unsafeAcceptAll: Boolean(values["unsafe-accept-all"]),
    discoveryOnly: Boolean(values["discovery-only"]),
  };
}

function abs(p: string): string {
  return `${BASE_URL}${p}`;
}

async function main(): Promise<void> {
  const args = parseCli();
  log(
    `Starting · limit=${args.limit} resume=${args.resume} rediscover=${args.rediscover} debug=${args.debug} unsafeAcceptAll=${args.unsafeAcceptAll} discoveryOnly=${args.discoveryOnly}`,
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
    !args.resume ||
    args.debug;

  if (needsDiscovery) {
    log("Discovery phase…");
    const target = Math.max(args.limit * 2, 30);
    const { urls, stats } = await discoverProducts({
      limit: target,
      log,
      debug: args.debug,
      unsafeAcceptAll: args.unsafeAcceptAll,
    });
    log(
      `Discovery done · pages=${stats.pagesVisited}, categories=${stats.categoriesFound}, products=${stats.productsFound}`,
    );
    if (stats.csrAnalysis?.likelyCsr) {
      log(
        `[discovery] ⚠️  CSR detected — рекомендуется переключение fetcher на Playwright`,
      );
      for (const r of stats.csrAnalysis.reasons) log(`           - ${r}`);
    }
    checkpoint.discoveredUrls = urls;
    await saveCheckpoint(checkpoint);
  } else {
    log(
      `Skipping discovery (resume): ${checkpoint.discoveredUrls.length} URLs from previous run`,
    );
  }

  if (args.discoveryOnly) {
    log("--discovery-only mode: останавливаемся после discovery");
    log(
      `Discovered ${checkpoint.discoveredUrls.length} URLs (см. data/state/national-catalog-checkpoint.json)`,
    );
    if (args.debug) {
      log("Debug-артефакты: data/debug/root.html, data/debug/root-links.txt");
    }
    return;
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
    rawUpsertOk: 0,
    rawUpsertFail: 0,
  };

  let scrapedThisRun = 0;
  for (const path of remaining) {
    if (scrapedThisRun >= args.limit) break;

    if (existing.urls.has(path)) {
      stats.duplicatesSkipped++;
      checkpoint.processedUrls.push(path);
      log(`SKIP duplicate-url ${path}`);
      continue;
    }

    const url = abs(path);
    log(`[${scrapedThisRun + 1}/${args.limit}] fetch ${path}`);

    try {
      const html = await fetchHtml(url, log);
      const product = parseProductPage(html, url);

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

      // Параллельно — raw upsert в Postgres. JSONL уже на диске, поэтому
      // фейл БД здесь не должен валить весь scrape.
      try {
        await saveRawProduct(product);
        stats.rawUpsertOk++;
        log(`RAW UPSERT OK barcode=${product.barcode ?? "—"} ${path}`);
      } catch (dbErr) {
        stats.rawUpsertFail++;
        const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
        log(`RAW UPSERT FAIL barcode=${product.barcode ?? "—"} ${path}: ${reason}`);
      }

      existing.urls.add(path);
      if (product.barcode) existing.barcodes.add(product.barcode);
      checkpoint.processedUrls.push(path);

      log(
        `OK ${path} · barcode=${product.barcode ?? "—"} brand=${product.brand ?? "—"} attrs=${Object.keys(product.flatAttributes).length}`,
      );

      if (stats.productsScraped % 5 === 0) {
        await saveCheckpoint(checkpoint);
        log(`Checkpoint saved (${stats.productsScraped})`);
      }
    } catch (e) {
      stats.failures++;
      const reason = e instanceof Error ? e.message : String(e);
      checkpoint.failed.push({
        url: path,
        reason,
        at: new Date().toISOString(),
      });
      log(`FAIL ${path}: ${reason}`);
    }
  }

  await saveCheckpoint(checkpoint);

  log("──────────────────────────────────────────────");
  log("DONE");
  log(`  scraped:                ${stats.productsScraped}`);
  log(`  duplicates skipped:     ${stats.duplicatesSkipped}`);
  log(`  without barcode:        ${stats.productsWithoutBarcode}`);
  log(`  without image:          ${stats.productsWithoutImage}`);
  log(`  without attributes:     ${stats.productsWithoutAttributes}`);
  log(`  raw upsert ok:          ${stats.rawUpsertOk}`);
  log(`  raw upsert fail:        ${stats.rawUpsertFail}`);
  log(`  failures (this run):    ${stats.failures}`);
  log(`  total processed:        ${checkpoint.processedUrls.length}`);
  log(`  total failed (cumul.):  ${checkpoint.failed.length}`);
  log("──────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
