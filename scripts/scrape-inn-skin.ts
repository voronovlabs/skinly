/**
 * Skinly · staging scraper · inn-skin.ru
 *
 * Скрейпит карточки косметики по брендам в ИЗОЛИРОВАННЫЙ staging-слой
 * (схема `scrape`), не трогая существующий каталог / National Catalog.
 *
 * Запуск (безопасный пилот — только Uriage, 2 страницы):
 *   npm run scrape:inn-skin -- --brand "Uriage" --max-pages 2
 *
 * Дебаг (дамп HTML листинга + одной детали в data/debug):
 *   npm run scrape:inn-skin -- --brand "Uriage" --max-pages 1 --debug
 *
 * Полный прогон по всем целевым брендам:
 *   npm run scrape:inn-skin
 *   npm run scrape:inn-skin -- --max-pages 5 --limit 1000
 *
 * Что делает:
 *   1. ensureSchema() — создаёт scrape.* (идемпотентно).
 *   2. По каждому бренду листает страницы → собирает UUID карточек.
 *   3. По каждому UUID качает детальную страницу, парсит, пишет в JSONL и
 *      upsert'ит в scrape.inn_skin_products (ключ — source_url).
 *   4. Логирует brand/page/found/saved/skipped/errors; устойчив к падению
 *      отдельной карточки (try/catch на товар).
 *
 * НИЧЕГО не пишет в public."Product"/"Ingredient" — это делает отдельный
 * (пока dry-run) merge-шаг.
 */

import { parseArgs } from "node:util";
import { catalogUrl, productUrl, TARGET_BRANDS } from "./inn-skin/config";
import { fetchHtml } from "./inn-skin/fetcher";
import { parseDetailPage, parseListingPage } from "./inn-skin/parser";
import {
  appendProduct,
  closeDb,
  ensureDirs,
  ensureSchema,
  loadExistingUrls,
  saveRawProduct,
  writeDebug,
} from "./inn-skin/storage";
import { emptyStats, type InnSkinScrapedProduct } from "./inn-skin/types";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

/* ───────── CLI ───────── */

interface CliArgs {
  brands: string[];
  maxPages: number;
  limit: number; // 0 = без лимита
  debug: boolean;
  jsonlOnly: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      brand: { type: "string", multiple: true },
      "max-pages": { type: "string", default: "3" },
      limit: { type: "string", default: "0" },
      debug: { type: "boolean", default: false },
      "jsonl-only": { type: "boolean", default: false },
    },
  });

  // --brand можно повторять или передать через запятую.
  const brandVals = (values.brand as string[] | undefined) ?? [];
  const brands = brandVals
    .flatMap((b) => b.split(","))
    .map((b) => b.trim())
    .filter(Boolean);

  const maxPages = parseInt(String(values["max-pages"]), 10);
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    throw new Error("--max-pages must be a positive integer");
  }
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("--limit must be >= 0");
  }

  return {
    brands: brands.length ? brands : TARGET_BRANDS,
    maxPages,
    limit,
    debug: Boolean(values.debug),
    jsonlOnly: Boolean(values["jsonl-only"]),
  };
}

/* ───────── per-brand ───────── */

