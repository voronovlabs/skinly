/**
 * Skinly · EAN enrichment (DRY-RUN) · inn-skin staging ↔ external identifiers
 *
 * Этап pipeline:  scrape inn-skin → normalize → [EAN enrichment] → merge.
 *
 * Сопоставляет scrape.inn_skin_products_normalized с УНИВЕРСАЛЬНЫМ пулом
 * scrape.external_product_identifiers (любой source) и пишет ГИПОТЕЗЫ в
 * scrape.inn_skin_ean_candidates (tier high/medium/low + confidence + reasons).
 *
 * Запуск (через tools-контейнер):
 *   npm run match:inn-skin-barcodes
 *   npm run match:inn-skin-barcodes -- --examples 20 --source barcode-list
 *
 * Безопасность:
 *   - brand gate: матчим только внутри одного бренда;
 *   - объём — плюс, НЕ обязателен; alias — только override;
 *   - low НЕ авто-мержим, но в staging записываем для ревью;
 *   - НИЧЕГО не пишется в Product. Таблица кандидатов пересоздаётся.
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";
import {
  brandQueryForInnSkin,
  classifyCandidate,
  type MatchResult,
  type MatchTier,
} from "./inn-skin/ean-match";

const log = (m: string) => console.log(m);
const ts = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

interface CliArgs {
  examples: number;
  source: string | null;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      examples: { type: "string", default: "20" },
      source: { type: "string" },
    },
  });
  const examples = parseInt(String(values.examples), 10);
  return {
    examples: Number.isFinite(examples) && examples > 0 ? examples : 20,
    source: (values.source as string | undefined) ?? null,
  };
}

interface InnRow {
  source_product_id: string;
  brand_normalized: string | null;
  product_name_normalized: string | null;
  raw_name: string | null;
  retailer_article: string | null;
}
interface ExtRow {
  source: string;
  source_query: string | null;
  ean: string;
  product_name: string | null;
}

interface Example {
  inn: string;
  brand: string;
  cand: string | null;
  ean: string | null;
  conf: number;
  source: string | null;
}
interface BrandAgg {
  products: number;
  eanPool: number;
  high: number;
  medium: number;
  low: number;
  unmatched: number;
}

async function main(): Promise<void> {
  const args = parseCli();
  ts("[EAN enrichment] DRY-RUN — в Product ничего не пишется");

  await ensureSchema(ts);
  const prisma = getPrisma();

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE scrape.inn_skin_ean_candidates`);

  const innRows = await prisma.$queryRaw<InnRow[]>(Prisma.sql`
    SELECT nrm.source_product_id, nrm.brand_normalized,
           nrm.product_name_normalized, s.product_name AS raw_name,
           nrm.retailer_article
    FROM scrape.inn_skin_products_normalized nrm
    JOIN scrape.inn_skin_products s ON s.id = nrm.source_product_id
  `);

  const extRows = args.source
    ? await prisma.$queryRaw<ExtRow[]>(Prisma.sql`
        SELECT source, source_query, ean, product_name
        FROM scrape.external_product_identifiers WHERE source = ${args.source}
      `)
    : await prisma.$queryRaw<ExtRow[]>(Prisma.sql`
        SELECT source, source_query, ean, product_name
        FROM scrape.external_product_identifiers
      `);

  // Пул внешних идентификаторов по бренд-запросу.
  const byQuery = new Map<string, ExtRow[]>();
  for (const r of extRows) {
    if (!r.source_query) continue;
    const arr = byQuery.get(r.source_query) ?? [];
    arr.push(r);
    byQuery.set(r.source_query, arr);
  }

  const NO_BRAND = "(no brand gate)";
  const perBrand = new Map<string, BrandAgg>();
  const ensureAgg = (k: string): BrandAgg => {
    let a = perBrand.get(k);
    if (!a) {
      a = { products: 0, eanPool: 0, high: 0, medium: 0, low: 0, unmatched: 0 };
      perBrand.set(k, a);
    }
    return a;
  };

  let candidatesWritten = 0;
  const ex: Record<"high" | "medium" | "unmatched", Example[]> = {
    high: [],
    medium: [],
    unmatched: [],
  };

  for (const row of innRows) {
    const innName = row.product_name_normalized ?? row.raw_name ?? "";
    const brandQuery = brandQueryForInnSkin(row.brand_normalized);
    const brandKey = brandQuery ?? NO_BRAND;
    const agg = ensureAgg(brandKey);
    agg.products++;
    agg.eanPool = brandQuery ? (byQuery.get(brandQuery)?.length ?? 0) : 0;

    if (!brandQuery) {
      agg.unmatched++;
      pushEx(ex.unmatched, row, innName, brandKey, null);
      continue;
    }

    const cands = byQuery.get(brandQuery) ?? [];
    let best: { r: MatchResult; c: ExtRow } | null = null;

    for (const c of cands) {
      const r = classifyCandidate({
        innName,
        brandQuery,
        innVolumeSource: row.raw_name,
        source: c.source,
        candidateEan: c.ean,
        candidateName: c.product_name ?? "",
      });
      if (r.tier === "none") continue;

      // пишем КАЖДОГО high/medium/low кандидата (альтернативы сохраняем)
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO scrape.inn_skin_ean_candidates (
          id, source_product_id, inn_skin_name, inn_skin_brand,
          retailer_article, source, candidate_ean, external_name,
          confidence, tier, match_method, reasons, created_at
        ) VALUES (
          ${randomUUID()}, ${row.source_product_id}, ${innName},
          ${row.brand_normalized}, ${row.retailer_article}, ${c.source},
          ${c.ean}, ${c.product_name}, ${r.confidence}, ${r.tier},
          ${r.method}, ${JSON.stringify(r.reasons)}::jsonb, now()
        )
        ON CONFLICT (source_product_id, candidate_ean) DO UPDATE SET
          source        = EXCLUDED.source,
          external_name = EXCLUDED.external_name,
          confidence    = EXCLUDED.confidence,
          tier          = EXCLUDED.tier,
          match_method  = EXCLUDED.match_method,
          reasons       = EXCLUDED.reasons
      `);
      candidatesWritten++;

      if (!best || tierRank(r.tier) > tierRank(best.r.tier) ||
          (tierRank(r.tier) === tierRank(best.r.tier) && r.confidence > best.r.confidence)) {
        best = { r, c };
      }
    }

    if (!best) {
      agg.unmatched++;
      pushEx(ex.unmatched, row, innName, brandKey, null);
      continue;
    }
    if (best.r.tier === "high") {
      agg.high++;
      pushEx(ex.high, row, innName, brandKey, best);
    } else if (best.r.tier === "medium") {
      agg.medium++;
      pushEx(ex.medium, row, innName, brandKey, best);
    } else {
      agg.low++;
    }
  }

  ex.high.sort((a, b) => b.conf - a.conf);
  ex.medium.sort((a, b) => b.conf - a.conf);

  /* ── отчёт ── */
  log("");
  log("════════════ inn-skin · EAN ENRICHMENT · DRY-RUN REPORT ════════════");
  log(`источник(и): ${args.source ?? "все"}`);
  log(`inn-skin товаров: ${innRows.length} | внешних EAN-строк: ${extRows.length}`);
  log("");
  log("по брендам (товаров / EAN-пул / high / medium / low / unmatched):");
  log(
    "  " +
      "BRAND".padEnd(24) +
      "prod".padStart(6) +
      "ean".padStart(7) +
      "high".padStart(6) +
      "med".padStart(6) +
      "low".padStart(6) +
      "unm".padStart(6),
  );
  for (const [brand, a] of [...perBrand.entries()].sort((x, y) => y[1].products - x[1].products)) {
    log(
      "  " +
        brand.padEnd(24) +
        String(a.products).padStart(6) +
        String(a.eanPool).padStart(7) +
        String(a.high).padStart(6) +
        String(a.medium).padStart(6) +
        String(a.low).padStart(6) +
        String(a.unmatched).padStart(6),
    );
  }
  const tot = totals(perBrand);
  log("  " + "—".repeat(60));
  log(
    "  " +
      "TOTAL".padEnd(24) +
      String(tot.products).padStart(6) +
      String("").padStart(7) +
      String(tot.high).padStart(6) +
      String(tot.medium).padStart(6) +
      String(tot.low).padStart(6) +
      String(tot.unmatched).padStart(6),
  );
  log("");
  log(`кандидатов записано (high+medium+low, с альтернативами): ${candidatesWritten}`);
  log("");
  log(
    "ПОЛИТИКА: 0 записей в Product. Это гипотезы EAN. Перенос — отдельный шаг.",
  );
  log("");
  log(`TOP-${args.examples} HIGH:`);
  printEx(ex.high.slice(0, args.examples));
  log("");
  log(`TOP-${args.examples} MEDIUM (на ручную проверку):`);
  printEx(ex.medium.slice(0, args.examples));
  log("");
  log(`TOP-${args.examples} UNMATCHED (нет приемлемого EAN):`);
  printEx(ex.unmatched.slice(0, args.examples));
  log("════════════════════════════════════════════════════════════════════");
}

