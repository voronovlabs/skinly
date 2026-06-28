/**
 * Skinly · DRY-RUN MERGE · Care to Beauty ↔ public."Product"
 *
 * Анализирует пересечение scrape.caretobeauty_products_normalized с текущим
 * каталогом public."Product" и складывает классификацию в
 * scrape.caretobeauty_merge_candidates. ЧИСТО АНАЛИТИКА:
 *   — НИ ОДНОГО INSERT/UPDATE/MERGE в Product;
 *   — ничего из существующих данных не меняется.
 *
 * Переиспользует существующий механизм сопоставления (как в merge-inn-skin):
 *   • dm.brand_key / dm.name_key / dm.extract_volume / dm.is_valid_ean
 *   • pg_trgm similarity()  — функция похожести проекта (та же, что в поиске)
 *   • bounded candidate-pool в temp-таблице + statement_timeout (без скана 62k
 *     на каждую строку — защита от зависания).
 *
 * Запуск (tools-контейнер):
 *   npm run merge:caretobeauty -- --dry-run
 *   npm run merge:caretobeauty -- --dry-run --examples 20 --fuzzy 0.5
 *
 * Стадии сопоставления (по приоритету):
 *   1. MATCH_BY_EAN   caretobeauty.ean == Product.barcode        conf 1.00
 *   2. MATCH_BY_KEYS  brand_key+name_key совпали                 conf 0.90
 *        + volume совпал                                          conf 0.97
 *        + volume различается → conflict-overlay                  conf 0.70
 *   3. FUZZY          brand_key совпал, name_key похож (trgm)     conf 0.5..0.86
 *   4. NO_MATCH       нет кандидата → новый товар                 conf 0.00
 *   conflict — overlay-флаг (EAN→один Product, ключи→другой; либо объём разошёлся).
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (m: string) => console.log(m);
const ts = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

interface CliArgs {
  examples: number;
  fuzzy: number;
  apply: boolean;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false }, // информативно; режим всегда dry
      apply: { type: "boolean", default: false },
      examples: { type: "string", default: "15" },
      fuzzy: { type: "string", default: "0.45" },
    },
  });
  const examples = parseInt(String(values.examples), 10);
  const fuzzy = parseFloat(String(values.fuzzy));
  return {
    examples: Number.isFinite(examples) && examples > 0 ? examples : 15,
    fuzzy: Number.isFinite(fuzzy) && fuzzy > 0 && fuzzy < 1 ? fuzzy : 0.45,
    apply: Boolean(values.apply),
  };
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

async function main(): Promise<void> {
  const args = parseCli();
  if (args.apply) {
    ts("[merge caretobeauty] --apply ЗАПРЕЩЁН на этом этапе. В Product ничего не пишется. Работаю как dry-run.");
  }
  ts("[merge caretobeauty] DRY-RUN — только анализ, без записи в Product");

  await ensureSchema(ts);
  const prisma = getPrisma();

  // Пересобираем таблицу кандидатов каждый прогон.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE scrape.caretobeauty_merge_candidates`);

  const FUZZY = Prisma.raw(String(args.fuzzy)); // литерал в SQL (не bind-param)

  const t0 = Date.now();
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '90000'`);

      // ── Пул кандидатов: ОДИН проход по Product, только нужные brand_key,
      //    кап 1000/бренд. dm.name_key/extract_volume считаем для выживших. ──
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE _c2b_cand ON COMMIT DROP AS
        WITH involved AS (
          SELECT DISTINCT brand_key
          FROM scrape.caretobeauty_products_normalized
          WHERE coalesce(brand_key,'') <> ''
        ),
        scanned AS (
          SELECT p.id, p.barcode, p.brand, p.name, dm.brand_key(p.brand) AS bkey
          FROM "Product" p
          WHERE dm.brand_key(p.brand) IN (SELECT brand_key FROM involved)
        ),
        capped AS (
          SELECT id, barcode, brand, name, bkey,
                 row_number() OVER (PARTITION BY bkey ORDER BY id DESC) AS rn
          FROM scanned
        )
        SELECT id, barcode, brand, name, bkey,
               dm.name_key(name) AS nkey, dm.extract_volume(name) AS pvol
        FROM capped WHERE rn <= 1000
      `);
      const cnt = await tx.$queryRaw<{ c: bigint }[]>(
        Prisma.sql`SELECT count(*) AS c FROM _c2b_cand`,
      );
      ts(`[merge caretobeauty] candidate pool (Product rows): ${n(cnt[0]?.c)}`);

      // ── Классификация + персист в candidates ──
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO scrape.caretobeauty_merge_candidates (
          c2b_ref, ean, brand_key, name_key, volume, match_type, conflict,
          product_id, product_barcode, product_brand, product_name, product_volume,
          confidence, reason, comments
        )
        SELECT
          j.c2b_ref, j.ean, j.brand_key, j.name_key, j.volume,
          j.match_type, j.conflict,
          j.product_id, j.product_barcode, j.product_brand, j.product_name, j.product_volume,
          j.confidence, j.reason,
          jsonb_build_object(
            'ean_match_id', j.em_id, 'key_match_id', j.km_id,
            'fuzzy_match_id', j.fz_id, 'fuzzy_sim', j.fz_sim,
            'c2b_volume', j.volume, 'product_volume', j.product_volume
          )
        FROM (
          SELECT
            c.source_ref AS c2b_ref, c.ean, c.brand_key, c.name_key, c.volume,
            em.id AS em_id, km.id AS km_id, fz.id AS fz_id, fz.sim AS fz_sim,
            CASE
              WHEN em.id IS NOT NULL THEN 'MATCH_BY_EAN'
              WHEN km.id IS NOT NULL THEN 'MATCH_BY_KEYS'
              WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN 'FUZZY'
              ELSE 'NO_MATCH'
            END AS match_type,
            CASE WHEN em.id IS NOT NULL THEN em.id WHEN km.id IS NOT NULL THEN km.id
                 WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN fz.id END AS product_id,
            CASE WHEN em.id IS NOT NULL THEN em.barcode WHEN km.id IS NOT NULL THEN km.barcode
                 WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN fz.barcode END AS product_barcode,
            CASE WHEN em.id IS NOT NULL THEN em.brand WHEN km.id IS NOT NULL THEN km.brand
                 WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN fz.brand END AS product_brand,
            CASE WHEN em.id IS NOT NULL THEN em.name WHEN km.id IS NOT NULL THEN km.name
                 WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN fz.name END AS product_name,
            CASE WHEN em.id IS NOT NULL THEN em.pvol WHEN km.id IS NOT NULL THEN km.pvol
                 WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN fz.pvol END AS product_volume,
            CASE
              WHEN em.id IS NOT NULL THEN 1.00
              WHEN km.id IS NOT NULL THEN
                CASE WHEN coalesce(c.volume,'') <> '' AND coalesce(km.pvol,'') <> '' THEN
                       CASE WHEN c.volume = km.pvol THEN 0.97 ELSE 0.70 END
                     ELSE 0.90 END
              WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY} THEN round((0.50 + 0.40 * fz.sim)::numeric, 2)
              ELSE 0.0
            END AS confidence,
            CASE
              WHEN em.id IS NOT NULL AND km.id IS NOT NULL AND km.id <> em.id THEN true
              WHEN em.id IS NULL AND km.id IS NOT NULL
                   AND coalesce(c.volume,'') <> '' AND coalesce(km.pvol,'') <> ''
                   AND c.volume <> km.pvol THEN true
              ELSE false
            END AS conflict,
            CASE
              WHEN em.id IS NOT NULL AND km.id IS NOT NULL AND km.id <> em.id
                THEN 'EAN→' || em.id || ' но ключи→' || km.id
              WHEN em.id IS NOT NULL THEN 'exact ean = barcode'
              WHEN km.id IS NOT NULL AND coalesce(c.volume,'') <> '' AND coalesce(km.pvol,'') <> '' AND c.volume <> km.pvol
                THEN 'ключи совпали, объём различается (' || c.volume || ' vs ' || km.pvol || ')'
              WHEN km.id IS NOT NULL AND coalesce(c.volume,'') <> '' AND c.volume = km.pvol
                THEN 'brand_key+name_key+volume'
              WHEN km.id IS NOT NULL THEN 'brand_key+name_key'
              WHEN fz.id IS NOT NULL AND fz.sim >= ${FUZZY}
                THEN 'fuzzy name_key sim=' || round(fz.sim::numeric, 2)
              ELSE 'нет кандидата в каталоге'
            END AS reason
          FROM scrape.caretobeauty_products_normalized c
          LEFT JOIN LATERAL (
            SELECT p.id, p.barcode, p.brand, p.name, dm.extract_volume(p.name) AS pvol
            FROM "Product" p
            WHERE c.has_valid_ean AND c.ean IS NOT NULL AND p.barcode = c.ean
            LIMIT 1
          ) em ON true
          LEFT JOIN LATERAL (
            SELECT cand.id, cand.barcode, cand.brand, cand.name, cand.pvol
            FROM _c2b_cand cand
            WHERE coalesce(c.brand_key,'') <> '' AND cand.bkey = c.brand_key AND cand.nkey = c.name_key
            LIMIT 1
          ) km ON true
          LEFT JOIN LATERAL (
            SELECT cand.id, cand.barcode, cand.brand, cand.name, cand.pvol,
                   similarity(cand.nkey, coalesce(c.name_key,'')) AS sim
            FROM _c2b_cand cand
            WHERE coalesce(c.brand_key,'') <> '' AND cand.bkey = c.brand_key
            ORDER BY similarity(cand.nkey, coalesce(c.name_key,'')) DESC NULLS LAST
            LIMIT 1
          ) fz ON true
        ) j
      `);
    },
    { timeout: 120_000, maxWait: 5_000 },
  );
  ts(`[merge caretobeauty] classified in ${Date.now() - t0}ms`);

  await report(prisma, args);
}

/* ───────── отчёт ───────── */