async function scrapeBrand(
  brand: string,
  args: CliArgs,
  existingUrls: Set<string>,
  stats: ReturnType<typeof emptyStats>,
  remainingLimit: () => number,
): Promise<void> {
  log(`══════ BRAND "${brand}" ══════`);

  for (let page = 1; page <= args.maxPages; page++) {
    if (args.limit && remainingLimit() <= 0) break;

    const listUrl = catalogUrl(brand, page);
    let listHtml: string;
    try {
      listHtml = await fetchHtml(listUrl, log);
      stats.listingPagesFetched++;
    } catch (e) {
      stats.failures++;
      log(`[LISTING FAIL] ${listUrl} reason=${errMsg(e)}`);
      break;
    }

    const { stubs, totalPages } = parseListingPage(listHtml, brand);

    if (args.debug && page === 1) {
      await writeDebug(`listing-${slug(brand)}-p1.html`, listHtml);
      log(`[debug] dumped listing HTML for "${brand}" p1`);
    }

    log(
      `[LISTING] brand="${brand}" page=${page} found=${stubs.length}` +
        (totalPages ? ` totalPages=${totalPages}` : ""),
    );
    stats.cardsFound += stubs.length;

    if (stubs.length === 0) {
      // Пустая страница → дальше листать нет смысла (или бренд-строка не та).
      if (page === 1) {
        log(
          `[WARN] brand="${brand}" page 1 пуст — проверьте точное написание ?brand=`,
        );
      }
      break;
    }

    let debuggedDetail = false;
    for (const stub of stubs) {
      if (args.limit && remainingLimit() <= 0) break;

      if (existingUrls.has(stub.sourceUrl)) {
        stats.duplicatesSkipped++;
        continue;
      }

      try {
        const detailHtml = await fetchHtml(
          productUrl(stub.sourceProductId),
          log,
        );
        stats.detailFetched++;

        if (args.debug && !debuggedDetail) {
          await writeDebug(
            `detail-${slug(brand)}-${stub.sourceProductId}.html`,
            detailHtml,
          );
          debuggedDetail = true;
          log(`[debug] dumped 1 detail HTML for "${brand}"`);
        }

        const d = parseDetailPage(detailHtml, brand);
        const product: InnSkinScrapedProduct = {
          source: "inn-skin",
          sourceProductId: stub.sourceProductId,
          sourceUrl: stub.sourceUrl,
          brand: d.brand,
          productName: d.productName,
          categoryRaw: stub.categoryRaw,
          imageUrl: d.imageUrl,
          priceText: d.priceText,
          priceValue: d.priceValue,
          description: d.description,
          usage: d.usage,
          ingredientsRaw: d.ingredientsRaw,
          retailer: d.retailer,
          retailerArticle: d.retailerArticle,
          sellerUrl: d.sellerUrl,
          scrapedAt: new Date().toISOString(),
        };

        if (!product.ingredientsRaw) stats.withoutIngredients++;
        if (!product.retailerArticle) stats.withoutArticle++;

        await appendProduct(product);
        existingUrls.add(stub.sourceUrl);

        if (!args.jsonlOnly) {
          try {
            await saveRawProduct(product);
            stats.rawUpsertOk++;
          } catch (e) {
            stats.rawUpsertFail++;
            log(`[DB FAIL] ${stub.sourceUrl} reason=${errMsg(e)}`);
          }
        }

        log(
          `[SAVED] ${truncate(product.productName ?? "—", 48)} | ` +
            `art=${product.retailerArticle ?? "—"} ` +
            `inci=${product.ingredientsRaw ? "yes" : "no"}`,
        );
      } catch (e) {
        stats.failures++;
        log(`[DETAIL FAIL] ${stub.sourceUrl} reason=${errMsg(e)}`);
      }
    }

    if (totalPages && page >= totalPages) break;
  }

  stats.brandsProcessed++;
}

/* ───────── main ───────── */

async function main(): Promise<void> {
  const args = parseCli();
  log(
    `[SCRAPE inn-skin] brands=${args.brands.length} maxPages=${args.maxPages} ` +
      `limit=${args.limit || "∞"} debug=${args.debug} jsonlOnly=${args.jsonlOnly}`,
  );
  log(`brands: ${args.brands.join(", ")}`);

  await ensureDirs();
  if (!args.jsonlOnly) {
    await ensureSchema(log);
  }

  const stats = emptyStats();
  const existingUrls = args.jsonlOnly
    ? new Set<string>()
    : await loadExistingUrls();
  log(`[init] existing staging rows: ${existingUrls.size}`);

  const savedSoFar = () => stats.rawUpsertOk + stats.duplicatesSkipped;
  const remainingLimit = () =>
    args.limit ? args.limit - (stats.detailFetched + stats.duplicatesSkipped) : 1;

  for (const brand of args.brands) {
    if (args.limit && remainingLimit() <= 0) break;
    try {
      await scrapeBrand(brand, args, existingUrls, stats, remainingLimit);
    } catch (e) {
      stats.failures++;
      log(`[BRAND FAIL] "${brand}" reason=${errMsg(e)}`);
    }
  }

  void savedSoFar;

  // ── Summary ──
  log("──────────────────────────────────────────────");
  log("[SCRAPE inn-skin] DONE");
  log(`  brands processed:        ${stats.brandsProcessed}`);
  log(`  listing pages fetched:   ${stats.listingPagesFetched}`);
  log(`  cards found:             ${stats.cardsFound}`);
  log(`  detail pages fetched:    ${stats.detailFetched}`);
  log(`  raw upsert ok:           ${stats.rawUpsertOk}`);
  log(`  raw upsert fail:         ${stats.rawUpsertFail}`);
  log(`  without INCI:            ${stats.withoutIngredients}`);
  log(`  without article:         ${stats.withoutArticle}`);
  log(`  duplicates skipped:      ${stats.duplicatesSkipped}`);
  log(`  failures:                ${stats.failures}`);
  log("──────────────────────────────────────────────");
}

/* ───────── utils ───────── */

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
