/**
 * ЭТАП 2 — нормализация. Никакой БД, никакого браузера.
 *
 * Читает append-only data/raw/magnit-cosmetic-products.jsonl потоково и
 * строит data/magnit-cosmetic/normalized-products.jsonl (атомарная
 * перезапись). Пропущенные (не-косметика/мусор) — в skipped-products.jsonl.
 *
 * Дедуп: JSONL append-only, при --refetch появляются повторные записи одного
 * externalId — берётся ПОСЛЕДНЯЯ (самая свежая). Реализовано двумя потоковыми
 * проходами: в памяти держится только Map<externalId, номер строки>.
 *
 * Идемпотентно и дёшево: перезапускается сколько угодно раз.
 */

import * as path from "node:path";
import { classifyOtherReason } from "./categories";
import { PATHS } from "./config";
import { log, ts } from "./logger";
import { normalizeProduct } from "./normalize";
import { AtomicJsonlWriter, saveJson, streamJsonl } from "./storage";
import type { RawMagnitProduct } from "./types";

export interface NormalizeOptions {
  limit: number;
  /** Печатать каждое решение (mapped/skipped) — для отладки. */
  verbose: boolean;
}

export async function runNormalize(opts: NormalizeOptions): Promise<void> {
  const startedAt = Date.now();
  ts(`stage 2 (normalize): ${path.basename(PATHS.rawJsonl)} → ${path.basename(PATHS.normalizedJsonl)}`);

  /* ── проход 1: последняя строка каждого externalId ── */
  const lastLine = new Map<string, number>();
  let totalLines = 0;
  for await (const { value, line } of streamJsonl<RawMagnitProduct>(PATHS.rawJsonl)) {
    totalLines++;
    if (value?.externalId) lastLine.set(value.externalId, line);
  }
  ts(`normalize: ${totalLines} строк JSONL, ${lastLine.size} уникальных товаров (берём последнюю запись каждого)`);
  if (lastLine.size === 0) {
    log("Сырой JSONL пуст — сначала запусти этап 1 (magnit:scrape).");
    process.exitCode = 1;
    return;
  }

  /* ── проход 2: нормализация потоком ── */
  const stats = {
    normalized: 0,
    skipped: 0,
    skippedNotBeauty: 0,
    noBrand: 0,
    noImage: 0,
    noDescription: 0,
    noCategory: 0,
    other: { hair: 0, makeup: 0, deodorant: 0, shaving: 0, kids_hygiene: 0, other: 0 },
  };

  const outWriter = await AtomicJsonlWriter.open(PATHS.normalizedJsonl);
  const skipWriter = await AtomicJsonlWriter.open(PATHS.skippedJsonl);
  let processed = 0;
  try {
    for await (const { value: raw, line } of streamJsonl<RawMagnitProduct>(PATHS.rawJsonl)) {
      if (!raw?.externalId || lastLine.get(raw.externalId) !== line) continue; // не последняя запись
      if (opts.limit > 0 && processed >= opts.limit) break;
      processed++;

      const res = normalizeProduct(raw);
      if (res.flags.noBrand) stats.noBrand++;
      if (res.flags.noImage) stats.noImage++;
      if (res.flags.noDescription) stats.noDescription++;
      if (res.flags.noCategory) stats.noCategory++;

      if (res.skip) {
        stats.skipped++;
        if (res.skip.reason === "not beauty-relevant") stats.skippedNotBeauty++;
        await skipWriter.write(res.skip);
        if (opts.verbose) {
          ts(`product ${res.skip.externalId}: skipped — ${res.skip.reason}${res.skip.detail ? ` (${res.skip.detail.slice(0, 60)})` : ""}`);
        }
        continue;
      }
      if (res.product) {
        stats.normalized++;
        await outWriter.write(res.product); // сразу на диск, массив не копим
        if (res.product.category === "OTHER") {
          stats.other[classifyOtherReason(res.product.breadcrumbs, res.product.name)]++;
        }
        if (opts.verbose) {
          ts(`product ${res.product.externalId}: mapped to ${res.product.category}`);
        }
      }
    }
    await outWriter.commit();
    await skipWriter.commit();
  } catch (e) {
    await outWriter.abort();
    await skipWriter.abort();
    throw e;
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  await saveJson(PATHS.summaryJson, {
    stage: "normalize",
    startedAt: new Date(startedAt).toISOString(),
    durationSec,
    rawLines: totalLines,
    uniqueProducts: lastLine.size,
    processed,
    ...stats,
  });

  log("\n─── Итог (этап 2: normalize) ───");
  log(`Строк в raw JSONL:      ${totalLines}`);
  log(`Уникальных товаров:     ${lastLine.size}`);
  log(`Нормализовано:          ${stats.normalized}`);
  log(`Пропущено:              ${stats.skipped} (из них не-косметика: ${stats.skippedNotBeauty})`);
  log(`Без бренда:             ${stats.noBrand}`);
  log(`Без изображения:        ${stats.noImage}`);
  log(`Без описания:           ${stats.noDescription}`);
  log(`Без категории (OTHER):  ${stats.noCategory}`);
  log("─── OTHER по причинам (enum не покрывает) ───");
  log(`  волосы: ${stats.other.hair}  макияж: ${stats.other.makeup}  дезодоранты: ${stats.other.deodorant}`);
  log(`  бритьё: ${stats.other.shaving}  детская гигиена: ${stats.other.kids_hygiene}  прочее: ${stats.other.other}`);
  log(`Время:                  ${durationSec}s`);
}
