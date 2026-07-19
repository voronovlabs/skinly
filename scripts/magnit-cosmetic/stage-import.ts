/**
 * ЭТАП 5 — импорт в Postgres. Единственный этап, который трогает БД.
 *
 * Потоково читает normalized-products.jsonl, подменяет временный barcode
 * `mc:<externalId>` на настоящий EAN из matches-JSONL этапа 4 (только
 * status=matched + валидная контрольная сумма; один EAN не выдаётся двум
 * товарам) и пишет через существующий upsertProduct() (merge-правила db.ts:
 * настоящий barcode не перезаписывается, локализованные картинки не
 * трогаются и т.д.).
 *
 * Перед записью предупреждает, если импортируются товары с внешними
 * изображениями или временными barcode — значит этапы 3/4 прошли не до конца.
 */

import * as path from "node:path";
import { BARCODE_PREFIX, PATHS, SOURCE } from "./config";
import { closeDb, upsertProduct } from "./db";
import { log, ts } from "./logger";
import { isValidEan } from "./normalize";
import { saveJson, streamJsonl } from "./storage";
import type { BarcodeMatchLine, NormalizedMagnitProduct, UpsertResult } from "./types";

export interface ImportOptions {
  limit: number;
  dryRun: boolean;
  force: boolean;
}

/** externalId → EAN: только уверенные валидные матчи, последняя запись на id. */
async function loadBarcodeMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for await (const { value } of streamJsonl<BarcodeMatchLine>(PATHS.barcodeMatchesJsonl)) {
    if (!value?.externalId) continue;
    if (value.status === "matched" && value.barcode && isValidEan(value.barcode)) {
      map.set(value.externalId, value.barcode);
    } else {
      map.delete(value.externalId); // более свежая запись понизила статус
    }
  }
  return map;
}

export async function runImport(opts: ImportOptions): Promise<void> {
  const startedAt = Date.now();
  ts(`stage 5 (import): ${path.basename(PATHS.normalizedJsonl)} → Prisma Product | mode=${opts.dryRun ? "DRY-RUN" : "запись в БД"} | source=${SOURCE}`);

  const eanByid = await loadBarcodeMap();
  ts(`import: EAN-кандидатов (matched, валидные): ${eanByid.size}`);

  const stats: Record<UpsertResult, number> & {
    total: number; eanApplied: number; eanConflicts: number;
    tempBarcode: number; externalImage: number; dbErrors: number;
  } = {
    created: 0, updated: 0, unchanged: 0,
    total: 0, eanApplied: 0, eanConflicts: 0,
    tempBarcode: 0, externalImage: 0, dbErrors: 0,
  };
  const usedEans = new Set<string>();
  let shown = 0;

  try {
    for await (const { value } of streamJsonl<NormalizedMagnitProduct>(PATHS.normalizedJsonl)) {
      if (opts.limit > 0 && stats.total >= opts.limit) break;
      stats.total++;
      const p: NormalizedMagnitProduct = { ...value };

      /* — подмена временного barcode на найденный EAN — */
      if (p.barcode.startsWith(BARCODE_PREFIX)) {
        const ean = eanByid.get(p.externalId);
        if (ean && !usedEans.has(ean)) {
          p.barcode = ean;
          stats.eanApplied++;
        } else if (ean) {
          stats.eanConflicts++; // тот же EAN уже выдан другому товару — оставляем mc:
          ts(`product ${p.externalId}: EAN ${ean} уже применён к другому товару — оставляю ${BARCODE_PREFIX}${p.externalId}`);
        }
      }
      if (p.barcode.startsWith(BARCODE_PREFIX)) stats.tempBarcode++;
      usedEans.add(p.barcode);
      if (p.imageUrl && /^https?:\/\//i.test(p.imageUrl)) stats.externalImage++;

      if (opts.dryRun) {
        if (shown < 5) {
          shown++;
          const { rawComposition, sourceUrl, breadcrumbs, ...productRow } = p;
          log(JSON.stringify(productRow, null, 2));
          log(`  breadcrumbs: ${breadcrumbs.join(" / ") || "—"}`);
          log(`  состав: ${rawComposition ? rawComposition.slice(0, 120) + "…" : "—"}`);
          log(`  url: ${sourceUrl}\n`);
        }
        continue;
      }

      try {
        const result = await upsertProduct(p, { force: opts.force });
        stats[result]++;
        ts(`product ${p.externalId}: ${result}`);
      } catch (e) {
        stats.dbErrors++;
        ts(`product ${p.externalId}: DB ERROR — ${(e as Error).message}`);
      }
    }
  } finally {
    await closeDb();
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  await saveJson(PATHS.summaryJson, {
    stage: "import",
    mode: opts.dryRun ? "dry-run" : "import",
    startedAt: new Date(startedAt).toISOString(),
    durationSec,
    ...stats,
  });

  log("\n─── Итог (этап 5: import) ───");
  log(`Товаров обработано:     ${stats.total}`);
  log(`EAN применён:           ${stats.eanApplied} (конфликтов: ${stats.eanConflicts})`);
  if (!opts.dryRun) {
    log(`Создано в БД:           ${stats.created}`);
    log(`Обновлено в БД:         ${stats.updated}`);
    log(`Без изменений:          ${stats.unchanged}`);
    log(`Ошибок БД:              ${stats.dbErrors}`);
  }
  log(`Время:                  ${durationSec}s`);
  if (stats.tempBarcode > 0) {
    log(`⚠ ${stats.tempBarcode} товаров ушло с временным barcode ${BARCODE_PREFIX}<id> — этап 4 не покрыл их (это допустимо: EAN подтянется повторным import после barcodes).`);
  }
  if (stats.externalImage > 0) {
    log(`⚠ ${stats.externalImage} товаров с внешним imageUrl — этап 3 (magnit:images) прошёл не полностью.`);
  }
}
