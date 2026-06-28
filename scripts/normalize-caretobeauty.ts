/**
 * Skinly · normalize · Care to Beauty → scrape.caretobeauty_products_normalized
 *
 * Это НЕ новый normalizer — это тонкий ADAPTER поверх общего движка
 * scripts/normalize/normalize-core.ts. Весь per-source код = один SELECT,
 * который раскладывает колонки scrape.caretobeauty_products в стандартные
 * алиасы, которые ждёт normalizeSource(), + указание СВОЕЙ целевой таблицы.
 * Сама нормализация (dm.*-функции + CATEGORY_CASE) переиспользуется как есть.
 *
 * Архитектура: у каждого источника СВОЯ пара таблиц
 *   scrape.<source>_products  →  scrape.<source>_products_normalized
 * Объединение источников делает отдельный merge-слой (не этот скрипт).
 *
 * Запуск (tools-контейнер):
 *   npm run normalize:caretobeauty
 *   npm run normalize:caretobeauty -- --limit 50
 *
 * STAGING-only: в public."Product" ничего не пишется. Merge — отдельная задача.
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";
import { normalizeSource } from "./normalize/normalize-core";

/** Своя таблица результата нормализации Care to Beauty (canonical-форма). */
const TARGET_TABLE = Prisma.raw("scrape.caretobeauty_products_normalized");
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

function parseCli(): { limit: number } {
  const { values } = parseArgs({ options: { limit: { type: "string", default: "0" } } });
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(limit) || limit < 0) throw new Error("--limit must be >= 0");
  return { limit };
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

async function main(): Promise<void> {
  const { limit } = parseCli();
  log(`[normalize caretobeauty] starting · limit=${limit || "∞"}`);

  await ensureSchema(log);
  const prisma = getPrisma();

  // ── ЕДИНСТВЕННЫЙ per-source код: маппинг колонок в стандартные алиасы ──
  const limitClause = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;
  const selectRaw = Prisma.sql`
    SELECT
      ean             AS source_ref,
      ean             AS ean,
      brand           AS brand,
      product_name    AS name,
      volume          AS volume_raw,
      category        AS category_hint,
      ingredients_raw AS ingredients_raw,
      description     AS description,
      image_url       AS image_url
    FROM scrape.caretobeauty_products
    ORDER BY id ASC
    ${limitClause}
  `;

  const affected = await normalizeSource(prisma, { targetTable: TARGET_TABLE, selectRaw });
  log(`[normalize caretobeauty] upserted rows: ${affected}`);

  /* ── сводка ── */
  const src = await prisma.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT count(*) AS total FROM scrape.caretobeauty_products`,
  );
  const totals = await prisma.$queryRaw<
    {
      total: bigint;
      with_brand_key: bigint;
      with_name_key: bigint;
      with_ean: bigint;
      with_inci: bigint;
      with_volume: bigint;
      cat_known: bigint;
      no_name_key: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      count(*)                                                        AS total,
      count(*) FILTER (WHERE coalesce(brand_key,'') <> '')            AS with_brand_key,
      count(*) FILTER (WHERE coalesce(name_key,'')  <> '')            AS with_name_key,
      count(*) FILTER (WHERE has_valid_ean)                           AS with_ean,
      count(*) FILTER (WHERE ingredients_normalized IS NOT NULL
                        AND array_length(ingredients_normalized,1) > 0) AS with_inci,
      count(*) FILTER (WHERE coalesce(volume,'') <> '')               AS with_volume,
      count(*) FILTER (WHERE category <> 'OTHER')                     AS cat_known,
      count(*) FILTER (WHERE coalesce(name_key,'') = '')              AS no_name_key
    FROM scrape.caretobeauty_products_normalized
  `);
  const byCat = await prisma.$queryRaw<{ category: string; c: bigint }[]>(Prisma.sql`
    SELECT category, count(*) AS c FROM scrape.caretobeauty_products_normalized
    GROUP BY category ORDER BY c DESC
  `);
  const examples = await prisma.$queryRaw<
    {
      brand_normalized: string | null;
      product_name_normalized: string | null;
      volume: string | null;
      category: string | null;
      ean: string | null;
      brand_key: string | null;
      name_key: string | null;
      product_key: string | null;
      ing: number | null;
      has_desc: boolean;
      has_img: boolean;
    }[]
  >(Prisma.sql`
    SELECT brand_normalized, product_name_normalized, volume, category, ean,
           brand_key, name_key, product_key,
           coalesce(array_length(ingredients_normalized,1),0) AS ing,
           (coalesce(description,'') <> '') AS has_desc,
           (coalesce(image_url,'')   <> '') AS has_img
    FROM scrape.caretobeauty_products_normalized
    ORDER BY created_at ASC, source_ref ASC LIMIT 5
  `);

  const t = totals[0];
  const srcTotal = n(src[0]?.total);
  const normTotal = n(t?.total);

  log("──────────────────────────────────────────────");
  log("[normalize caretobeauty] DONE");
  log(`  caretobeauty_products rows:  ${srcTotal}`);
  log(`  normalized rows:             ${normTotal}`);
  log(`  ├ with brand_key:            ${n(t?.with_brand_key)}`);
  log(`  ├ with name_key:             ${n(t?.with_name_key)}`);
  log(`  ├ with valid EAN:            ${n(t?.with_ean)}`);
  log(`  ├ with INCI tokens:          ${n(t?.with_inci)}`);
  log(`  ├ with volume:               ${n(t?.with_volume)}`);
  log(`  └ category != OTHER:         ${n(t?.cat_known)}`);
  log(`  НЕ нормализовано (нет name_key): ${n(t?.no_name_key)}  (пустое/мусорное название → нет ключа)`);
  if (srcTotal !== normTotal) {
    log(`  ВНИМАНИЕ: source=${srcTotal} ≠ normalized=${normTotal} (строки без source_ref/ean не попадают)`);
  }
  log("  by category:");
  for (const r of byCat) log(`    ${r.category.padEnd(12)} ${n(r.c)}`);
  log("──────────────────────────────────────────────");
  log("примеры нормализованных записей (до 5):");
  for (const e of examples) {
    log(
      `  • [${e.brand_normalized ?? "—"}] ${trunc(e.product_name_normalized ?? "—", 40)}\n` +
        `      vol=${e.volume ?? "—"} cat=${e.category ?? "—"} ean=${e.ean ?? "—"} ing=${e.ing ?? 0}` +
        ` desc=${e.has_desc ? "y" : "n"} img=${e.has_img ? "y" : "n"}\n` +
        `      brand_key=${e.brand_key ?? "—"} name_key=${trunc(e.name_key ?? "—", 28)} product_key=${e.product_key ?? "—"}`,
    );
  }
  log("──────────────────────────────────────────────");
}

function trunc(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "…" : s;
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
