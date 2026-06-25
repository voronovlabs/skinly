/**
 * Skinly · normalizer · inn-skin raw → scrape.inn_skin_products_normalized
 *
 * Запуск:
 *   npm run normalize:inn-skin
 *   npm run normalize:inn-skin -- --limit 50
 *
 * Что делает:
 *   1. ensureSchema() — гарантирует наличие scrape.* (идемпотентно).
 *   2. Одним INSERT…SELECT…ON CONFLICT приводит бренд/имя/категорию/состав
 *      к канону каталога через те же dm.*-функции, что использует витрина:
 *        brand_normalized = dm.norm_brand,  brand_key = dm.brand_key
 *        name_normalized  = dm.norm_name,   name_key  = dm.name_key
 *        ingredients_normalized = dm.norm_ingredients
 *        has_valid_ean    = dm.is_valid_ean(retailer_article)  (для inn-skin = false)
 *      Категория маппится RU-эвристикой в ProductCategory enum (как text).
 *   3. Печатает сводку: сколько нормализовано, разбивка по категориям,
 *      сколько с валидным EAN, сколько с составом.
 *
 * Идемпотентно: повторный запуск делает ON CONFLICT UPDATE.
 * НИЧЕГО не пишет в public."Product" — только staging.
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

interface CliArgs {
  limit: number; // 0 = все
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: { limit: { type: "string", default: "0" } },
  });
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("--limit must be >= 0");
  }
  return { limit };
}

/**
 * RU/EN-эвристика категории → ProductCategory enum (как text).
 * Специфичные правила раньше общих (eye/oil/mist до moisturizer).
 * Применяется к lower(category_raw || ' ' || product_name).
 */
const CATEGORY_CASE = Prisma.raw(`
  CASE
    WHEN src ~ 'сыворотк|serum'                                   THEN 'SERUM'
    WHEN src ~ 'эссенц|essence'                                   THEN 'ESSENCE'
    WHEN src ~ 'тонер|тоник|toner'                                THEN 'TONER'
    WHEN src ~ 'для глаз|крем для глаз|eye'                       THEN 'EYE_CREAM'
    WHEN src ~ 'скраб|пилинг|эксфолиант|peel|scrub|exfoli'        THEN 'EXFOLIANT'
    WHEN src ~ 'маска|маски|mask'                                 THEN 'MASK'
    WHEN src ~ 'солнцезащит|spf|sunscreen|bariesun'               THEN 'SUNSCREEN'
    WHEN src ~ 'масло|oil'                                        THEN 'OIL'
    WHEN src ~ 'термальн|мист|спрей|мисты|mist|thermal|spray'     THEN 'MIST'
    WHEN src ~ 'для губ|бальзам для губ|губ|lip'                  THEN 'LIP_CARE'
    WHEN src ~ 'очищ|умыв|мицелляр|пенк|мыло|гель для|cleans|micellar|foam|cleansing' THEN 'CLEANSER'
    WHEN src ~ 'крем|молочко|эмульс|увлажн|cream|milk|emulsion|moistur|lotion|bariederm' THEN 'MOISTURIZER'
    ELSE 'OTHER'
  END
`);

async function main(): Promise<void> {
  const args = parseCli();
  log(`[NORMALIZE inn-skin] starting · limit=${args.limit || "∞"}`);

  await ensureSchema(log);
  const prisma = getPrisma();

  const limitClause = args.limit
    ? Prisma.sql`LIMIT ${args.limit}`
    : Prisma.empty;

  const affected = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO scrape.inn_skin_products_normalized (
      source_product_id, source_url, brand_normalized, brand_key,
      product_name_normalized, name_key, category, ingredients_raw,
      ingredients_normalized, retailer_article, ean, has_valid_ean, updated_at
    )
    SELECT
      s.id,
      s.source_url,
      dm.norm_brand(s.brand),
      dm.brand_key(s.brand),
      dm.norm_name(s.product_name),
      dm.name_key(s.product_name),
      ( SELECT (${CATEGORY_CASE})
        FROM (SELECT lower(coalesce(s.category_raw,'') || ' ' || coalesce(s.product_name,'')) AS src) c
      ),
      s.ingredients_raw,
      dm.norm_ingredients(s.ingredients_raw),
      s.retailer_article,
      CASE WHEN dm.is_valid_ean(s.retailer_article) THEN s.retailer_article ELSE NULL END,
      dm.is_valid_ean(s.retailer_article),
      now()
    FROM scrape.inn_skin_products s
    ORDER BY s.created_at ASC
    ${limitClause}
    ON CONFLICT (source_product_id) DO UPDATE SET
      source_url              = EXCLUDED.source_url,
      brand_normalized        = EXCLUDED.brand_normalized,
      brand_key               = EXCLUDED.brand_key,
      product_name_normalized = EXCLUDED.product_name_normalized,
      name_key                = EXCLUDED.name_key,
      category                = EXCLUDED.category,
      ingredients_raw         = EXCLUDED.ingredients_raw,
      ingredients_normalized  = EXCLUDED.ingredients_normalized,
      retailer_article        = EXCLUDED.retailer_article,
      ean                     = EXCLUDED.ean,
      has_valid_ean           = EXCLUDED.has_valid_ean,
      updated_at              = now()
  `);

  log(`[NORMALIZE inn-skin] upserted rows: ${affected}`);

  // ── Сводка ──
  const totals = await prisma.$queryRaw<
    { total: bigint; with_inci: bigint; with_ean: bigint }[]
  >(Prisma.sql`
    SELECT
      count(*)                                                   AS total,
      count(*) FILTER (WHERE coalesce(ingredients_raw,'') <> '') AS with_inci,
      count(*) FILTER (WHERE has_valid_ean)                      AS with_ean
    FROM scrape.inn_skin_products_normalized
  `);

  const byCat = await prisma.$queryRaw<{ category: string; n: bigint }[]>(
    Prisma.sql`
      SELECT category, count(*) AS n
      FROM scrape.inn_skin_products_normalized
      GROUP BY category
      ORDER BY n DESC
    `,
  );

  const t = totals[0];
  log("──────────────────────────────────────────────");
  log("[NORMALIZE inn-skin] DONE");
  log(`  normalized rows:   ${t?.total ?? 0n}`);
  log(`  with INCI:         ${t?.with_inci ?? 0n}`);
  log(`  with valid EAN:    ${t?.with_ean ?? 0n}  (ожидаемо 0 — у источника только артикулы)`);
  log("  by category:");
  for (const row of byCat) log(`    ${row.category.padEnd(12)} ${row.n}`);
  log("──────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
