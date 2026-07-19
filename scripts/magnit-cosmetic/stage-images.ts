/**
 * ЭТАП 3 — локализация изображений. Никакой БД.
 *
 * Потоково читает normalized-products.jsonl; для каждой записи с внешним
 * imageUrl скачивает файл в локальное хранилище проекта
 * (storage/product-images — формат scripts/migrate-product-images.ts:
 * <dir>/ab/cd/<sha256(url)>.<ext>) и заменяет imageUrl на внутренний URL
 * `/product-images/ab/cd/<hash>.<ext>`. Исходный URL остаётся в
 * sourceImageUrl. Файл переписывается атомарно (.part → rename).
 *
 * Идемпотентно: уже локализованные записи (imageUrl не http) пропускаются;
 * уже лежащий на диске файл повторно не скачивается. Ошибка скачивания не
 * ломает проход: запись остаётся с внешним URL + строка в failed-images.jsonl
 * (следующий запуск попробует снова).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  IMAGE_FETCH_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_BYTES,
  IMAGE_MIN_INTERVAL_MS,
  IMAGE_RETRIES,
  IMAGE_URL_PREFIX,
  PATHS,
  REQUEST_HEADERS,
} from "./config";
import { log, ts } from "./logger";
import { AtomicJsonlWriter, appendJsonl, saveJson, streamJsonl } from "./storage";
import type { NormalizedMagnitProduct } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ImagesOptions {
  limit: number;
  /** База публичного URL; "" → относительный /product-images/... */
  publicBaseUrl: string;
  dryRun: boolean;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};
const KNOWN_EXTS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];

function isExternalUrl(u: string | null): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function hashedRelPath(url: string, ext: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return path.join(hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ext}`);
}

/** Уже скачан? Возвращает относительный путь существующего файла или null. */
async function findExisting(url: string): Promise<string | null> {
  for (const ext of KNOWN_EXTS) {
    const rel = hashedRelPath(url, ext);
    try {
      const st = await fs.stat(path.join(PATHS.imagesDir, rel));
      if (st.size >= IMAGE_MIN_BYTES) return rel;
    } catch {
      /* нет — пробуем следующий ext */
    }
  }
  return null;
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(jpe?g|png|webp|avif|gif)(?:$|[?#])/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

/** Скачивание с таймаутом/повторами; атомарная запись .part → rename. */
async function downloadImage(url: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= IMAGE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": REQUEST_HEADERS["user-agent"], accept: "image/*,*/*;q=0.8" },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = EXT_BY_TYPE[type] ?? extFromUrl(url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < IMAGE_MIN_BYTES) throw new Error(`too small (${buf.byteLength}B)`);
      if (buf.byteLength > IMAGE_MAX_BYTES) throw new Error(`too big (${buf.byteLength}B)`);

      const rel = hashedRelPath(url, ext);
      const abs = path.join(PATHS.imagesDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(`${abs}.part`, buf);
      await fs.rename(`${abs}.part`, abs);
      return rel;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < IMAGE_RETRIES) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("download failed");
}

export async function runImages(opts: ImagesOptions): Promise<void> {
  const startedAt = Date.now();
  const base = opts.publicBaseUrl.replace(/\/+$/, "");
  ts(`stage 3 (images): ${path.basename(PATHS.normalizedJsonl)} → ${PATHS.imagesDir} (base="${base || "(relative)"}"${opts.dryRun ? ", dry-run" : ""})`);

  const stats = { total: 0, localized: 0, reused: 0, alreadyLocal: 0, noImage: 0, failed: 0 };
  let attempts = 0; // лимит считает ПОПЫТКИ (включая неудачные), иначе при сбоях сети --limit не работает

  const writer = opts.dryRun ? null : await AtomicJsonlWriter.open(PATHS.normalizedJsonl);
  try {
    for await (const { value: p } of streamJsonl<NormalizedMagnitProduct>(PATHS.normalizedJsonl)) {
      stats.total++;
      let out = p;

      const withinLimit = opts.limit === 0 || attempts < opts.limit;
      if (!isExternalUrl(p.imageUrl)) {
        if (p.imageUrl) stats.alreadyLocal++;
        else stats.noImage++;
      } else if (withinLimit) {
        attempts++;
        const src = p.sourceImageUrl && isExternalUrl(p.sourceImageUrl) ? p.sourceImageUrl : p.imageUrl;
        try {
          const existing = await findExisting(src);
          let rel: string;
          if (existing) {
            rel = existing;
            stats.reused++;
          } else if (opts.dryRun) {
            rel = hashedRelPath(src, extFromUrl(src));
            stats.localized++;
          } else {
            const t0 = Date.now();
            rel = await downloadImage(src);
            stats.localized++;
            ts(`image ${p.externalId}: downloaded ${rel} (${Date.now() - t0}ms)`);
            await sleep(IMAGE_MIN_INTERVAL_MS);
          }
          // imageUrl → внутренний URL; исходный остаётся в sourceImageUrl
          out = {
            ...p,
            imageUrl: `${base}${IMAGE_URL_PREFIX}/${rel.split(path.sep).join("/")}`,
            sourceImageUrl: src,
          };
        } catch (e) {
          stats.failed++;
          const err = (e as Error).message.slice(0, 200);
          if (!opts.dryRun) {
            await appendJsonl(PATHS.imagesFailedJsonl, {
              externalId: p.externalId,
              url: src,
              error: err,
              failedAt: new Date().toISOString(),
            });
          }
          ts(`image ${p.externalId}: FAILED — ${err} (imageUrl оставлен внешним)`);
        }
      }

      if (writer) await writer.write(out);
    }
    if (writer) await writer.commit();
  } catch (e) {
    if (writer) await writer.abort();
    throw e;
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  await saveJson(PATHS.summaryJson, {
    stage: "images",
    startedAt: new Date(startedAt).toISOString(),
    durationSec,
    ...stats,
  });
  log("\n─── Итог (этап 3: images) ───");
  log(`Записей:                ${stats.total}`);
  log(`Скачано:                ${stats.localized}`);
  log(`Переиспользовано:       ${stats.reused} (файл уже на диске)`);
  log(`Уже локальные:          ${stats.alreadyLocal}`);
  log(`Без изображения:        ${stats.noImage}`);
  log(`Ошибок:                 ${stats.failed} (→ failed-images.jsonl, повтор — следующий запуск)`);
  log(`Время:                  ${durationSec}s`);
}
