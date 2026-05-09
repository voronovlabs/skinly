/**
 * Хранение: JSONL для продуктов, JSON-checkpoint для resume,
 * + Postgres raw layer (NationalCatalogRawProduct).
 *
 * JSONL остаётся как ground-truth append-only лог (легко стримить через jq,
 * легко восстановить БД). Postgres — индексируемое зеркало для нормализатора.
 *
 * Прогон скрейпера сохраняет КАЖДЫЙ товар сразу в обе стороны:
 *   appendProduct(p)     → JSONL
 *   saveRawProduct(p)    → upsert по sourceUrl в Postgres
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PATHS } from "./config";
import type { Checkpoint, ScrapedProduct } from "./types";

const PRODUCTS_FILE = path.resolve(PATHS.rawProductsJsonl);
const CHECKPOINT_FILE = path.resolve(PATHS.checkpoint);
const DEBUG_DIR = path.resolve("data/debug");

/* ───────── Filesystem (JSONL + checkpoint + debug) ───────── */

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.dirname(PRODUCTS_FILE), { recursive: true });
  await fs.mkdir(path.dirname(CHECKPOINT_FILE), { recursive: true });
}

export async function ensureDebugDir(): Promise<void> {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
}

export async function writeDebug(name: string, content: string): Promise<void> {
  await ensureDebugDir();
  await fs.writeFile(path.join(DEBUG_DIR, name), content, "utf-8");
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

/* ───────── Postgres raw layer ───────── */

let prismaClient: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      log: ["error", "warn"],
    });
  }
  return prismaClient;
}

/**
 * Upsert raw payload в Postgres. Ключ конфликта — `sourceUrl`.
 *
 * Контракт:
 *   - INSERT, если sourceUrl впервые.
 *   - UPDATE barcode/payload/scrapedAt/updatedAt, если sourceUrl уже есть.
 *
 * Бросает на ошибки БД — caller должен оборачивать в try/catch, чтобы
 * сбой Postgres не валил весь скрейп (JSONL-копия даёт нам резерв).
 */
export async function saveRawProduct(product: ScrapedProduct): Promise<void> {
  const prisma = getPrisma();
  const payload = product as unknown as Prisma.InputJsonValue;

  await prisma.nationalCatalogRawProduct.upsert({
    where: { sourceUrl: product.sourceUrl },
    create: {
      source: product.source,
      sourceUrl: product.sourceUrl,
      barcode: product.barcode,
      payload,
      scrapedAt: new Date(product.scrapedAt),
    },
    update: {
      barcode: product.barcode,
      payload,
      scrapedAt: new Date(product.scrapedAt),
    },
  });
}

/** Закрыть соединение с БД. Должно вызываться в finally main()'а. */
export async function closeDb(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}