async function report(
  prisma: ReturnType<typeof getPrisma>,
  args: CliArgs,
): Promise<void> {
  const counts = await prisma.$queryRaw<
    { match_type: string; c: bigint; conflicts: bigint }[]
  >(Prisma.sql`
    SELECT match_type, count(*) AS c,
           count(*) FILTER (WHERE conflict) AS conflicts
    FROM scrape.caretobeauty_merge_candidates
    GROUP BY match_type
  `);
  const by = new Map(counts.map((r) => [r.match_type, n(r.c)]));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const ean = by.get("MATCH_BY_EAN") ?? 0;
  const keys = by.get("MATCH_BY_KEYS") ?? 0;
  const fuzzy = by.get("FUZZY") ?? 0;
  const fresh = by.get("NO_MATCH") ?? 0;
  const conflicts = counts.reduce((a, r) => a + n(r.conflicts), 0);
  const matched = ean + keys + fuzzy;
  const coverage = total > 0 ? (matched / total) * 100 : 0;

  const topMatches = await prisma.$queryRaw<
    { match_type: string; confidence: number; cn: string | null; pn: string | null; ean: string | null }[]
  >(Prisma.sql`
    SELECT match_type, confidence::float8 AS confidence,
           (SELECT product_name_normalized FROM scrape.caretobeauty_products_normalized z WHERE z.source_ref = m.c2b_ref) AS cn,
           product_name AS pn, ean
    FROM scrape.caretobeauty_merge_candidates m
    WHERE match_type <> 'NO_MATCH' AND NOT conflict
    ORDER BY confidence DESC, match_type
    LIMIT ${args.examples}
  `);

  const topNew = await prisma.$queryRaw<
    { brand_key: string | null; cn: string | null; ean: string | null }[]
  >(Prisma.sql`
    SELECT m.brand_key, m.ean,
           (SELECT product_name_normalized FROM scrape.caretobeauty_products_normalized z WHERE z.source_ref = m.c2b_ref) AS cn
    FROM scrape.caretobeauty_merge_candidates m
    WHERE match_type = 'NO_MATCH'
    ORDER BY m.brand_key NULLS LAST
    LIMIT ${args.examples}
  `);

  const topConflicts = await prisma.$queryRaw<
    {
      cn: string | null; ean: string | null; volume: string | null;
      product_id: string | null; product_name: string | null;
      product_barcode: string | null; product_volume: string | null; reason: string | null;
    }[]
  >(Prisma.sql`
    SELECT
      (SELECT product_name_normalized FROM scrape.caretobeauty_products_normalized z WHERE z.source_ref = m.c2b_ref) AS cn,
      m.ean, m.volume, m.product_id, m.product_name, m.product_barcode, m.product_volume, m.reason
    FROM scrape.caretobeauty_merge_candidates m
    WHERE conflict
    ORDER BY confidence DESC
    LIMIT ${args.examples}
  `);

  log("");
  log("══════════ Care to Beauty → Product · DRY RUN ══════════");
  log(`Всего товаров Care to Beauty:   ${total}`);
  log("");
  log(`MATCH_BY_EAN:    ${ean}`);
  log(`MATCH_BY_KEYS:   ${keys}`);
  log(`FUZZY:           ${fuzzy}`);
  log(`Новые товары:    ${fresh}`);
  log(`Конфликты:       ${conflicts}  (overlay-флаг поверх совпавших)`);
  log("-------------------------------------------------------");
  log(`Покрытие каталога: ${coverage.toFixed(1)}%  (matched ${matched}/${total})`);
  log("-------------------------------------------------------");
  log(`TOP совпадений (до ${args.examples}):`);
  if (topMatches.length === 0) log("  (нет)");
  for (const r of topMatches) {
    log(
      `  • [${r.confidence.toFixed(2)} ${r.match_type.replace("MATCH_BY_", "")}] ` +
        `"${trunc(r.cn, 34)}" → "${trunc(r.pn, 38)}"${r.ean ? ` (ean ${r.ean})` : ""}`,
    );
  }
  log("-------------------------------------------------------");
  log(`TOP новых товаров (до ${args.examples}):`);
  if (topNew.length === 0) log("  (нет)");
  for (const r of topNew) {
    log(`  • [${r.brand_key ?? "—"}] "${trunc(r.cn, 40)}"${r.ean ? ` ean=${r.ean}` : ""}`);
  }
  log("-------------------------------------------------------");
  log(`TOP конфликтов (до ${args.examples}):`);
  if (topConflicts.length === 0) log("  (нет)");
  for (const r of topConflicts) {
    log("  ┌─ Care to Beauty");
    log(`  │   name=${trunc(r.cn, 46)}`);
    log(`  │   ean=${r.ean ?? "—"}  volume=${r.volume ?? "—"}`);
    log("  │ ↓ Product");
    log(`  │   id=${r.product_id ?? "—"}  barcode=${r.product_barcode ?? "—"}`);
    log(`  │   name=${trunc(r.product_name, 46)}  volume=${r.product_volume ?? "—"}`);
    log(`  └ причина: ${r.reason ?? "—"}`);
  }
  log("");
  log("ПОЛИТИКА: 0 записей/изменений в Product. Результат — только в");
  log("scrape.caretobeauty_merge_candidates (анализируйте SQL-запросами).");
  log("════════════════════════════════════════════════════════");
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
