/**
 * Хранение inn-skin staging: JSONL (append-only ground truth) + Postgres
 * схема `scrape` (изолирована от public-витрины).
 *
 * Каждый товар пишется в обе стороны:
 *   appendProduct(p)  → data/raw/inn-skin-products.jsonl
 *   saveRawProduct(p) → upsert по source_url в scrape.inn_skin_products
 *
 * Схема `scrape` живёт ВНЕ Prisma-моделей (как `dm`), поэтому работаем
 * через $executeRaw / $queryRaw. ensureSchema() прогоняет SQL-файл —
 * идемпотентно (всё через IF NOT EXISTS).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PATHS } from "./config";
import type { InnSkinScrapedProduct } from "./types";

let prismaClient: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({ log: ["error", "warn"] });
  }
  return prismaClient;
}

export async function closeDb(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

/* ───────── schema bootstrap ───────── */

/**
 * Создаёт схему `scrape` и staging-таблицы. Читает SQL-файл и выполняет
 * по одному statement'у (Prisma extended-protocol не любит multi-statement).
 * SQL-файл без тел функций → наивный split по ';' безопасен.
 */
export async function ensureSchema(log: (m: string) => void): Promise<void> {
  const sql = await fs.readFile(PATHS.schemaSql, "utf-8");
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s.replace(/\s/g, "")));

  const prisma = getPrisma();
  let n = 0;
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
    n++;
  }
  log(`[schema] ensured scrape.* (${n} statements)`);
}

/* ───────── JSONL ───────── */

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.dirname(PATHS.rawProductsJsonl), { recursive: true });
  await fs.mkdir(PATHS.debugDir, { recursive: true });
}

export async function appendProduct(p: InnSkinScrapedProduct): Promise<void> {
  await fs.appendFile(PATHS.rawProductsJsonl, JSON.stringify(p) + "\n");
}

export async function writeDebug(name: string, content: string): Promise<void> {
  await fs.mkdir(PATHS.debugDir, { recursive: true });
  await fs.writeFile(path.join(PATHS.debugDir, name), content, "utf-8");
}

/** URL'ы (path-only), уже лежащие в staging — для дедупликации в рамках прогона. */
export async function loadExistingUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  const prisma = getPrisma();
  try {
    const rows = await prisma.$queryRaw<{ source_url: string }[]>(
      Prisma.sql`SELECT source_url FROM scrape.inn_skin_products`,
    );
    for (const r of rows) urls.add(r.source_url);
  } catch {
    /* таблицы ещё нет — ок */
  }
  return urls;
}

/* ───────── Postgres raw upsert ───────── */

export async function saveRawProduct(
  p: InnSkinScrapedProduct,
): Promise<void> {
  const prisma = getPrisma();
  const rawJson = JSON.stringify(p);

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO scrape.inn_skin_products (
      id, source, source_product_id, source_url, brand, product_name,
      category_raw, image_url, price_text, price_value, description, "usage",
      ingredients_raw, retailer, retailer_article, seller_url, raw_json,
      scraped_at, updated_at
    ) VALUES (
      ${p.sourceProductId}, ${p.source}, ${p.sourceProductId}, ${p.sourceUrl},
      ${p.brand}, ${p.productName}, ${p.categoryRaw}, ${p.imageUrl},
      ${p.priceText}, ${p.priceValue}, ${p.description}, ${p.usage},
      ${p.ingredientsRaw}, ${p.retailer}, ${p.retailerArticle}, ${p.sellerUrl},
      ${rawJson}::jsonb, ${new Date(p.scrapedAt)}, now()
    )
    ON CONFLICT (source_url) DO UPDATE SET
      brand            = EXCLUDED.brand,
      product_name     = EXCLUDED.product_name,
      category_raw     = EXCLUDED.category_raw,
      image_url        = EXCLUDED.image_url,
      price_text       = EXCLUDED.price_text,
      price_value      = EXCLUDED.price_value,
      description      = EXCLUDED.description,
      "usage"         = EXCLUDED."usage",
      ingredients_raw  = EXCLUDED.ingredients_raw,
      retailer         = EXCLUDED.retailer,
      retailer_article = EXCLUDED.retailer_article,
      seller_url       = EXCLUDED.seller_url,
      raw_json         = EXCLUDED.raw_json,
      scraped_at       = EXCLUDED.scraped_at,
      updated_at       = now()
  `);
}
