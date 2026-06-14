/**
 * Skinly · staging scraper · FARERA (fareraparfum.ru)
 *
 * Этап 1: собираем данные ТОЛЬКО в JSONL (без Postgres).
 * Discovery — через products*.xml (полный охват каталога, без обхода брендов).
 *
 * Переиспользует инфраструктуру Национального каталога БЕЗ её изменения:
 *   - fetcher.ts        (rate-limit / retry / backoff)
 *   - storage.ts        (checkpoint + JSONL append + dedup loadExistingKeys)
 *   - active-scrapers.ts(lock-файлы)
 *   - тот же формат логирования
 * Файлы хранения — отдельные `farera-*`, source="farera". В файлы
 * Национального каталога ничего не пишется (loadExistingKeys вызывается с
 * includeGlobal=false, JSONL/checkpoint переключены через setJsonlFile/
 * setCheckpointFile, saveRawProduct НЕ вызывается).
 *
 * Два независимых лимита:
 *   --limit N            scrapeLimit — сколько КАРТОЧЕК обработать за запуск.
 *   --discovery-limit N  сколько URL собрать из sitemap. Если не задан —
 *                        собираем ВЕСЬ каталог (checkpoint.discoveredUrls
 *                        получает полный список). scrapeLimit на discovery
 *                        НЕ влияет.
 *
 * Запуск:
 *   npm run scrape:farera -- --limit 1000
 *   npm run scrape:farera -- --rediscover --limit 100   # discover=все, scrape=100
 *   npm run scrape:farera -- --limit 1000 --resume
 *   npm run scrape:farera -- --discovery-only            # только собрать весь список URL
 *   npm run scrape:farera -- --discovery-only --discovery-limit 500
 */

import { parseArgs } from "node:util";
import { BASE_URL, DEFAULT_LIMIT, LOCK_SLUG, PATHS } from "./farera/config";
import { discoverFromSitemap } from "./farera/discovery";
import { parseFareraProduct } from "./farera/parser";
import type { FareraScrapeStats } from "./farera/types";
// Переиспользуем модули Национального каталога как есть (не модифицируем их).
import { fetchHtml } from "./national-catalog/fetcher";
import {
  appendProduct,
  ensureDirs,
  loadCheckpoint,
  loadExistingKeys,
  saveCheckpoint,
  setCheckpointFile,
  setJsonlFile,
} from "./national-catalog/storage";
import {
  acquireLock,
  listActive,
  releaseLock,
  setupLockCleanup,
} from "./national-catalog/active-scrapers";
import type { ScrapedProduct } from "./national-catalog/types";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

interface CliArgs {
  /** scrapeLimit — сколько КАРТОЧЕК обработать в этом запуске. */
  limit: number;
  /**
   * discoveryLimit — сколько URL собрать из sitemap. `null` → без
   * ограничения (весь каталог). Не связан с `limit`.
   */
  discoveryLimit: number | null;
  resume: boolean;
  rediscover: boolean;
  discoveryOnly: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: String(DEFAULT_LIMIT) },
      "discovery-limit": { type: "string" },
      resume: { type: "boolean", default: false },
      rediscover: { type: "boolean", default: false },
      "discovery-only": { type: "boolean", default: false },
    },
  });
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  let discoveryLimit: number | null = null;
  if (values["discovery-limit"] != null) {
    const dl = parseInt(String(values["discovery-limit"]), 10);
    if (!Number.isFinite(dl) || dl <= 0) {
      throw new Error("--discovery-limit must be a positive integer");
    }
    discoveryLimit = dl;
  }

  return {
    limit,
    discoveryLimit,
    resume: Boolean(values.resume),
    rediscover: Boolean(values.rediscover),
    discoveryOnly: Boolean(values["discovery-only"]),
  };
}

function abs(path: string): string {
  return path.startsWith("http") ? path : `${BASE_URL}${path}`;
}

let lockAcquired = false;

