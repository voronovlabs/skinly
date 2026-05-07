import type { HistoryBucket, ScanRecord } from "@/lib/types";
import { findProductById } from "@/lib/mock";
import type { DemoScan, DemoState } from "./types";

/* ───────── Производные данные ───────── */

const DAY_MS = 24 * 60 * 60 * 1000;

export function bucketFromTimestamp(ts: number, now = Date.now()): HistoryBucket {
  const diff = now - ts;
  if (diff < DAY_MS) return "today";
  if (diff < 2 * DAY_MS) return "yesterday";
  if (diff < 7 * DAY_MS) return "week";
  return "older";
}

/** Конвертирует demo-сканы в формат `ScanRecord`, понятный UI-компонентам. */
export function demoScansToScanRecords(scans: DemoScan[]): ScanRecord[] {
  const now = Date.now();
  const records: ScanRecord[] = [];
  for (const s of scans) {
    const product = findProductById(s.productId);
    if (!product) continue;
    records.push({
      id: s.id,
      productId: s.productId,
      product,
      scannedAt: new Date(s.scannedAt),
      bucket: bucketFromTimestamp(s.scannedAt, now),
    });
  }
  return records;
}

/* ───────── Stats ───────── */

export interface DemoStats {
  scans: number;
  products: number;
  avgMatch: number;
}

export function computeDemoStats(state: DemoState): DemoStats {
  const scans = state.history.length;
  const productIds = new Set(state.history.map((s) => s.productId));
  const scores: number[] = [];
  for (const id of productIds) {
    const p = findProductById(id);
    if (p) scores.push(p.matchScore);
  }
  const avgMatch =
    scores.length === 0
      ? 0
      : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { scans, products: productIds.size, avgMatch };
}
