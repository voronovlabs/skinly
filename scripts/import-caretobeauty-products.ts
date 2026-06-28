/**
 * Skinly · IMPORT · Care to Beauty → public."Product" (только НОВЫЕ по barcode)
 *
 * Импортирует ТОЛЬКО новые товары Care to Beauty в основной каталог.
 * НОВЫЙ товар = строка scrape.caretobeauty_products_normalized, у которой:
 *   - has_valid_ean = true
 *   - ean ОТСУТСТВУЕТ в public."Product".barcode
 *
 * Без матчинга по имени. Без fuzzy. Без UPDATE/DELETE существующих Product.
 * Только INSERT отсутствующих по barcode.
 *
 * Идемпотентность: вставка через createMany({ skipDuplicates: true }) по
 * unique (barcode) → повторный --apply вставит 0.
 *
 * Запуск (tools-контейнер):
 *   npm run import:caretobeauty-products                 # DRY-RUN (по умолчанию)
 *   npm run import:caretobeauty-products -- --apply      # запись в Product
 *
 * Маппинг в Product:
 *   barcode       = ean
 *   brand         = brand_normalized | brand
 *   name          = product_name_normalized | product_name
 *   category      = category (валидируется по enum ProductCategory, иначе OTHER)
 *   imageUrl      = image_url
 *   descriptionEn = description           (у Product нет общего description —
 *                                          есть descriptionRu/En; CtB на англ.)
 *   source        = 'caretobeauty'
 *   externalId    = source_ref (= ean)
 *   ingredients   — НЕ трогаем (это relation ProductIngredient, не скалярное
 *                   поле; вне scope «insert by barcode»).
 */

import { parseArgs } from "node:util";
import { Prisma, ProductCategory } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (m: string) => console.log(m);
const ts = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

const VALID_CATEGORIES = new Set<string>(Object.values(ProductCategory));
function toCategory(v: string | null): ProductCategory {
  return v && VALID_CATEGORIES.has(v) ? (v as ProductCategory) : ProductCategory.OTHER;
}

interface CliArgs {
  apply: boolean;
  examples: number;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      examples: { type: "string", default: "20" },
    },
  });
  const examples = parseInt(String(values.examples), 10);
  return {
    apply: Boolean(values.apply),
    examples: Number.isFinite(examples) && examples > 0 ? examples : 20,
  };
}

interface CandRow {
  barcode: string;
  brand: string;
  name: string;
  category: string | null;
  image_url: string | null;
  description: string | null;
  source_ref: string;
}

/** Insertable = valid EAN + not in Product + есть name и brand. */
const CAND_SQL = Prisma.sql`
  SELECT
    c.ean AS barcode,
    coalesce(nullif(c.brand_normalized,''), nullif(c.brand,'')) AS brand,
    coalesce(nullif(c.product_name_normalized,''), nullif(c.name,'')) AS name,
    c.category, c.image_url, c.description, c.source_ref
  FROM scrape.caretobeauty_products_normalized c
  WHERE c.has_valid_ean = true
    AND coalesce(nullif(c.brand_normalized,''), nullif(c.brand,'')) IS NOT NULL
    AND coalesce(nullif(c.product_name_normalized,''), nullif(c.name,'')) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.barcode = c.ean)
  ORDER BY c.source_ref
`;

