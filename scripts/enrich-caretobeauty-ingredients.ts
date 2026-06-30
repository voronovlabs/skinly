/**
 * Skinly · INGREDIENT ENRICHMENT runner · Care to Beauty
 *
 * Добирает НАСТОЯЩИЙ INCI для товаров Care to Beauty, у которых состава нет
 * (ingredients_raw пуст), через провайдер-цепочку (см. scripts/enrich/
 * ingredients). Пишет провенанс в scrape.caretobeauty_ingredient_enrichment и
 * (в --apply) заполняет пустой ingredients_raw, чтобы normalize→… подхватил.
 * В Product НИЧЕГО не пишется.
 *
 * Запуск (tools-контейнер):
 *   npm run enrich:caretobeauty-ingredients                 # DRY-RUN
 *   npm run enrich:caretobeauty-ingredients -- --apply
 *   npm run enrich:caretobeauty-ingredients -- --brand "CeraVe" --limit 50
 *   npm run enrich:caretobeauty-ingredients -- --apply --enable-html
 *
 * Бренды по умолчанию — целевой список Skinly. Каждый INCI валидируется
 * isLikelyInci; не нашли настоящий состав → пропуск (NULL остаётся).
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";
import { buildProviders, resolveIngredients, type EnrichProduct } from "./enrich/ingredients";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TARGET_BRANDS = [
  "CeraVe", "Avène", "Uriage", "Ducray", "A-Derma", "COSRX", "Skin1004",
  "Holika Holika", "Missha", "Dr.Jart+", "Some By Mi", "Hada Labo",
  "KIKO Milano", "Catrice", "Manyo", "Sesderma",
];

interface CliArgs {
  apply: boolean;
  brands: string[] | null;
  limit: number;
  enableHtml: boolean;
  delayMs: number;
  /** >0 → также добирать «коротко-некачественный» INCI (length(trim) < N). */
  minLength: number;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      brand: { type: "string", multiple: true },
      limit: { type: "string", default: "0" },
      "enable-html": { type: "boolean", default: false },
      "delay-ms": { type: "string", default: "350" },
      "min-length": { type: "string", default: "0" },
    },
  });
  const brandVals = (values.brand as string[] | undefined) ?? [];
  const brands = brandVals.flatMap((b) => b.split("||")).map((b) => b.trim()).filter(Boolean);
  const limit = parseInt(String(values.limit), 10);
  const delay = parseInt(String(values["delay-ms"]), 10);
  const minLen = parseInt(String(values["min-length"]), 10);
  return {
    apply: Boolean(values.apply),
    brands: brands.length ? brands : null,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    enableHtml: Boolean(values["enable-html"]),
    delayMs: Number.isFinite(delay) && delay >= 0 ? delay : 350,
    minLength: Number.isFinite(minLen) && minLen > 0 ? minLen : 0,
  };
}

interface Row {
  ean: string;
  brand: string | null;
  name: string | null;
  volume: string | null;
  ingredients_raw: string | null;
}

