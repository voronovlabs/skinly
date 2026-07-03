/**
 * goldapple.ru scraper — JSON / CSV / failed-urls export.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FailedUrl, GoldAppleProduct } from "./types";

export interface OutPaths {
  json: string;
  csv: string;
  failed: string;
}

export function buildOutPaths(outDir: string, brandSlug: string, date = new Date()): OutPaths {
  const d = date.toISOString().slice(0, 10);
  const base = `goldapple_${brandSlug}_${d}`;
  return {
    json: path.join(outDir, `${base}.json`),
    csv: path.join(outDir, `${base}.csv`),
    failed: path.join(outDir, `${base}_failed.json`),
  };
}

export async function exportJson(products: GoldAppleProduct[], filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(products, null, 2), "utf8");
}

export async function exportFailed(failed: FailedUrl[], filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(failed, null, 2), "utf8");
}

const CSV_COLUMNS: Array<keyof GoldAppleProduct> = [
  "source_url",
  "product_id",
  "sku",
  "offer_id",
  "brand",
  "product_name",
  "category",
  "breadcrumbs",
  "price",
  "old_price",
  "discount",
  "currency",
  "availability",
  "rating",
  "reviews_count",
  "images",
  "description",
  "usage",
  "ingredients",
  "volume",
  "country",
  "skin_type",
  "product_type",
  "effect",
  "age",
  "line",
  "gender",
  "tags",
  "attributes",
  "scraped_at",
];

function csvCell(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) s = "";
  else if (Array.isArray(value)) s = value.join(" | ");
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportCsv(products: GoldAppleProduct[], filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const header = CSV_COLUMNS.join(",");
  const rows = products.map((p) => CSV_COLUMNS.map((c) => csvCell(p[c])).join(","));
  // BOM so Excel opens cyrillic UTF-8 correctly
  await writeFile(filePath, "﻿" + [header, ...rows].join("\n"), "utf8");
}