async function main(): Promise<void> {
  const args = parseCli();

  // Переключаем общий storage на farera-файлы. national-catalog не трогаем.
  setCheckpointFile(PATHS.checkpoint);
  setJsonlFile(PATHS.rawProductsJsonl);

  const cleanupSignals = setupLockCleanup(LOCK_SLUG);
  await ensureDirs();

  const active = await listActive();
  const same = active.find((r) => r.slug === LOCK_SLUG);
  if (same) {
    log(
      `[active-scrapers] ⚠️  overlapping farera run since ${same.startedAt} ` +
        `(host=${same.hostname}, pid=${same.pid}) — checkpoint shared.`,
    );
  }
  await acquireLock(LOCK_SLUG, null);
  lockAcquired = true;

  log(
    `Starting FARERA · scrapeLimit=${args.limit} ` +
      `discoveryLimit=${args.discoveryLimit ?? "all"} resume=${args.resume} ` +
      `rediscover=${args.rediscover} discoveryOnly=${args.discoveryOnly} ` +
      `jsonl=${PATHS.rawProductsJsonl} checkpoint=${PATHS.checkpoint}`,
  );

  const checkpoint = await loadCheckpoint();
  // includeGlobal=false — НЕ мерджим dedup-ключи Национального каталога.
  const existing = await loadExistingKeys({ includeGlobal: false });
  log(
    `Existing farera JSONL: ${existing.urls.size} url. ` +
      `Checkpoint: ${checkpoint.processedUrls.length} processed, ${checkpoint.failed.length} failed`,
  );

  // ── Discovery (products*.xml) ─────────────────────────────
  const needsDiscovery =
    args.rediscover ||
    checkpoint.discoveredUrls.length === 0 ||
    !args.resume;

  if (needsDiscovery) {
    log("Discovery phase (sitemap products*.xml)…");
    // discoveryLimit отделён от scrapeLimit: по умолчанию собираем ВЕСЬ
    // каталог (limit=undefined). --discovery-limit режет только сбор URL.
    const { urls, stats } = await discoverFromSitemap({
      limit: args.discoveryLimit ?? undefined,
      log,
    });
    log(
      `Discovery done · product-sitemaps=${stats.productSitemaps}, ` +
        `totalLocs=${stats.totalLocs}, discovered=${stats.productUrls}, ` +
        `scrapeLimit=${args.limit}`,
    );
    // checkpoint.discoveredUrls — ПОЛНЫЙ список (не режется под scrapeLimit).
    checkpoint.discoveredUrls = urls;
    await saveCheckpoint(checkpoint);
  } else {
    log(
      `Skipping discovery (resume): ${checkpoint.discoveredUrls.length} URLs from previous run`,
    );
  }

  if (args.discoveryOnly) {
    log("--discovery-only: stop after discovery");
    log(`Discovered ${checkpoint.discoveredUrls.length} URLs (см. ${PATHS.checkpoint})`);
    cleanupSignals();
    return;
  }

  const remaining = checkpoint.discoveredUrls.filter(
    (u) => !checkpoint.processedUrls.includes(u),
  );
  log(`Remaining to process: ${remaining.length}`);

  // ── Detail phase ──────────────────────────────────────────
  const stats: FareraScrapeStats = {
    productsScraped: 0,
    productsWithInci: 0,
    productsWithoutImage: 0,
    productsWithoutPrice: 0,
    duplicatesSkipped: 0,
    failures: 0,
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
      const product = parseFareraProduct(html, url);

      if (!product.imageUrl) stats.productsWithoutImage++;
      if (product.priceCurrent == null) stats.productsWithoutPrice++;
      if (product.hasInci) stats.productsWithInci++;

      // Переиспользуем общий appendProduct. Структурно farera-объект
      // совместим (sourceUrl + barcode), отличается лишь литералом source —
      // приводим типом, поведение append (JSON.stringify) идентично.
      await appendProduct(product as unknown as ScrapedProduct);
      stats.productsScraped++;
      scrapedThisRun++;

      existing.urls.add(path);
      checkpoint.processedUrls.push(path);

      log(
        `OK ${path} · brand=${product.brand ?? "—"} price=${product.priceCurrent ?? "—"} ` +
          `inci=${product.hasInci ? "yes" : "no"} code=${product.vendorCode ?? "—"}`,
      );

      if (stats.productsScraped % 25 === 0) {
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

  log("──────────────────────────────────────────────");
  log("DONE (farera)");
  log(`  scraped:              ${stats.productsScraped}`);
  log(`  with INCI:            ${stats.productsWithInci}`);
  log(`  without image:        ${stats.productsWithoutImage}`);
  log(`  without price:        ${stats.productsWithoutPrice}`);
  log(`  duplicates skipped:   ${stats.duplicatesSkipped}`);
  log(`  failures (this run):  ${stats.failures}`);
  log(`  total processed:      ${checkpoint.processedUrls.length}`);
  log(`  total failed (cumul): ${checkpoint.failed.length}`);
  log("──────────────────────────────────────────────");

  cleanupSignals();
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (lockAcquired) await releaseLock(LOCK_SLUG);
    // closeDb НЕ вызываем — Postgres на этапе 1 не используется.
  });
