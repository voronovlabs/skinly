/**
 * ЭТАП 4 — поиск настоящих EAN/GTIN. Никакой БД.
 *
 * Для товаров с временным barcode `mc:<externalId>` ищет настоящий штрихкод
 * на barcode-list.ru (тот же проверенный клиент/скоринг, что у
 * enrich-farera-barcodes: scripts/farera/barcode-list — rate-limit 1 запрос
 * в 2–3 сек, retry, score/classify). Результаты — ENRICHMENT-кандидаты,
 * append-only в data/raw/magnit-cosmetic-barcode-matches.jsonl.
 *
 * Resume — из самого matches-JSONL: уже обработанные externalId повторно не
 * запрашиваются (status=error можно повторить флагом --retry-errors).
 * Замена mc:-barcode на найденный EAN происходит на этапе 5 (import) —
 * только для status=matched с валидной контрольной суммой.
 */

import * as path from "node:path";
import {
  classifyCandidates,
  fetchSearchHtml,
  parseSearchResults,
} from "../farera/barcode-list";
import { BARCODE_PREFIX, PATHS } from "./config";
import { log, ts } from "./logger";
import { appendJsonl, saveJson, streamJsonl } from "./storage";
import type { BarcodeMatchLine, NormalizedMagnitProduct } from "./types";

/** Сколько кандидатов сохранять в строке матча (как у farera). */
const MAX_CANDIDATES_OUT = 8;

export interface BarcodesOptions {
  limit: number;
  dryRun: boolean;
  /** Повторить товары, у которых прошлый запуск закончился status=error. */
  retryErrors: boolean;
}

export async function runBarcodes(opts: BarcodesOptions): Promise<void> {
  const startedAt = Date.now();
  ts(`stage 4 (barcodes): ${path.basename(PATHS.normalizedJsonl)} → ${path.basename(PATHS.barcodeMatchesJsonl)}${opts.dryRun ? " (dry-run)" : ""}`);

  // resume: externalId → последний статус (маленькая Map, записи не держим)
  const doneStatus = new Map<string, BarcodeMatchLine["status"]>();
  for await (const { value } of streamJsonl<BarcodeMatchLine>(PATHS.barcodeMatchesJsonl)) {
    if (value?.externalId) doneStatus.set(value.externalId, value.status);
  }

  const stats = { scanned: 0, realBarcode: 0, alreadyDone: 0, queried: 0, matched: 0, ambiguous: 0, notFound: 0, errors: 0 };

  for await (const { value: p } of streamJsonl<NormalizedMagnitProduct>(PATHS.normalizedJsonl)) {
    stats.scanned++;
    if (!p.barcode?.startsWith(BARCODE_PREFIX)) {
      stats.realBarcode++; // настоящий EAN уже есть (gtin из JSON-LD)
      continue;
    }
    const prev = doneStatus.get(p.externalId);
    if (prev && !(opts.retryErrors && prev === "error")) {
      stats.alreadyDone++;
      continue;
    }
    if (opts.limit > 0 && stats.queried >= opts.limit) continue;

    const brand = p.brand && p.brand !== "Unknown" ? p.brand : null;
    const query = [brand, p.name].filter(Boolean).join(" ").trim();
    stats.queried++;

    if (opts.dryRun) {
      ts(`barcode ${p.externalId}: query="${query.slice(0, 100)}"`);
      continue;
    }

    let line: BarcodeMatchLine;
    try {
      const html = await fetchSearchHtml(query, ts); // rate-limit внутри клиента
      const candidates = parseSearchResults(html);
      const res = classifyCandidates({ brand, title: p.name, volume: null }, candidates);
      line = {
        source: "barcode-list",
        externalId: p.externalId,
        query,
        status: res.status,
        barcode: res.barcode,
        matchedName: res.matchedName,
        score: res.score,
        candidates: res.candidates.slice(0, MAX_CANDIDATES_OUT),
        enrichedAt: new Date().toISOString(),
      };
      if (res.status === "matched") stats.matched++;
      else if (res.status === "ambiguous") stats.ambiguous++;
      else stats.notFound++;
      ts(`barcode ${p.externalId}: ${res.status}${res.barcode ? ` ${res.barcode} (score ${res.score})` : ""}`);
    } catch (e) {
      stats.errors++;
      const err = (e as Error).message.slice(0, 200);
      line = {
        source: "barcode-list",
        externalId: p.externalId,
        query,
        status: "error",
        barcode: null,
        matchedName: null,
        score: 0,
        candidates: [],
        error: err,
        enrichedAt: new Date().toISOString(),
      };
      ts(`barcode ${p.externalId}: ERROR — ${err} (повтор: --retry-errors)`);
    }
    await appendJsonl(PATHS.barcodeMatchesJsonl, line); // сразу на диск
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  await saveJson(PATHS.summaryJson, {
    stage: "barcodes",
    startedAt: new Date(startedAt).toISOString(),
    durationSec,
    ...stats,
  });
  log("\n─── Итог (этап 4: barcodes) ───");
  log(`Записей просмотрено:    ${stats.scanned}`);
  log(`Уже с настоящим EAN:    ${stats.realBarcode}`);
  log(`Уже обработано ранее:   ${stats.alreadyDone}`);
  log(`Запросов сделано:       ${stats.queried}`);
  log(`matched:                ${stats.matched}`);
  log(`ambiguous:              ${stats.ambiguous}`);
  log(`not_found:              ${stats.notFound}`);
  log(`Ошибок:                 ${stats.errors}`);
  log(`Время:                  ${durationSec}s`);
  log("\nЭто enrichment-кандидаты, не истина: на этапе 5 применяются только status=matched с валидной контрольной суммой.");
}
