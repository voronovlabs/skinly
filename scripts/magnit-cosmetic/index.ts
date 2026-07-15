/**
 * Магнит Косметик → Prisma Product. CLI entry point.
 *
 * Транспорт: Playwright + установленный Google Chrome (сайт за QRATOR,
 * HTTP-клиент блокируется — подтверждено smoke-тестом). Полностью фоновый
 * режим: headless по умолчанию, одна persistent-сессия, модалки
 * закрываются автоматически, участие пользователя не требуется.
 *
 * Примеры:
 *   npm run scrape:magnit -- --limit 5 --dry-run --save-json   # проба на 5 товарах
 *   npm run scrape:magnit -- --product-url "https://cosmetic.magnit.ru/product/..."
 *   npm run scrape:magnit -- --category-url "https://cosmetic.magnit.ru/catalog/100656-novyy_mk_shampuni"
 *   npm run scrape:magnit -- --limit 10                        # 10 товаров → БД
 *   npm run scrape:magnit -- --all --dry-run --save-json       # весь каталог без записи
 *   npm run scrape:magnit -- --all --resume                    # полный импорт
 *
 * Флаги: --limit N, --offset N, --category-url URL, --product-url URL,
 *   --all, --dry-run, --save-json, --resume, --headful (отладка),
 *   --shop-code CODE, --debug, --force.
 *
 * Пайплайн: warmup сессии → discovery (sitemap/категория, той же сессией)
 * → дедуп по externalId → карточки последовательно (~1/сек, checkpoint
 * после каждой) → нормализация → валидация → upsert(source+externalId)
 * → отчёт. Повторный запуск идемпотентен, дубли не создаются.
 */

import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  BASE_URL,
  CARD_JITTER_MS,
  CARD_MIN_INTERVAL_MS,
  PATHS,
  SOURCE,
} from "./config";
import { closeBrowser, openBrowser, warmupSession, type BrowserSession } from "./browser";
import { classifyOtherReason } from "./categories";
import { closeDb, upsertProduct } from "./db";
import {
  canonicalProductUrl,
  discoverCategories,
  discoverFromCategory,
  discoverFromSitemap,
  selectRepresentativeSample,
  type DiscoveredProduct,
} from "./discovery";
import { log, setDebug, ts } from "./logger";
import { normalizeProduct } from "./normalize";
import { fetchProductViaBrowser } from "./product";
import {
  appendRawJsonl,
  flushState,
  loadState,
  saveDebugHtml,
  saveJson,
} from "./storage";
import {
  emptyStats,
  type FailedProduct,
  type NormalizedMagnitProduct,
  type RawMagnitProduct,
  type SkippedProduct,
} from "./types";

/* ───────── CLI ───────── */

const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "0" },
    offset: { type: "string", default: "0" },
    "category-url": { type: "string" },
    "product-url": { type: "string" },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "save-json": { type: "boolean", default: false },
    resume: { type: "boolean", default: false },
    headful: { type: "boolean", default: false },
    "shop-code": { type: "string" },
    debug: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    /** Осознанный запуск экспериментального импортёра. */
    experimental: { type: "boolean", default: false },
    /** Репрезентативная выборка: 2 лицо / 2 волосы / 2 тело / 2 макияж / 2 не-косметика. */
    "sample-categories": { type: "boolean", default: false },
  },
});

const LIMIT = parseInt(args.limit ?? "0", 10) || 0;
const OFFSET = parseInt(args.offset ?? "0", 10) || 0;
const DRY_RUN = args["dry-run"] ?? false;
const SAVE_JSON = args["save-json"] ?? false;

setDebug(args.debug ?? false);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────── main ───────── */

let session: BrowserSession | null = null;

