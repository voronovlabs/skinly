/**
 * ЭТАП 1 — только скачивание карточек.
 *
 * discovery (sitemap / категория / одна карточка) → Playwright-карточки
 * последовательно (~1/сек) → append-only data/raw/magnit-cosmetic-products.jsonl.
 * Никакой нормализации, никакой Prisma/БД.
 *
 * Resume — из самого JSONL: externalId, уже присутствующий в файле, повторно
 * не скачивается (переопределяется флагом --refetch: свежая запись
 * дописывается в конец, этап 2 берёт последнюю). state.json не используется.
 *
 * Ошибки карточек НЕ останавливают проход: строка уходит в
 * failed-products.jsonl, парсер идёт дальше. Повторная обработка ошибок —
 * отдельной командой `retry-failed` (runRetryFailed).
 */

import * as path from "node:path";
import {
  BASE_URL,
  CARD_JITTER_MS,
  CARD_MIN_INTERVAL_MS,
  PATHS,
  SOURCE,
} from "./config";
import {
  closeBrowser,
  openBrowser,
  ProductNotFoundError,
  warmupSession,
  type BrowserSession,
} from "./browser";
import {
  canonicalProductUrl,
  discoverCategories,
  discoverFromCategory,
  discoverFromSitemap,
  selectRepresentativeSample,
  type DiscoveredProduct,
} from "./discovery";
import { log, ts } from "./logger";
import { fetchProductViaBrowser } from "./product";
import {
  AtomicJsonlWriter,
  appendJsonl,
  readJsonlKeys,
  saveDebugHtml,
  saveJson,
  streamJsonl,
} from "./storage";
import type { FailedProduct } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScrapeOptions {
  limit: number;
  offset: number;
  categoryUrl?: string;
  productUrl?: string;
  all: boolean;
  sampleCategories: boolean;
  saveJson: boolean;
  headful: boolean;
  debug: boolean;
  /** Скачивать заново даже если externalId уже есть в JSONL. */
  refetch: boolean;
}

/** Сохранение debug-артефактов упавшей карточки (страница могла умереть). */
async function saveFailureArtifacts(
  session: BrowserSession,
  externalId: string,
): Promise<void> {
  try {
    await saveDebugHtml(externalId, await session.page.content());
    await session.page.screenshot({
      path: path.join(PATHS.debugDir, `${externalId}.png`),
      fullPage: false,
    });
  } catch {
    /* не мешаем следующей карточке */
  }
}

/**
 * Скачивает очередь карточек в append-only JSONL. Общая рабочая лошадка
 * scrape и retry-failed. Возвращает счётчики и список оставшихся неудач.
 *
 * Разделение ошибок:
 *   - ProductNotFoundError (товар удалён, 404-заглушка) — НЕ временная:
 *     сразу в not-found-products.jsonl, в failed не попадает, retry не будет;
 *   - остальные (timeout/network/HTTP) — временные: в failed-products.jsonl,
 *     повтор командой retry-failed.
 */
async function fetchQueue(
  session: BrowserSession,
  queue: DiscoveredProduct[],
  opts: { debug: boolean },
): Promise<{ fetched: number; notFound: number; failed: FailedProduct[] }> {
  let fetched = 0;
  let notFound = 0;
  const failed: FailedProduct[] = [];

  for (const item of queue) {
    const t0 = Date.now();
    try {
      const { raw, html } = await fetchProductViaBrowser(session.page, item.url);
      await appendJsonl(PATHS.rawJsonl, raw); // сразу на диск, в памяти не копим
      fetched++;
      if (opts.debug) await saveDebugHtml(item.externalId, html);
      ts(`product ${item.externalId}: fetched${raw.composition ? " (+состав)" : ""} (${Date.now() - t0}ms)`);
    } catch (e) {
      if (e instanceof ProductNotFoundError) {
        notFound++;
        await appendJsonl(PATHS.notFoundJsonl, {
          externalId: item.externalId,
          url: item.url,
          notFoundAt: new Date().toISOString(),
        });
        ts(`product ${item.externalId}: NOT FOUND (товар удалён) — записан в not-found-products.jsonl`);
      } else {
        const err = (e as Error).message.slice(0, 200);
        failed.push({
          externalId: item.externalId,
          url: item.url,
          error: err,
          failedAt: new Date().toISOString(),
        });
        await saveFailureArtifacts(session, item.externalId);
        ts(`product ${item.externalId}: FAILED — ${err} (debug: ${PATHS.debugDir})`);
      }
    }

    // темп ≤1 карточка/сек (+джиттер), считая от старта навигации
    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, CARD_MIN_INTERVAL_MS - elapsed) + Math.random() * CARD_JITTER_MS);
  }

  return { fetched, notFound, failed };
}

