/**
 * ЭТАП 4 — поиск настоящих EAN/GTIN. Никакой БД.
 *
 * Для товаров с временным barcode `mc:<externalId>` ищет настоящий штрихкод
 * на barcode-list.ru (тот же проверенный клиент/скоринг, что у
 * enrich-farera-barcodes: scripts/farera/barcode-list — rate-limit 1 запрос
 * в 2–3 сек, retry, score/classify). Результаты — ENRICHMENT-кандидаты,
 * append-only в data/raw/magnit-cosmetic-barcode-matches.jsonl.
 *
 * Multi-query fallback: для каждого товара строится до 3 запросов от
 * строгого к широкому (query-builder.ts: бренд без дубля, объём отдельно,
 * без служебных слов). Запросы пробуются по очереди; первый matched
 * останавливает перебор; ambiguous-кандидаты со всех запросов объединяются;
 * not_found — только если ВСЕ запросы вернули пустой список.
 *
 * Resume — из самого matches-JSONL: у externalId берётся ПОСЛЕДНИЙ статус
 * (файл append-only, повторные строки допустимы; import тоже берёт
 * последнюю). Повтор: --retry-errors / --retry-not-found / --retry-ambiguous.
 * Замена mc:-barcode на найденный EAN происходит на этапе 5 (import) —
 * только для status=matched с валидной контрольной суммой.
 */

import * as path from "node:path";
import {
  classifyCandidates,
  fetchSearchHtml,
  parseSearchResults,
  type BarcodeCandidate,
  type ClassifyResult,
} from "../farera/barcode-list";
import { BARCODE_PREFIX, PATHS } from "./config";
import { log, ts } from "./logger";
import { buildSearchQueries } from "./query-builder";
import { appendJsonl, saveJson, streamJsonl } from "./storage";
import type { BarcodeMatchLine, NormalizedMagnitProduct } from "./types";

/** Сколько кандидатов сохранять в строке матча (как у farera). */
const MAX_CANDIDATES_OUT = 8;

export interface BarcodesOptions {
  /** Ограничение по ЧИСЛУ ТОВАРОВ (не HTTP-запросов). 0 = без лимита. */
  limit: number;
  /** Не ходить на barcode-list.ru: показать сгенерированные запросы, ничего не писать. */
  dryRun: boolean;
  /** Повторить товары, у которых последний статус = error. */
  retryErrors: boolean;
  /** Повторить товары, у которых последний статус = not_found. */
  retryNotFound: boolean;
  /** Повторить товары, у которых последний статус = ambiguous. */
  retryAmbiguous: boolean;
}

function shouldRetry(
  prev: BarcodeMatchLine["status"],
  opts: BarcodesOptions,
): boolean {
  return (
    (opts.retryErrors && prev === "error") ||
    (opts.retryNotFound && prev === "not_found") ||
    (opts.retryAmbiguous && prev === "ambiguous")
  );
}

