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

const DEBUG_DIR = path.resolve("data/debug");

/**
 * Файл checkpoint'а. По умолчанию — общий, как до Phase 13.
 * CLI может его переопределить через `setCheckpointFile()` ДО первого
 * вызова `loadCheckpoint()` / `saveCheckpoint()`.
 */
let CHECKPOINT_FILE = path.resolve(PATHS.checkpoint);

export function setCheckpointFile(p: string): void {
  CHECKPOINT_FILE = path.resolve(p);
}

export function getCheckpointFile(): string {
  return CHECKPOINT_FILE;
}

/**
 * Phase 13.1: JSONL продуктов — теперь тоже мутабельный path.
 * При запуске с --start-path CLI ставит per-category файл, чтобы избежать
 * write-race при параллельных запусках. Без --start-path остаётся
 * `data/raw/national-catalog-products.jsonl` (backward-compat).
 *
 * `appendProduct()` / `loadExistingKeys()` читают это значение динамически,
 * так что dedup по urls/barcodes ограничен текущим per-category файлом —
 * cross-category дедупликация продолжает работать через Postgres
 * (`saveRawProduct` upsert по sourceUrl).
 */
let PRODUCTS_FILE = path.resolve(PATHS.rawProductsJsonl);

export function setJsonlFile(p: string): void {
  PRODUCTS_FILE = path.resolve(p);
}

export function getJsonlFile(): string {
  return PRODUCTS_FILE;
}

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

export interface LoadExistingKeysOptions {
  /**
   * Phase 13.1+: помимо текущего per-category JSONL (`PRODUCTS_FILE`)
   * также прогрузить legacy общий файл `data/raw/national-catalog-products.jsonl`.
   *
   * Зачем: вернуть кросс-категорийную dedup-оптимизацию. Postgres upsert
   * по `sourceUrl` всё равно защищает от фактических дублей в БД, но без
   * этого мерджа scraper повторно fetch'ит уже отскрейпленный продукт,
   * парсит и снова upsert'ит — это лишний CPU/сеть.
   *
   * Дефолт = true. Если current file === legacy path (запуск без
   * `--start-path`), legacy не читается повторно.
   */
  includeGlobal?: boolean;
}

/**
 * Загрузить known `urls` и `barcodes` для дедупликации.
 *
 * Phase 13.1+:
 *   - всегда читает `PRODUCTS_FILE` (текущий per-category или legacy)
 *   - если `includeGlobal !== false` И current file отличается от legacy
 *     — дополнительно читает `data/raw/national-catalog-products.jsonl`
 *     и мерджит ключи.
 *
 * Битые строки JSONL тихо пропускаются. Несуществующие файлы — пустой Set.
 * Никогда не бросает.
 */
export async function loadExistingKeys(
  options: LoadExistingKeysOptions = {},
): Promise<{
  urls: Set<string>;
  barcodes: Set<string>;
}> {
  const urls = new Set<string>();
  const barcodes = new Set<string>();

  const includeGlobal = options.includeGlobal !== false;
  const legacyFile = path.resolve(PATHS.rawProductsJsonl);
  const files: string[] = [];
  // Legacy global файл идёт ПЕРВЫМ — чтобы при совпадении мы успели
  // увидеть его barcodes/urls, и потом current file просто добавит свои.
  if (includeGlobal && legacyFile !== PRODUCTS_FILE) {
    files.push(legacyFile);
  }
  files.push(PRODUCTS_FILE);

  for (const file of files) {
    await loadKeysFromFile(file, urls, barcodes);
  }
  return { urls, barcodes };
}

async function loadKeysFromFile(
  file: string,
  urls: Set<string>,
  barcodes: Set<string>,
): Promise<void> {
  try {
    const raw = await fs.readFile(file, "utf-8");
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
