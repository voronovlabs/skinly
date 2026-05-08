/**
 * Хранение: JSONL для продуктов, JSON-checkpoint для resume.
 *
 * JSONL: одна запись = одна строка JSON. Append-only — безопасно
 * добавлять, можно построчно стримить через jq:
 *   jq -c . < data/raw/national-catalog-products.jsonl | head
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PATHS } from "./config";
import type { Checkpoint, ScrapedProduct } from "./types";

const PRODUCTS_FILE = path.resolve(PATHS.rawProductsJsonl);
const CHECKPOINT_FILE = path.resolve(PATHS.checkpoint);

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.dirname(PRODUCTS_FILE), { recursive: true });
  await fs.mkdir(path.dirname(CHECKPOINT_FILE), { recursive: true });
}

export async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const raw = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    const now = new Date().toISOString();
    return {
      discoveredUrls: [],
      processedUrls: [],
      failed: [],
      startedAt: now,
      updatedAt: now,
    };
  }
}

export async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  cp.updatedAt = new Date().toISOString();
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

/**
 * Возвращает сразу два set'а:
 *   - sourceUrls (path-only) уже сохранённых товаров
 *   - barcodes уже сохранённых товаров
 *
 * Используется для дедупликации перед записью.
 */
export async function loadExistingKeys(): Promise<{
  urls: Set<string>;
  barcodes: Set<string>;
}> {
  const urls = new Set<string>();
  const barcodes = new Set<string>();
  try {
    const raw = await fs.readFile(PRODUCTS_FILE, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Partial<ScrapedProduct>;
        if (obj.sourceUrl) {
          // store path-only for cross-comparison with discovery
          try {
            const u = new URL(obj.sourceUrl);
            urls.add(u.pathname);
          } catch {
            urls.add(obj.sourceUrl);
          }
        }
        if (obj.barcode) barcodes.add(obj.barcode);
      } catch {
        /* битая строка — пропускаем */
      }
    }
  } catch {
    /* файла нет — норм */
  }
  return { urls, barcodes };
}

export async function appendProduct(p: ScrapedProduct): Promise<void> {
  await fs.appendFile(PRODUCTS_FILE, JSON.stringify(p) + "\n");
}