export async function runScrape(opts: ScrapeOptions): Promise<void> {
  if (!opts.all && !opts.sampleCategories && !opts.categoryUrl && !opts.productUrl && opts.limit === 0) {
    log("Укажи режим: --all | --sample-categories | --category-url <url> | --product-url <url> | --limit N");
    log("Безопасная проба: npm run magnit:scrape -- --experimental --limit 5");
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  ts(`stage 1 (scrape): только скачивание → ${path.basename(PATHS.rawJsonl)} | source=${SOURCE} | transport=playwright/${opts.headful ? "headful" : "headless"}`);

  let session: BrowserSession | null = null;
  try {
    session = await openBrowser({ headful: opts.headful });
    const page = session.page;
    await warmupSession(page, `${BASE_URL}/catalog`);

    /* ── discovery ── */
    let discovered: DiscoveredProduct[] = [];
    let categoriesFound = 0;

    if (opts.productUrl) {
      const p = canonicalProductUrl(opts.productUrl);
      if (!p) throw new Error(`не похоже на URL карточки: ${opts.productUrl}`);
      discovered = [p];
    } else if (opts.categoryUrl) {
      const res = await discoverFromCategory(page, opts.categoryUrl);
      discovered = res.products;
      if (res.declaredTotal !== null) {
        ts(`category: заявлено ${res.declaredTotal}, собрано ${discovered.length}`);
      }
    } else {
      const full = await discoverFromSitemap(page);
      if (opts.sampleCategories) {
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
        categoriesFound = cats.length;
        ts(`categories: found ${cats.length}`);
        if (opts.saveJson) await saveJson(PATHS.categoriesJson, cats);
      } catch (e) {
        ts(`categories: sitemap каталога недоступен (${(e as Error).message})`);
      }
    }

    /* ── дедуп по externalId ── */
    const byId = new Map<string, DiscoveredProduct>();
    let duplicates = 0;
    for (const p of discovered) {
      if (byId.has(p.externalId)) duplicates++;
      else byId.set(p.externalId, p);
    }
    ts(`discovery: ${discovered.length} listed, ${byId.size} unique, ${duplicates} dups`);

    /* ── resume: JSONL — источник истины о скачанном; 404 — не повторяем ── */
    const done = opts.refetch
      ? new Set<string>()
      : await readJsonlKeys(PATHS.rawJsonl, "externalId");
    const knownNotFound = opts.refetch
      ? new Set<string>()
      : await readJsonlKeys(PATHS.notFoundJsonl, "externalId");
    let queue = [...byId.values()].filter(
      (p) => !done.has(p.externalId) && !knownNotFound.has(p.externalId),
    );
    const alreadyDone = byId.size - queue.length;
    if (alreadyDone > 0) {
      ts(`resume: ${alreadyDone} карточек пропущено (уже в JSONL или в not-found-products.jsonl)`);
    }

    if (opts.offset > 0) queue = queue.slice(opts.offset);
    if (opts.limit > 0) queue = queue.slice(0, opts.limit);
    ts(`queue: ${queue.length} товаров (offset=${opts.offset}, limit=${opts.limit || "∞"}, последовательно, ~1 карточка/сек)`);
    if (opts.saveJson) await saveJson(PATHS.catalogProductsJson, queue);

    /* ── карточки ── */
    const { fetched, notFound, failed } = await fetchQueue(session, queue, { debug: opts.debug });
    for (const f of failed) await appendJsonl(PATHS.failedJsonl, f);

    /* ── отчёт ── */
    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    await saveJson(PATHS.summaryJson, {
      stage: "scrape",
      startedAt: new Date(startedAt).toISOString(),
      durationSec,
      categoriesFound,
      listed: discovered.length,
      unique: byId.size,
      duplicates,
      alreadyDone,
      queued: queue.length,
      fetched,
      notFound,
      failed: failed.length,
    });
    log("\n─── Итог (этап 1: scrape) ───");
    log(`Товаров в листингах:    ${discovered.length}`);
    log(`Уникальных товаров:     ${byId.size}`);
    log(`Пропущено (resume/404): ${alreadyDone}`);
    log(`Карточек загружено:     ${fetched}`);
    log(`Удалено с сайта (404):  ${notFound} (→ not-found-products.jsonl, не ретраятся)`);
    log(`Ошибок (→ failed):      ${failed.length}`);
    log(`Время:                  ${durationSec}s`);
    if (failed.length > 0) log(`Повтор ошибок: npm run magnit:retry-failed -- --experimental`);
  } finally {
    await closeBrowser(session);
  }
}

/* ───────── retry-failed ───────── */

export interface RetryOptions {
  limit: number;
  headful: boolean;
  debug: boolean;
}

/**
 * Отдельная команда повторной обработки failed-products.jsonl.
 * Успехи уходят в основной JSONL; остающиеся неудачи — обратно в
 * failed-products.jsonl (атомарная перезапись). Записи, чей externalId уже
 * есть в основном JSONL (успели скачаться позже), просто выбрасываются.
 */
export async function runRetryFailed(opts: RetryOptions): Promise<void> {
  const done = await readJsonlKeys(PATHS.rawJsonl, "externalId");
  const knownNotFound = await readJsonlKeys(PATHS.notFoundJsonl, "externalId");

  // последняя запись на externalId (файл append-only, свежая ошибка — в конце)
  const byId = new Map<string, FailedProduct>();
  for await (const { value } of streamJsonl<FailedProduct>(PATHS.failedJsonl)) {
    const id = value.externalId ?? canonicalProductUrl(value.url)?.externalId ?? null;
    if (!id) continue;
    byId.set(id, { ...value, externalId: id });
  }

  // выбрасываем: уже скачанные + известные 404 (их не ретраим никогда)
  const stale = [...byId.keys()].filter((id) => done.has(id) || knownNotFound.has(id));
  for (const id of stale) byId.delete(id);

  let queue: DiscoveredProduct[] = [...byId.values()].map((f) => ({
    externalId: f.externalId!,
    url: f.url,
    slug: canonicalProductUrl(f.url)?.slug ?? "",
  }));
  if (opts.limit > 0) queue = queue.slice(0, opts.limit);

  ts(`retry-failed: ${byId.size} неудачных (${stale.length} уже скачаны — убраны), в работу ${queue.length}`);
  if (byId.size === 0 && stale.length === 0) {
    log("failed-products.jsonl пуст — нечего повторять.");
    return;
  }

  let stillFailed: FailedProduct[] = [...byId.values()];
  if (queue.length > 0) {
    let session: BrowserSession | null = null;
    try {
      session = await openBrowser({ headful: opts.headful });
      await warmupSession(session.page, `${BASE_URL}/catalog`);
      const { fetched, notFound, failed } = await fetchQueue(session, queue, { debug: opts.debug });

      const retriedIds = new Set(queue.map((q) => q.externalId));
      stillFailed = [
        // не попавшие в этот прогон (за пределами --limit) — остаются как были
        ...stillFailed.filter((f) => !retriedIds.has(f.externalId!)),
        // повторно упавшие — со свежей ошибкой; оказавшиеся 404 сюда НЕ
        // возвращаются (fetchQueue уже записал их в not-found-products.jsonl)
        ...failed,
      ];
      ts(`retry-failed: ok=${fetched}, оказалось 404=${notFound}, снова упало=${failed.length}`);
    } finally {
      await closeBrowser(session);
    }
  }

  const writer = await AtomicJsonlWriter.open(PATHS.failedJsonl);
  try {
    for (const f of stillFailed) await writer.write(f);
    await writer.commit();
  } catch (e) {
    await writer.abort();
    throw e;
  }
  log(`\nfailed-products.jsonl переписан: осталось ${stillFailed.length} записей.`);
}
