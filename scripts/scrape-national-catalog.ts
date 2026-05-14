/**
 * Skinly · staging scraper · National Catalog of Goods (RF)
 *
 * Запуск (минимум):
 *   npm run scrape:national-catalog -- --limit 20
 *   npm run scrape:national-catalog -- --limit 200 --resume
 *
 * Phase 13 — старт с произвольного подкаталога:
 *   npm run scrape:national-catalog -- --limit 5000 --rediscover --start-path /parfyumeriya/
 *   npm run scrape:national-catalog -- --limit 5000 --rediscover \
 *       --start-url https://xn----7sbabas4ajkhfocclk9d3cvfsa.xn--p1ai/mylo-i-sredstva-dlya-mytya/
 *   npm run scrape:national-catalog -- --limit 5000 --start-path /parfyumeriya/ --state-suffix parfyumeriya
 *
 * Debug-режим:
 *   npm run scrape:national-catalog -- --limit 5 --debug
 *
 * Что делает:
 *   1. discovery: BFS от стартовой страницы → набор product-URL'ов
 *      (по умолчанию /kosmetika-i-parfyumeriya/; иначе --start-path / --start-url)
 *   2. detail:    скачивает каждую product-страницу, парсит, пишет JSONL
 *   3. checkpoint: сохраняет прогресс на диск; --resume продолжает с него
 *
 * Checkpoint per startPath:
 *   - без --start-path / --start-url → `data/state/national-catalog-checkpoint.json`
 *     (старое поведение, не ломаем существующие прогрессы)
 *   - с --start-path /parfyumeriya/ →
 *     `data/state/national-catalog-checkpoint-parfyumeriya.json`
 *   - --state-suffix явно переопределяет slug.
 */

import { parseArgs } from "node:util";
import {
  BASE_URL,
  MAX_RECOMMENDED_PARALLEL_PROCESSES,
  checkpointFilePath,
  jsonlFilePath,
  normalizeStartPath,
  pathFromUrl,
  slugifyStartPath,
} from "./national-catalog/config";
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
  setCheckpointFile,
  setJsonlFile,
} from "./national-catalog/storage";
import {
  acquireLock,
  listActive,
  releaseLock,
  setupLockCleanup,
} from "./national-catalog/active-scrapers";
import { isProductInScope } from "./national-catalog/scope";
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
  /** Phase 13. `null` → дефолт (ROOT_CATEGORY_PATH в discovery.ts). */
  startPath: string | null;
  /**
   * Slug для checkpoint-файла. `null` → старое поведение (общий
   * `national-catalog-checkpoint.json`). Если задан startPath, slug
   * автоматически выводится из него, если --state-suffix не указан явно.
   */
  stateSuffix: string | null;
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
      "start-path": { type: "string" },
      "start-url": { type: "string" },
      "state-suffix": { type: "string" },
    },
  });
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  const startPathRaw = values["start-path"];
  const startUrlRaw = values["start-url"];

  if (startPathRaw != null && startUrlRaw != null) {
    throw new Error(
      "--start-path and --start-url are mutually exclusive — pass only one",
    );
  }

  let startPath: string | null = null;
  if (typeof startPathRaw === "string") {
    startPath = normalizeStartPath(startPathRaw);
  } else if (typeof startUrlRaw === "string") {
    startPath = pathFromUrl(startUrlRaw);
  }

  const stateSuffixRaw = values["state-suffix"];
  const stateSuffix =
    typeof stateSuffixRaw === "string" && stateSuffixRaw.trim().length > 0
      ? stateSuffixRaw.trim()
      : null;

  return {
    limit,
    resume: Boolean(values.resume),
    rediscover: Boolean(values.rediscover),
    debug: Boolean(values.debug),
    unsafeAcceptAll: Boolean(values["unsafe-accept-all"]),
    discoveryOnly: Boolean(values["discovery-only"]),
    startPath,
    stateSuffix,
  };
}

/**
 * Решить, какой slug использовать для checkpoint'а:
 *   1) явный --state-suffix (нормализуем до lowercase a-z0-9-)
 *   2) если задан startPath → авто-slug из него
 *   3) иначе null → общий checkpoint, как было.
 */
function resolveCheckpointSlug(args: CliArgs): string | null {
  if (args.stateSuffix) {
    return slugifyStartPath("/" + args.stateSuffix + "/");
  }
  if (args.startPath) {
    return slugifyStartPath(args.startPath);
  }
  return null;
}

function abs(p: string): string {
  return `${BASE_URL}${p}`;
}

/** Phase 13.1: slug, под которым релизим lock в outer finally на FATAL. */
let activeSlugForCleanup: string | null = null;