async function main(): Promise<void> {
  const args = parseCli();
  ts(`[import caretobeauty] mode=${args.apply ? "APPLY (запись в Product)" : "DRY-RUN"}`);

  await ensureSchema(ts);
  const prisma = getPrisma();

  /* ── агрегаты для отчёта ── */
  const agg = await prisma.$queryRaw<
    {
      total: bigint;
      invalid_ean: bigint;
      already_exists: bigint;
      missing_name_brand: bigint;
      insertable: bigint;
    }[]
  >(Prisma.sql`
    WITH t AS (
      SELECT
        c.has_valid_ean,
        coalesce(nullif(c.brand_normalized,''), nullif(c.brand,'')) AS brand,
        coalesce(nullif(c.product_name_normalized,''), nullif(c.name,'')) AS name,
        EXISTS (SELECT 1 FROM "Product" p WHERE p.barcode = c.ean) AS in_product
      FROM scrape.caretobeauty_products_normalized c
    )
    SELECT
      count(*)                                                                        AS total,
      count(*) FILTER (WHERE has_valid_ean IS NOT TRUE)                               AS invalid_ean,
      count(*) FILTER (WHERE has_valid_ean AND in_product)                            AS already_exists,
      count(*) FILTER (WHERE has_valid_ean AND NOT in_product
                        AND (name IS NULL OR brand IS NULL))                          AS missing_name_brand,
      count(*) FILTER (WHERE has_valid_ean AND NOT in_product
                        AND name IS NOT NULL AND brand IS NOT NULL)                   AS insertable
    FROM t
  `);
  const a = agg[0];

  const byCat = await prisma.$queryRaw<{ category: string; c: bigint }[]>(Prisma.sql`
    WITH t AS (
      SELECT c.category,
        coalesce(nullif(c.brand_normalized,''), nullif(c.brand,'')) AS brand,
        coalesce(nullif(c.product_name_normalized,''), nullif(c.name,'')) AS name,
        EXISTS (SELECT 1 FROM "Product" p WHERE p.barcode = c.ean) AS in_product
      FROM scrape.caretobeauty_products_normalized c
      WHERE c.has_valid_ean = true
    )
    SELECT category, count(*) AS c FROM t
    WHERE NOT in_product AND name IS NOT NULL AND brand IS NOT NULL
    GROUP BY category ORDER BY c DESC
  `);

  const examples = await prisma.$queryRaw<CandRow[]>(
    Prisma.sql`${CAND_SQL} LIMIT ${args.examples}`,
  );

  /* ── отчёт (общий для dry-run и apply) ── */
  log("");
  log("══════════ Care to Beauty → Product · IMPORT ══════════");
  log(`режим:                       ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log(`всего нормализованных строк:  ${n(a?.total)}`);
  log(`уже есть в Product (barcode): ${n(a?.already_exists)}`);
  log(`НОВЫХ к вставке:              ${n(a?.insertable)}`);
  log(`пропущено (невалидный EAN):   ${n(a?.invalid_ean)}`);
  log(`пропущено (нет name/brand):   ${n(a?.missing_name_brand)}`);
  log("-------------------------------------------------------");
  log("распределение по категориям (insertable):");
  for (const r of byCat) log(`  ${r.category.padEnd(12)} ${n(r.c)}`);
  log("-------------------------------------------------------");
  log(`примеры к вставке (до ${args.examples}):`);
  if (examples.length === 0) log("  (нет)");
  for (const r of examples) {
    log(
      `  • ${r.barcode} | [${trunc(r.brand, 18)}] ${trunc(r.name, 40)} | ` +
        `${toCategory(r.category)} | img=${r.image_url ? "y" : "n"} desc=${r.description ? "y" : "n"}`,
    );
  }
  log("-------------------------------------------------------");

  if (!args.apply) {
    log("DRY-RUN: в Product ничего не записано. Для записи: -- --apply");
    log("═══════════════════════════════════════════════════════");
    return;
  }

  /* ── APPLY: вставка только новых, идемпотентно ── */
  const rows = await prisma.$queryRaw<CandRow[]>(CAND_SQL);
  ts(`[import caretobeauty] APPLY: кандидатов к вставке ${rows.length}`);

  const data: Prisma.ProductCreateManyInput[] = rows.map((r) => ({
    barcode: r.barcode,
    brand: r.brand,
    name: r.name,
    category: toCategory(r.category),
    imageUrl: r.image_url ?? null,
    descriptionEn: r.description ?? null,
    source: "caretobeauty",
    externalId: r.source_ref,
  }));

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH);
    // skipDuplicates → идемпотентно по unique(barcode); только INSERT, без UPDATE.
    const res = await prisma.product.createMany({ data: chunk, skipDuplicates: true });
    inserted += res.count;
    ts(`[import caretobeauty] batch ${i / BATCH + 1}: +${res.count} (накоплено ${inserted})`);
  }

  log("");
  log(`APPLY DONE · вставлено в Product: ${inserted} (из ${data.length} кандидатов)`);
  if (inserted < data.length) {
    log(`  (${data.length - inserted} уже существовали → skipDuplicates, идемпотентно)`);
  }
  log("повторный --apply вставит 0 (идемпотентность по barcode).");
  log("═══════════════════════════════════════════════════════");
}

function trunc(s: string | null, len: number): string {
  const v = s ?? "—";
  return v.length > len ? v.slice(0, len) + "…" : v;
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