export async function runBarcodes(opts: BarcodesOptions): Promise<void> {
  const startedAt = Date.now();
  ts(`stage 4 (barcodes): ${path.basename(PATHS.normalizedJsonl)} → ${path.basename(PATHS.barcodeMatchesJsonl)}${opts.dryRun ? " (dry-run)" : ""}`);

  // resume: externalId → ПОСЛЕДНИЙ статус (маленькая Map, записи не держим).
  // JSONL append-only: повторные строки на externalId допустимы, побеждает
  // последняя (import читает так же).
  const doneStatus = new Map<string, BarcodeMatchLine["status"]>();
  for await (const { value } of streamJsonl<BarcodeMatchLine>(PATHS.barcodeMatchesJsonl)) {
    if (value?.externalId) doneStatus.set(value.externalId, value.status);
  }

  const stats = {
    scanned: 0,
    realBarcode: 0,
    alreadyDone: 0,
    processed: 0,
    httpSearches: 0,
    matched: 0,
    matchedFirstQuery: 0,
    matchedFallback: 0,
    ambiguous: 0,
    notFound: 0,
    errors: 0,
  };

  for await (const { value: p } of streamJsonl<NormalizedMagnitProduct>(PATHS.normalizedJsonl)) {
    stats.scanned++;
    if (!p.barcode?.startsWith(BARCODE_PREFIX)) {
      stats.realBarcode++; // настоящий EAN уже есть (gtin из JSON-LD)
      continue;
    }
    const prev = doneStatus.get(p.externalId);
    if (prev && !shouldRetry(prev, opts)) {
      stats.alreadyDone++;
      continue;
    }
    // --limit ограничивает ТОВАРЫ, не HTTP-запросы.
    if (opts.limit > 0 && stats.processed >= opts.limit) continue;
    stats.processed++;

    const brand = p.brand && p.brand !== "Unknown" ? p.brand : null;
    const { queries, volume } = buildSearchQueries(brand, p.name);

    if (opts.dryRun) {
      ts(`barcode ${p.externalId}: "${p.name.slice(0, 80)}" volume=${volume ?? "—"}`);
      queries.forEach((q, i) => log(`    query ${i + 1}/${queries.length}: "${q}"`));
      continue;
    }

    // ── multi-query fallback ──
    const queriesTried: string[] = [];
    let matched: { res: ClassifyResult; index: number } | null = null;
    let bestAmbiguous: { res: ClassifyResult; index: number } | null = null;
    // Объединённый пул кандидатов со всех запросов: barcode → лучший score.
    const pool = new Map<string, BarcodeCandidate>();
    let fetchErrors = 0;
    let lastError = "";

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      queriesTried.push(q);
      ts(`barcode ${p.externalId}: try ${i + 1}/${queries.length} query="${q}"`);
      stats.httpSearches++;
      let res: ClassifyResult;
      try {
        const html = await fetchSearchHtml(q, ts); // rate-limit внутри клиента
        const candidates = parseSearchResults(html);
        res = classifyCandidates({ brand, title: p.name, volume }, candidates);
      } catch (e) {
        // Сетевая ошибка одного query не хоронит товар — пробуем следующий.
        fetchErrors++;
        lastError = (e as Error).message.slice(0, 200);
        ts(`barcode ${p.externalId}: query ${i + 1} ERROR — ${lastError}`);
        continue;
      }
      for (const c of res.candidates) {
        const known = pool.get(c.barcode);
        if (!known || (c.score ?? 0) > (known.score ?? 0)) pool.set(c.barcode, c);
      }
      if (res.status === "matched") {
        matched = { res, index: i };
        break; // уверенный матч — дальше не ищем
      }
      if (
        res.status === "ambiguous" &&
        (!bestAmbiguous || res.score > bestAmbiguous.res.score)
      ) {
        bestAmbiguous = { res, index: i };
      }
    }

    const common = {
      source: "barcode-list" as const,
      externalId: p.externalId,
      queriesTried,
      volume,
      enrichedAt: new Date().toISOString(),
    };
    let line: BarcodeMatchLine;

    if (matched) {
      const { res, index } = matched;
      line = {
        ...common,
        query: queries[index],
        matchedQueryIndex: index,
        status: "matched",
        barcode: res.barcode,
        matchedName: res.matchedName,
        score: res.score,
        candidates: res.candidates.slice(0, MAX_CANDIDATES_OUT),
      };
      stats.matched++;
      if (index === 0) stats.matchedFirstQuery++;
      else stats.matchedFallback++;
      ts(`barcode ${p.externalId}: matched ${res.barcode} (score ${res.score}) via query ${index + 1}`);
    } else if (bestAmbiguous) {
      // Лучший ambiguous по score; кандидаты — объединение всех запросов,
      // дедуп по barcode, топ по score.
      const merged = [...pool.values()]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, MAX_CANDIDATES_OUT);
      line = {
        ...common,
        query: queries[bestAmbiguous.index],
        matchedQueryIndex: bestAmbiguous.index,
        status: "ambiguous",
        barcode: null,
        matchedName: null,
        score: bestAmbiguous.res.score,
        candidates: merged,
      };
      stats.ambiguous++;
      ts(`barcode ${p.externalId}: ambiguous (best score ${bestAmbiguous.res.score}, кандидатов ${merged.length}) via query ${bestAmbiguous.index + 1}`);
    } else if (fetchErrors > 0 && fetchErrors === queriesTried.length) {
      // ВСЕ запросы упали сетевыми ошибками и ни один не дал кандидатов.
      line = {
        ...common,
        query: queries[0],
        matchedQueryIndex: null,
        status: "error",
        barcode: null,
        matchedName: null,
        score: 0,
        candidates: [],
        error: lastError,
      };
      stats.errors++;
      ts(`barcode ${p.externalId}: ERROR — ${lastError} (повтор: --retry-errors)`);
    } else {
      // Все запросы вернули пустой список кандидатов.
      line = {
        ...common,
        query: queries[0],
        matchedQueryIndex: null,
        status: "not_found",
        barcode: null,
        matchedName: null,
        score: 0,
        candidates: [],
      };
      stats.notFound++;
      ts(`barcode ${p.externalId}: not_found (${queriesTried.length} queries) (повтор: --retry-not-found)`);
    }
    await appendJsonl(PATHS.barcodeMatchesJsonl, line); // сразу на диск
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  const avgQueries =
    stats.processed > 0 && !opts.dryRun
      ? Math.round((stats.httpSearches / stats.processed) * 100) / 100
      : 0;
  await saveJson(PATHS.summaryJson, {
    stage: "barcodes",
    startedAt: new Date(startedAt).toISOString(),
    durationSec,
    ...stats,
    avgQueriesPerProduct: avgQueries,
  });
  log("\n─── Итог (этап 4: barcodes) ───");
  log(`Записей просмотрено:    ${stats.scanned}`);
  log(`Уже с настоящим EAN:    ${stats.realBarcode}`);
  log(`Уже обработано ранее:   ${stats.alreadyDone}`);
  log(`Товаров обработано:     ${stats.processed}`);
  if (!opts.dryRun) {
    log(`HTTP-запросов к barcode-list.ru: ${stats.httpSearches}`);
    log(`Среднее запросов/товар: ${avgQueries}`);
  }
  log(`matched:                ${stats.matched}`);
  log(`  на первом запросе:    ${stats.matchedFirstQuery}`);
  log(`  через fallback:       ${stats.matchedFallback}`);
  log(`ambiguous:              ${stats.ambiguous}`);
  log(`not_found:              ${stats.notFound}`);
  log(`Ошибок:                 ${stats.errors}`);
  log(`Время:                  ${durationSec}s`);
  log("\nЭто enrichment-кандидаты, не истина: на этапе 5 применяются только status=matched с валидной контрольной суммой.");
}