function tierRank(t: MatchTier): number {
  return t === "high" ? 3 : t === "medium" ? 2 : t === "low" ? 1 : 0;
}

function pushEx(
  arr: Example[],
  row: InnRow,
  innName: string,
  brand: string,
  best: { r: MatchResult; c: ExtRow } | null,
): void {
  arr.push({
    inn: innName,
    brand,
    cand: best?.c.product_name ?? null,
    ean: best?.c.ean ?? null,
    conf: best?.r.confidence ?? 0,
    source: best?.c.source ?? null,
  });
}

function totals(m: Map<string, BrandAgg>): BrandAgg {
  const t: BrandAgg = { products: 0, eanPool: 0, high: 0, medium: 0, low: 0, unmatched: 0 };
  for (const a of m.values()) {
    t.products += a.products;
    t.high += a.high;
    t.medium += a.medium;
    t.low += a.low;
    t.unmatched += a.unmatched;
  }
  return t;
}

function printEx(rows: Example[]): void {
  if (rows.length === 0) {
    log("  (нет)");
    return;
  }
  for (const r of rows) {
    if (r.ean) {
      log(
        `  • [${r.conf.toFixed(2)}] "${trunc(r.inn, 32)}" → ${r.ean} ` +
          `"${trunc(r.cand ?? "—", 40)}" (${r.source})`,
      );
    } else {
      log(`  • "${trunc(r.inn, 36)}"  [${r.brand}]`);
    }
  }
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
