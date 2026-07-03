/**
 * goldapple.ru brand scraper — CLI.
 *
 * Usage:
 *   npm run scrape:goldapple:brand -- --url https://goldapple.ru/brands/uriage
 *
 * Options:
 *   --url <brandUrl>     required, e.g. https://goldapple.ru/brands/uriage
 *   --limit <n>          scrape only first n products (debug)
 *   --headful            run visible Chromium (helps if anti-bot blocks headless)
 *   --min-delay <ms>     min delay between product cards (default 1000)
 *   --max-delay <ms>     max delay between product cards (default 2000)
 *   --retries <n>        attempts per product (default 3)
 *   --out-dir <dir>      output dir (default data/out)
 *   --discover           only print discovered API endpoints + listing, then exit
 *
 * Output:
 *   data/out/goldapple_<brand>_<date>.json
 *   data/out/goldapple_<brand>_<date>.csv
 *   data/out/goldapple_<brand>_<date>_failed.json
 */

import { collectBrandProducts } from "../src/scrapers/goldapple/brand";
import {
  createClient,
  errLog,
  errMessage,
  installShutdown,
  jitter,
  log,
  sleep,
  warn,
  withRetries,
} from "../src/scrapers/goldapple/client";
import { buildOutPaths, exportCsv, exportFailed, exportJson } from "../src/scrapers/goldapple/export";
import { bootstrapProductEndpoints, scrapeProduct } from "../src/scrapers/goldapple/product";
import type {
  CliOptions,
  FailedUrl,
  GoldAppleProduct,
} from "../src/scrapers/goldapple/types";

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    url: "",
    limit: null,
    headful: false,
    minDelayMs: 1000,
    maxDelayMs: 2000,
    retries: 3,
    outDir: "data/out",
    discoverOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--url":
        opts.url = argv[++i] ?? "";
        break;
      case "--limit":
        opts.limit = Number(argv[++i]) || null;
        break;
      case "--headful":
        opts.headful = true;
        break;
      case "--min-delay":
        opts.minDelayMs = Number(argv[++i]) || opts.minDelayMs;
        break;
      case "--max-delay":
        opts.maxDelayMs = Number(argv[++i]) || opts.maxDelayMs;
        break;
      case "--retries":
        opts.retries = Number(argv[++i]) || opts.retries;
        break;
      case "--out-dir":
        opts.outDir = argv[++i] ?? opts.outDir;
        break;
      case "--discover":
        opts.discoverOnly = true;
        break;
      default:
        warn(`unknown argument: ${a}`);
    }
  }
  if (!opts.url || !/^https?:\/\/(www\.)?goldapple\.ru\//i.test(opts.url)) {
    errLog("required: --url https://goldapple.ru/brands/<slug>");
    process.exit(1);
  }
  if (opts.maxDelayMs < opts.minDelayMs) opts.maxDelayMs = opts.minDelayMs;
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const shutdown = installShutdown();
  const client = await createClient({ headful: opts.headful });

  const products: GoldAppleProduct[] = [];
  const failed: FailedUrl[] = [];
  let outPathsInfo: ReturnType<typeof buildOutPaths> | null = null;

  try {
    // -------- phase 1: brand listing (API discovery + pagination) --------
    const listing = await collectBrandProducts(client, opts.url);
    const outPaths = buildOutPaths(opts.outDir, listing.brandSlug);
    outPathsInfo = outPaths;

    log(`brand: "${listing.brandName}" (${listing.brandSlug}) — ${listing.items.length} unique products`);

    if (opts.discoverOnly) {
      log("--discover mode: endpoints and listing above; exiting without product scrape");
      return;
    }

    let items = listing.items;
    if (opts.limit !== null) {
      items = items.slice(0, opts.limit);
      log(`--limit ${opts.limit}: scraping first ${items.length} products`);
    }
    if (items.length === 0) {
      warn("no products found — check the brand URL or run with --discover / --headful");
      return;
    }

    // -------- phase 2: bootstrap product-card endpoints on first item --------
    let templates: Awaited<ReturnType<typeof bootstrapProductEndpoints>>["templates"] = [];
    let firstRaw: Record<string, unknown> = {};
    try {
      const boot = await withRetries("bootstrap", () =>
        bootstrapProductEndpoints(client, items[0]),
      );
      templates = boot.templates;
      firstRaw = boot.firstProductRaw;
    } catch (e) {
      warn(`bootstrap failed (${errMessage(e)}) — DOM-only mode`);
    }

    // -------- phase 3: scrape each product --------
    const snapshotEvery = 10;
    for (let i = 0; i < items.length; i++) {
      if (shutdown.requested()) {
        warn(`shutdown requested — stopping at ${i}/${items.length}`);
        break;
      }
      const item = items[i];
      const label = `[${i + 1}/${items.length}] ${item.itemId}`;
      try {
        const product = await withRetries(
          label,
          () =>
            scrapeProduct({
              client,
              item,
              templates,
              brandFallback: listing.brandName,
              precapturedApi: i === 0 ? firstRaw : undefined,
            }),
          opts.retries,
        );
        products.push(product);
        log(
          `${label} ✓ ${product.product_name ?? "?"} | ${product.price ?? "—"} ${product.currency ?? ""}` +
            `${product.ingredients ? " | INCI ✓" : ""}`,
        );
      } catch (e) {
        errLog(`${label} ✗ ${errMessage(e)}`);
        failed.push({
          url: item.url,
          itemId: item.itemId,
          error: errMessage(e),
          at: new Date().toISOString(),
        });
      }

      if (products.length > 0 && products.length % snapshotEvery === 0) {
        await exportJson(products, outPaths.json).catch(() => undefined);
      }
      if (i < items.length - 1 && !shutdown.requested()) {
        await sleep(jitter(opts.minDelayMs, opts.maxDelayMs));
      }
    }

    // -------- phase 4: export --------
    await exportJson(products, outPaths.json);
    await exportCsv(products, outPaths.csv);
    if (failed.length > 0) await exportFailed(failed, outPaths.failed);

    log("");
    log(`done: ${products.length} products, ${failed.length} failed`);
    log(`  JSON: ${outPaths.json}`);
    log(`  CSV:  ${outPaths.csv}`);
    if (failed.length > 0) log(`  failed: ${outPaths.failed}`);
  } catch (e) {
    errLog(`fatal: ${errMessage(e)}`);
    // still flush whatever we collected
    if (outPathsInfo && products.length > 0) {
      await exportJson(products, outPathsInfo.json).catch(() => undefined);
      await exportCsv(products, outPathsInfo.csv).catch(() => undefined);
      if (failed.length > 0) await exportFailed(failed, outPathsInfo.failed).catch(() => undefined);
      warn(`partial results flushed to ${outPathsInfo.json}`);
    }
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void main();