async function main(): Promise<void> {
  const args = parseCli();
  log(`[enrich c2b INCI] mode=${args.apply ? "APPLY" : "DRY-RUN"} enableHtml=${args.enableHtml} limit=${args.limit || "∞"}`);

  await ensureSchema(log);
  const prisma = getPrisma();
  const providers = buildProviders({ enableHtml: args.enableHtml });
  log(`providers: ${providers.map((p) => p.name).join(" → ")}`);

  const brands = args.brands ?? TARGET_BRANDS;
  // Матчим СЫРОЙ бренд (c.brand из CtB og:brand, напр. 'CeraVe') БЕЗ
  // dm.norm_brand (тот делает initcap → 'Cerave' и ломал сравнение).
  // Case-insensitive + fallback на нормализованный бренд.
  const brandsLower = brands.map((b) => b.trim().toLowerCase());
  const limitClause = args.limit ? Prisma.sql`LIMIT ${args.limit}` : Prisma.empty;

  // Условие «нет нормального состава»: NULL | пусто (+ опц. слишком короткий).
  const lowQ = args.minLength
    ? Prisma.sql` OR length(trim(c.ingredients_raw)) < ${args.minLength}`
    : Prisma.empty;
  const brandFilter = Prisma.sql`
    ( lower(trim(c.brand)) = ANY(${brandsLower})
      OR lower(trim(coalesce(nrm.brand_normalized,''))) = ANY(${brandsLower}) )`;

  // ── debug-счётчики ──
  const dbg = await prisma.$queryRaw<
    { total_for_brand: bigint; missing_inci: bigint; selected: bigint }[]
  >(Prisma.sql`
    SELECT
      count(*)                                                              AS total_for_brand,
      count(*) FILTER (WHERE c.ingredients_raw IS NULL OR trim(c.ingredients_raw) = '') AS missing_inci,
      count(*) FILTER (WHERE c.ingredients_raw IS NULL OR trim(c.ingredients_raw) = ''${lowQ}) AS selected
    FROM scrape.caretobeauty_products c
    LEFT JOIN scrape.caretobeauty_products_normalized nrm ON nrm.source_ref = c.ean
    WHERE coalesce(c.ean,'') <> '' AND ${brandFilter}
  `);
  const d = dbg[0];
  log(`[debug] total rows for brand(s): ${n(d?.total_for_brand)}`);
  log(`[debug] missing INCI (NULL|empty): ${n(d?.missing_inci)}`);
  log(`[debug] selected candidates${args.minLength ? ` (incl. <${args.minLength})` : ""}: ${n(d?.selected)}`);

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.ean,
           coalesce(nullif(nrm.brand_normalized,''), c.brand)        AS brand,
           coalesce(nullif(nrm.product_name_normalized,''), c.product_name) AS name,
           nrm.volume,
           c.ingredients_raw
    FROM scrape.caretobeauty_products c
    LEFT JOIN scrape.caretobeauty_products_normalized nrm ON nrm.source_ref = c.ean
    WHERE coalesce(c.ean,'') <> ''
      AND ${brandFilter}
      AND ( c.ingredients_raw IS NULL OR trim(c.ingredients_raw) = ''${lowQ} )
    ORDER BY c.ean
    ${limitClause}
  `);
  log(`[enrich c2b INCI] кандидатов к обработке: ${rows.length}`);

  const bySource = new Map<string, number>();
  let resolved = 0;
  let notFound = 0;
  const examples: { brand: string | null; name: string | null; source: string; inci: string }[] = [];

  for (const r of rows) {
    const product: EnrichProduct = {
      ean: r.ean,
      brand: r.brand,
      name: r.name,
      volume: r.volume,
      existingInci: r.ingredients_raw,
    };
    const result = await resolveIngredients(product, providers, log);

    if (!result) {
      notFound++;
    } else {
      resolved++;
      bySource.set(result.source, (bySource.get(result.source) ?? 0) + 1);
      if (examples.length < 10) {
        examples.push({ brand: r.brand, name: r.name, source: result.source, inci: result.inci });
      }
      if (args.apply) {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO scrape.caretobeauty_ingredient_enrichment
            (ean, source, source_url, method, confidence, ingredients_raw, updated_at)
          VALUES (${r.ean}, ${result.source}, ${result.sourceUrl}, ${result.method},
                  ${result.confidence}, ${result.inci}, now())
          ON CONFLICT (ean) DO UPDATE SET
            source = EXCLUDED.source, source_url = EXCLUDED.source_url,
            method = EXCLUDED.method, confidence = EXCLUDED.confidence,
            ingredients_raw = EXCLUDED.ingredients_raw, updated_at = now()
        `);
        // заполняем staging только там, где состав был пуст (не затираем CtB INCI)
        await prisma.$executeRaw(Prisma.sql`
          UPDATE scrape.caretobeauty_products
          SET ingredients_raw = ${result.inci}, updated_at = now()
          WHERE ean = ${r.ean} AND coalesce(ingredients_raw,'') = ''
        `);
      }
    }
    if (args.delayMs) await sleep(args.delayMs);
  }

  /* ── отчёт ── */
  log("");
  log("══════════ Care to Beauty · INGREDIENT ENRICHMENT ══════════");
  log(`режим:               ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log(`кандидатов без INCI: ${rows.length}`);
  log(`найден настоящий INCI: ${resolved}`);
  log(`не найдено:          ${notFound}`);
  log("по источникам:");
  for (const [s, c] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${s.padEnd(18)} ${c}`);
  }
  log("");
  log(`примеры (до 10):`);
  for (const e of examples) {
    log(`  • [${e.source}] [${e.brand ?? "—"}] ${trunc(e.name ?? "—", 36)}`);
    log(`      ${trunc(e.inci, 96)}`);
  }
  log("");
  if (!args.apply) log("DRY-RUN: ничего не записано. Запись: -- --apply");
  log("ПОЛИТИКА: 0 записей в Product. Только staging (enrichment + ingredients_raw).");
  log("════════════════════════════════════════════════════════════");
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