async function main(): Promise<void> {
  // ── ГАРД: импортёр экспериментальный (Playwright/Chrome, ~1 карточка/сек).
  // Транспорт подтверждён (headless Chrome без VPN, 5/5). Флаг --experimental
  // защищает от случайного массового прогона. Причина 423 в прошлом — VPN.
  if (!args.experimental) {
    log("Импортёр Магнит Косметик — экспериментальный (браузерный транспорт).");
    log("Для запуска добавь флаг --experimental. Пример безопасной пробы:");
    log("  npm run scrape:magnit:experimental -- --experimental --limit 5 --dry-run --save-json");
    process.exitCode = 1;
    return;
  }

  const stats = emptyStats();
  const skipped: SkippedProduct[] = [];
  const failed: FailedProduct[] = [];
  const startedAt = Date.now();

  if (
    !args.all &&
    !args["sample-categories"] &&
    !args["category-url"] &&
    !args["product-url"] &&
    LIMIT === 0
  ) {
    log("Укажи режим: --all | --sample-categories | --category-url <url> | --product-url <url> | --limit N");
    log("Безопасная проба: npm run scrape:magnit:experimental -- --experimental --limit 5 --dry-run");
    process.exitCode = 1;
    return;
  }

  ts(`mode: ${DRY_RUN ? "DRY-RUN (без записи в БД)" : "запись в БД"} | source=${SOURCE} | transport=playwright/${args.headful ? "headful" : "headless"}`);
  if (args["shop-code"]) ts(`region: shopCode=${args["shop-code"]} (только цены/наличие; карточки от региона не зависят)`);

  /* ── 0. браузерная сессия ── */
  session = await openBrowser({ headful: args.headful });
  const page = session.page;
  await warmupSession(page, `${BASE_URL}/catalog`);

  /* ── 1. discovery ── */
  let discovered: DiscoveredProduct[] = [];

  if (args["product-url"]) {
    const p = canonicalProductUrl(args["product-url"]);
    if (!p) throw new Error(`не похоже на URL карточки: ${args["product-url"]}`);
    discovered = [p];
  } else if (args["category-url"]) {
    const res = await discoverFromCategory(page, args["category-url"]);
    discovered = res.products;
    if (res.declaredTotal !== null) {
      ts(`category: заявлено ${res.declaredTotal}, собрано ${discovered.length}`);
    }
  } else {
    const full = await discoverFromSitemap(page);
    if (args["sample-categories"]) {
      const { picked, byGroup } = selectRepresentativeSample(full);
      discovered = picked;
      ts(`sample-categories: репрезентативная выборка (${picked.length} товаров)`);
      for (const [label, urls] of Object.entries(byGroup)) {
        ts(`  ${label}: ${urls.length} — ${urls.map((u) => u.split("/product/")[1]?.slice(0, 40)).join(", ") || "не найдено в sitemap"}`);
      }
    } else {
      discovered = full;
    }
    // категории — только для отчёта о полноте
    try {
      const cats = await discoverCategories(page);
      stats.categoriesFound = cats.length;
      ts(`categories: found ${cats.length}`);
      if (SAVE_JSON) await saveJson(PATHS.categoriesJson, cats);
    } catch (e) {
      ts(`categories: sitemap каталога недоступен (${(e as Error).message})`);
    }
  }

  stats.listedProducts = discovered.length;

  /* ── 2. дедуп по externalId ── */
  const byId = new Map<string, DiscoveredProduct>();
  for (const p of discovered) {
    if (byId.has(p.externalId)) stats.duplicates++;
    else byId.set(p.externalId, p);
  }
  let queue = [...byId.values()];
  stats.uniqueProducts = queue.length;
  ts(`discovery: ${stats.listedProducts} listed, ${stats.uniqueProducts} unique, ${stats.duplicates} dups`);

  if (OFFSET > 0) queue = queue.slice(OFFSET);
  if (LIMIT > 0) queue = queue.slice(0, LIMIT);
  ts(`queue: ${queue.length} товаров (offset=${OFFSET}, limit=${LIMIT || "∞"}, последовательно, ~1 карточка/сек)`);

  if (SAVE_JSON) await saveJson(PATHS.catalogProductsJson, queue);

  /* ── 3. карточки: последовательно, checkpoint после каждой ── */
  const state = await loadState();
  const raws: RawMagnitProduct[] = [];

  for (const item of queue) {
    if (args.resume && state.details[item.externalId]) {
      raws.push(state.details[item.externalId]);
      stats.detailsFetched++;
      continue;
    }

    const t0 = Date.now();
    try {
      const { raw, html } = await fetchProductViaBrowser(page, item.url);
      raws.push(raw);
      stats.detailsFetched++;
      state.details[item.externalId] = raw;
      await appendRawJsonl(raw);
      if (args.debug) await saveDebugHtml(item.externalId, html);
      ts(`product ${item.externalId}: fetched${raw.composition ? " (+состав)" : ""} (${Date.now() - t0}ms)`);
    } catch (e) {
      stats.detailsFailed++;
      const err = (e as Error).message.slice(0, 200);
      failed.push({ url: item.url, error: err });
      // debug-артефакты: HTML + screenshot того, что реально видит браузер
      try {
        await saveDebugHtml(item.externalId, await page.content());
        await page.screenshot({
          path: path.join(PATHS.debugDir, `${item.externalId}.png`),
          fullPage: false,
        });
      } catch {
        /* страница могла умереть — не мешаем следующей карточке */
      }
      ts(`product ${item.externalId}: FAILED — ${err} (debug: ${PATHS.debugDir})`);
    }

    // checkpoint после КАЖДОГО товара (успех и неуспех)
    await flushState(state);

    // темп ≤1 карточка/сек (+джиттер), считая от старта навигации
    const elapsed = Date.now() - t0;
    const pause = Math.max(0, CARD_MIN_INTERVAL_MS - elapsed) + Math.random() * CARD_JITTER_MS;
    await sleep(pause);
  }

  if (SAVE_JSON) await saveJson(PATHS.productDetailsJson, raws);

  /* ── 4. нормализация + валидация ── */
  const normalized: NormalizedMagnitProduct[] = [];
  for (const raw of raws) {
    const res = normalizeProduct(raw);
    if (res.flags.noBrand) stats.noBrand++;
    if (res.flags.noImage) stats.noImage++;
    if (res.flags.noDescription) stats.noDescription++;
    if (res.flags.noCategory) stats.noCategory++;
    if (res.skip) {
      stats.skipped++;
      if (res.skip.reason === "not beauty-relevant") stats.skippedNotBeauty++;
      skipped.push(res.skip);
      ts(`product ${res.skip.externalId}: skipped — ${res.skip.reason}${res.skip.detail ? ` (${res.skip.detail.slice(0, 60)})` : ""}`);
      continue;
    }
    if (res.product) {
      normalized.push(res.product);
      stats.normalized++;
      if (res.product.category === "OTHER") {
        const reason = classifyOtherReason(res.product.breadcrumbs, res.product.name);
        const key = {
          hair: "otherHair",
          makeup: "otherMakeup",
          deodorant: "otherDeodorant",
          shaving: "otherShaving",
          kids_hygiene: "otherKidsHygiene",
          other: "otherOther",
        }[reason] as keyof typeof stats;
        stats[key]++;
        ts(`product ${res.product.externalId}: mapped to OTHER (${reason})`);
      } else {
        ts(`product ${res.product.externalId}: mapped to ${res.product.category}`);
      }
    }
  }

  if (SAVE_JSON) {
    await saveJson(PATHS.normalizedJson, normalized);
    await saveJson(PATHS.failedJson, { failed, skipped });
  }

  /* ── 5. dry-run: показать и выйти / запись в БД ── */
  if (DRY_RUN) {
    log("\n─── DRY-RUN: нормализованные товары (первые 5) ───");
    for (const p of normalized.slice(0, 5)) {
      const { rawComposition, sourceUrl, breadcrumbs, ...productRow } = p;
      log(JSON.stringify(productRow, null, 2));
      log(`  breadcrumbs: ${breadcrumbs.join(" / ") || "—"}`);
      log(`  состав: ${rawComposition ? rawComposition.slice(0, 120) + "…" : "—"}`);
      log(`  url: ${sourceUrl}\n`);
    }
  } else {
    for (const p of normalized) {
      try {
        const result = await upsertProduct(p, { force: args.force });
        stats[result]++;
        ts(`product ${p.externalId}: ${result}`);
      } catch (e) {
        stats.dbErrors++;
        failed.push({ url: p.sourceUrl, error: `db: ${(e as Error).message}` });
        ts(`product ${p.externalId}: DB ERROR — ${(e as Error).message}`);
      }
    }
  }

  /* ── 6. отчёт ── */
  const summary = {
    mode: DRY_RUN ? "dry-run" : "import",
    source: SOURCE,
    transport: `playwright/${args.headful ? "headful" : "headless"}`,
    startedAt: new Date(startedAt).toISOString(),
    durationSec: Math.round((Date.now() - startedAt) / 1000),
    stats,
    failedCount: failed.length,
  };
  if (SAVE_JSON || !DRY_RUN) await saveJson(PATHS.summaryJson, summary);

  log("\n─── Итог ───");
  log(`Категорий найдено:      ${stats.categoriesFound}`);
  log(`Товаров в листингах:    ${stats.listedProducts}`);
  log(`Уникальных товаров:     ${stats.uniqueProducts}`);
  log(`Дублей:                 ${stats.duplicates}`);
  log(`Карточек загружено:     ${stats.detailsFetched}`);
  log(`Ошибок загрузки:        ${stats.detailsFailed}`);
  log(`Нормализовано:          ${stats.normalized}`);
  log(`Пропущено:              ${stats.skipped} (из них не-косметика: ${stats.skippedNotBeauty})`);
  if (!DRY_RUN) {
    log(`Создано в БД:           ${stats.created}`);
    log(`Обновлено в БД:         ${stats.updated}`);
    log(`Без изменений:          ${stats.unchanged}`);
    log(`Ошибок БД:              ${stats.dbErrors}`);
  }
  log(`Без бренда:             ${stats.noBrand}`);
  log(`Без изображения:        ${stats.noImage}`);
  log(`Без описания:           ${stats.noDescription}`);
  log(`Без категории (OTHER):  ${stats.noCategory}`);
  log("─── OTHER по причинам (enum не покрывает) ───");
  log(`  OTHER: волосы:        ${stats.otherHair}`);
  log(`  OTHER: макияж:        ${stats.otherMakeup}`);
  log(`  OTHER: дезодоранты:   ${stats.otherDeodorant}`);
  log(`  OTHER: бритьё:        ${stats.otherShaving}`);
  log(`  OTHER: детская гигиена:${stats.otherKidsHygiene}`);
  log(`  OTHER: прочее:        ${stats.otherOther}`);
  log(`Время:                  ${summary.durationSec}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser(session);
    await closeDb();
  });