async function main(): Promise<void> {
  const args = parseCli();
  const checkpointSlug = resolveCheckpointSlug(args);
  const checkpointFile = checkpointFilePath(checkpointSlug);
  const jsonlFile = jsonlFilePath(checkpointSlug);
  setCheckpointFile(checkpointFile);
  setJsonlFile(jsonlFile);

  // Phase 13.1: lock + warning при параллельных запусках.
  const lockSlug = checkpointSlug ?? "default";
  activeSlugForCleanup = lockSlug;
  const cleanupSignals = setupLockCleanup(lockSlug);

  await ensureDirs();
  const alreadyActive = await listActive();
  const sameSlug = alreadyActive.find((r) => r.slug === lockSlug);
  if (sameSlug) {
    log(
      `[active-scrapers] ⚠️  overlapping run detected: another scraper with slug "${lockSlug}" ` +
        `started ${sameSlug.startedAt} (host=${sameSlug.hostname}, pid=${sameSlug.pid}). ` +
        `Continuing — checkpoint will be shared; results may double-process.`,
    );
  }

  const totalAfterUs = alreadyActive.length + (sameSlug ? 0 : 1);
  if (totalAfterUs > MAX_RECOMMENDED_PARALLEL_PROCESSES) {
    log(
      `[active-scrapers] ⚠️  ${totalAfterUs} parallel scrapers detected (recommended max ` +
        `${MAX_RECOMMENDED_PARALLEL_PROCESSES}). National catalog may throttle. ` +
        `Active slugs: ${[...alreadyActive.map((r) => r.slug), lockSlug].join(", ")}`,
    );
  }

  await acquireLock(lockSlug, args.startPath);

  log(
    `Starting · limit=${args.limit} resume=${args.resume} rediscover=${args.rediscover} ` +
      `debug=${args.debug} unsafeAcceptAll=${args.unsafeAcceptAll} ` +
      `discoveryOnly=${args.discoveryOnly} ` +
      `categorySlug=${lockSlug} startPath=${args.startPath ?? "(default)"} ` +
      `checkpoint=${checkpointFile} jsonl=${jsonlFile} active=${totalAfterUs}`,
  );

  const checkpoint = await loadCheckpoint();
  // Phase 13.1: метаданные в checkpoint (backward-compat — optional поля).
  if (args.startPath) checkpoint.startPath = args.startPath;
  if (checkpointSlug) checkpoint.categorySlug = checkpointSlug;
  // Phase 13.1+: includeGlobal=true (default) — мерджим current per-category JSONL
  // + legacy общий, чтобы вернуть cross-category dedup-оптимизацию.
  const existing = await loadExistingKeys();

  log(
    `Existing JSONL: ${existing.urls.size} url, ${existing.barcodes.size} barcode ` +
      `(current=${jsonlFile}; legacy-merged=${jsonlFile !== "data/raw/national-catalog-products.jsonl"})`,
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
      startPath: args.startPath ?? undefined,
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
      `Discovered ${checkpoint.discoveredUrls.length} URLs (см. ${checkpointFile})`,
    );
    if (args.debug) {
      log("Debug-артефакты: data/debug/root.html, data/debug/root-links.txt");
    }
    cleanupSignals();
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
  // Phase 13.5: out-of-scope skip counter. Локальный — ScrapeStats не трогаем,
  // чтобы не менять контракт типов.
  let outOfScopeSkipped = 0;
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

      // Phase 13.5: final scope guard. Если scraper запущен с --start-path,
      // продукт обязан лежать под "Косметика и парфюмерия" в breadcrumb'ах
      // (и под known title startPath'а, если он в map'е scope.ts).
      // Любой leak (discovery подхватил чужую категорию) — здесь обрубается:
      // НЕ пишем JSONL, НЕ upsert'им Postgres, НЕ помечаем processedUrls.
      const scope = isProductInScope(product, args.startPath);
      if (!scope.ok) {
        outOfScopeSkipped++;
        log(
          `SKIP out-of-scope categoryPath ${url}` +
            (scope.reason ? ` — ${scope.reason}` : "") +
            ` · breadcrumbs=[${product.categoryPath.join(" > ")}]`,
        );
        continue;
      }

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
  log(`  category slug:          ${lockSlug}`);
  log(`  scraped:                ${stats.productsScraped}`);
  log(`  out-of-scope skipped:   ${outOfScopeSkipped}`);
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

  // Снимаем signal-handlers; lock релизим в outer finally (даже на FATAL).
  cleanupSignals();
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (activeSlugForCleanup) {
      await releaseLock(activeSlugForCleanup);
    }
    await closeDb();
  });
