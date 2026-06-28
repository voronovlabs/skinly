/**
 * Skinly · DRY-RUN MERGE · Care to Beauty ↔ public."Product"
 *
 * Анализ пересечения scrape.caretobeauty_products_normalized с public."Product".
 * ЧИСТО АНАЛИТИКА: ни одного INSERT/UPDATE/MERGE в Product.
 *
 * Два режима (fuzzy НЕ обязателен и по умолчанию ВЫКЛЮЧЕН):
 *
 *   БЫСТРЫЙ (default / --no-fuzzy):
 *     1. MATCH_BY_EAN   — Product.barcode = c2b.ean (прямой индексный join)
 *     2. MATCH_BY_KEYS  — brand_key + name_key (через temp-таблицу ключей Product)
 *     3. NO_MATCH       — новый товар
 *     БЕЗ pg_trgm, БЕЗ similarity. Пересоздаёт таблицу кандидатов.
 *
 *   FUZZY-only (--fuzzy-only):
 *     апгрейдит ТОЛЬКО строки, оставшиеся NO_MATCH, через similarity() по
 *     уже построенной temp-таблице ключей. Ограничен --fuzzy-limit.
 *
 * Оптимизация: dm.brand_key/dm.name_key/dm.extract_volume по Product считаются
 * ОДИН раз → temp `_c2b_pkeys` (+ индексы). Дальше только exact joins; fuzzy —
 * лишь по остатку. Тяжёлый similarity не блокирует основной отчёт.
 *
 * Запуск (tools-контейнер):
 *   npm run merge:caretobeauty -- --dry-run --no-fuzzy            # быстро
 *   npm run merge:caretobeauty -- --dry-run --fuzzy-only --fuzzy-limit 300
 *   npm run merge:caretobeauty -- --dry-run --statement-timeout-ms 60000
 */

import { parseArgs } from "node:util";
import { Prisma, type PrismaClient } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (m: string) => console.log(m);
const ts = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

interface CliArgs {
  examples: number;
  fuzzyThreshold: number;
  fuzzyOnly: boolean;
  noFuzzy: boolean;
  fuzzyLimit: number;
  statementTimeoutMs: number;
  apply: boolean;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false }, // информативно; режим всегда dry
      apply: { type: "boolean", default: false },
      "no-fuzzy": { type: "boolean", default: false },
      "fuzzy-only": { type: "boolean", default: false },
      "fuzzy-limit": { type: "string", default: "500" },
      "fuzzy-threshold": { type: "string", default: "0.45" },
      "statement-timeout-ms": { type: "string", default: "30000" },
      examples: { type: "string", default: "15" },
    },
  });
  const int = (v: unknown, d: number, min = 1): number => {
    const x = parseInt(String(v), 10);
    return Number.isFinite(x) && x >= min ? x : d;
  };
  const thr = parseFloat(String(values["fuzzy-threshold"]));
  return {
    examples: int(values.examples, 15),
    fuzzyThreshold: Number.isFinite(thr) && thr > 0 && thr < 1 ? thr : 0.45,
    fuzzyOnly: Boolean(values["fuzzy-only"]),
    noFuzzy: Boolean(values["no-fuzzy"]),
    fuzzyLimit: int(values["fuzzy-limit"], 500),
    statementTimeoutMs: int(values["statement-timeout-ms"], 30000, 1000),
    apply: Boolean(values.apply),
  };
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/* ───────── shared: temp product-keys pool (один раз) ───────── */

async function buildProductKeys(
  tx: Prisma.TransactionClient,
): Promise<number> {
  // dm.brand_key по Product считается ОДИН раз (фильтр по нужным брендам),
  // dm.name_key/extract_volume — только для выживших строк.
  await tx.$executeRawUnsafe(`
    CREATE TEMP TABLE _c2b_pkeys ON COMMIT DROP AS
    WITH involved AS (
      SELECT DISTINCT brand_key
      FROM scrape.caretobeauty_products_normalized
      WHERE coalesce(brand_key,'') <> ''
    )
    SELECT p.id AS product_id, p.barcode,
           dm.brand_key(p.brand)    AS brand_key,
           dm.name_key(p.name)      AS name_key,
           dm.extract_volume(p.name) AS volume,
           p.name  AS product_name,
           p.brand AS product_brand
    FROM "Product" p
    WHERE dm.brand_key(p.brand) IN (SELECT brand_key FROM involved)
  `);
  await tx.$executeRawUnsafe(`CREATE INDEX ON _c2b_pkeys (brand_key, name_key)`);
  await tx.$executeRawUnsafe(`CREATE INDEX ON _c2b_pkeys (brand_key)`);
  await tx.$executeRawUnsafe(`ANALYZE _c2b_pkeys`);
  const r = await tx.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM _c2b_pkeys`,
  );
  return n(r[0]?.c);
}

/* ───────── fast: exact EAN + KEYS ───────── */

async function runExact(prisma: PrismaClient, args: CliArgs): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE scrape.caretobeauty_merge_candidates`);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${args.statementTimeoutMs}'`);

      let t = Date.now();
      const pool = await buildProductKeys(tx);
      ts(`[exact] product-keys pool=${pool} rows · ${Date.now() - t}ms`);

      t = Date.now();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO scrape.caretobeauty_merge_candidates (
          c2b_ref, ean, brand_key, name_key, volume, match_type, conflict,
          product_id, product_barcode, product_brand, product_name, product_volume,
          confidence, reason, comments
        )
        SELECT
          c.source_ref, c.ean, c.brand_key, c.name_key, c.volume,
          CASE WHEN em.id IS NOT NULL THEN 'MATCH_BY_EAN'
               WHEN km.id IS NOT NULL THEN 'MATCH_BY_KEYS'
               ELSE 'NO_MATCH' END,
          CASE
            WHEN em.id IS NOT NULL AND km.id IS NOT NULL AND km.id <> em.id THEN true
            WHEN em.id IS NULL AND km.id IS NOT NULL
                 AND coalesce(c.volume,'') <> '' AND coalesce(km.pvol,'') <> ''
                 AND c.volume <> km.pvol THEN true
            ELSE false END,
          coalesce(em.id, km.id),
          coalesce(em.barcode, km.barcode),
          coalesce(em.brand, km.brand),
          coalesce(em.name, km.name),
          coalesce(em.pvol, km.pvol),
          CASE
            WHEN em.id IS NOT NULL THEN 1.00
            WHEN km.id IS NOT NULL THEN
              CASE WHEN coalesce(c.volume,'') <> '' AND coalesce(km.pvol,'') <> '' THEN
                     CASE WHEN c.volume = km.pvol THEN 0.97 ELSE 0.70 END
                   ELSE 0.90 END
            ELSE 0.0 END,
          CASE
            WHEN em.id IS NOT NULL AND km.id IS NOT NULL AND km.id <> em.id
              THEN 'EAN→' || em.id || ' но ключи→' || km.id
            WHEN em.id IS NOT NULL THEN 'exact ean = barcode'
            WHEN km.id IS NOT NULL AND coalesce(c.volume,'') <> '' AND coalesce(km.pvol,'') <> '' AND c.volume <> km.pvol
              THEN 'ключи совпали, объём различается (' || c.volume || ' vs ' || km.pvol || ')'
            WHEN km.id IS NOT NULL AND coalesce(c.volume,'') <> '' AND c.volume = km.pvol
              THEN 'brand_key+name_key+volume'
            WHEN km.id IS NOT NULL THEN 'brand_key+name_key'
            ELSE 'нет точного кандидата (fuzzy не запускался)' END,
          jsonb_build_object(
            'ean_match_id', em.id, 'key_match_id', km.id,
            'c2b_volume', c.volume, 'product_volume', coalesce(em.pvol, km.pvol)
          )
        FROM scrape.caretobeauty_products_normalized c
        LEFT JOIN LATERAL (
          SELECT p.id, p.barcode, p.brand, p.name, dm.extract_volume(p.name) AS pvol
          FROM "Product" p
          WHERE c.has_valid_ean AND c.ean IS NOT NULL AND p.barcode = c.ean
          LIMIT 1
        ) em ON true
        LEFT JOIN LATERAL (
          SELECT pk.product_id AS id, pk.barcode, pk.product_brand AS brand,
                 pk.product_name AS name, pk.volume AS pvol
          FROM _c2b_pkeys pk
          WHERE coalesce(c.brand_key,'') <> ''
            AND pk.brand_key = c.brand_key AND pk.name_key = c.name_key
          LIMIT 1
        ) km ON true
      `);
      ts(`[exact] classify (EAN+KEYS) · ${Date.now() - t}ms`);
    },
    { timeout: args.statementTimeoutMs + 30_000, maxWait: 5_000 },
  );
}

/* ───────── opt-in: fuzzy upgrade на остатке NO_MATCH ───────── */

async function runFuzzyOnly(prisma: PrismaClient, args: CliArgs): Promise<void> {
  const FUZZY = Prisma.raw(String(args.fuzzyThreshold));
  const pre = await prisma.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`SELECT count(*) AS c FROM scrape.caretobeauty_merge_candidates WHERE match_type = 'NO_MATCH'`,
  );
  const noMatch = n(pre[0]?.c);
  if (noMatch === 0) {
    ts("[fuzzy] нет NO_MATCH строк (сначала прогоните быстрый режим). Пропуск.");
    return;
  }
  ts(`[fuzzy] NO_MATCH к обработке: ${noMatch} (limit ${args.fuzzyLimit}, threshold ${args.fuzzyThreshold})`);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${args.statementTimeoutMs}'`);
      let t = Date.now();
      const pool = await buildProductKeys(tx);
      ts(`[fuzzy] product-keys pool=${pool} rows · ${Date.now() - t}ms`);

      t = Date.now();
      const updated = await tx.$executeRaw(Prisma.sql`
        WITH cand AS (
          SELECT m.id AS mid, c.brand_key, c.name_key, c.volume AS c_volume
          FROM scrape.caretobeauty_merge_candidates m
          JOIN scrape.caretobeauty_products_normalized c ON c.source_ref = m.c2b_ref
          WHERE m.match_type = 'NO_MATCH' AND coalesce(c.brand_key,'') <> ''
          ORDER BY m.id
          LIMIT ${args.fuzzyLimit}
        ),
        best AS (
          SELECT cand.mid, cand.c_volume,
                 fz.id, fz.barcode, fz.product_brand, fz.product_name, fz.pvol, fz.sim
          FROM cand
          LEFT JOIN LATERAL (
            SELECT pk.product_id AS id, pk.barcode, pk.product_brand, pk.product_name,
                   pk.volume AS pvol,
                   similarity(pk.name_key, coalesce(cand.name_key,'')) AS sim
            FROM _c2b_pkeys pk
            WHERE pk.brand_key = cand.brand_key
            ORDER BY similarity(pk.name_key, coalesce(cand.name_key,'')) DESC NULLS LAST
            LIMIT 1
          ) fz ON true
        )
        UPDATE scrape.caretobeauty_merge_candidates m SET
          match_type      = 'FUZZY',
          product_id      = best.id,
          product_barcode = best.barcode,
          product_brand   = best.product_brand,
          product_name    = best.product_name,
          product_volume  = best.pvol,
          confidence      = round((0.50 + 0.40 * best.sim)::numeric, 2),
          reason          = 'fuzzy name_key sim=' || round(best.sim::numeric, 2),
          comments        = jsonb_build_object(
                              'fuzzy_match_id', best.id, 'fuzzy_sim', best.sim,
                              'c2b_volume', best.c_volume, 'product_volume', best.pvol)
        FROM best
        WHERE m.id = best.mid AND best.id IS NOT NULL AND best.sim >= ${FUZZY}
      `);
      ts(`[fuzzy] upgraded NO_MATCH → FUZZY: ${updated} · ${Date.now() - t}ms`);
    },
    { timeout: args.statementTimeoutMs + 30_000, maxWait: 5_000 },
  );
}

/* ───────── main ───────── */

async function main(): Promise<void> {
  const args = parseCli();
  if (args.apply) {
    ts("[merge caretobeauty] --apply ЗАПРЕЩЁН. В Product ничего не пишется. Работаю как dry-run.");
  }
  ts(`[merge caretobeauty] DRY-RUN · mode=${args.fuzzyOnly ? "fuzzy-only" : "fast(exact)"} · stmt_timeout=${args.statementTimeoutMs}ms`);

  await ensureSchema(ts);
  const prisma = getPrisma();

  const t0 = Date.now();
  if (args.fuzzyOnly) {
    await runFuzzyOnly(prisma, args);
  } else {
    await runExact(prisma, args);
    if (args.noFuzzy) ts("[merge caretobeauty] --no-fuzzy: fuzzy-этап пропущен (быстрый режим).");
    else ts("[merge caretobeauty] fuzzy по умолчанию ВЫКЛЮЧЕН. Для апгрейда: -- --fuzzy-only");
  }
  ts(`[merge caretobeauty] stage done · ${Date.now() - t0}ms`);

  await report(prisma, args);
}

/* ───────── отчёт ───────── */

async function report(prisma: PrismaClient, args: CliArgs): Promise<void> {
  const counts = await prisma.$queryRaw<
    { match_type: string; c: bigint; conflicts: bigint }[]
  >(Prisma.sql`
    SELECT match_type, count(*) AS c, count(*) FILTER (WHERE conflict) AS conflicts
    FROM scrape.caretobeauty_merge_candidates GROUP BY match_type
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
    ORDER BY confidence DESC, match_type LIMIT ${args.examples}
  `);
  const topNew = await prisma.$queryRaw<
    { brand_key: string | null; cn: string | null; ean: string | null }[]
  >(Prisma.sql`
    SELECT m.brand_key, m.ean,
           (SELECT product_name_normalized FROM scrape.caretobeauty_products_normalized z WHERE z.source_ref = m.c2b_ref) AS cn
    FROM scrape.caretobeauty_merge_candidates m
    WHERE match_type = 'NO_MATCH' ORDER BY m.brand_key NULLS LAST LIMIT ${args.examples}
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
    WHERE conflict ORDER BY confidence DESC LIMIT ${args.examples}
  `);

  log("");
  log("══════════ Care to Beauty → Product · DRY RUN ══════════");
  log(`Всего товаров Care to Beauty:   ${total}`);
  log("");
  log(`MATCH_BY_EAN:    ${ean}`);
  log(`MATCH_BY_KEYS:   ${keys}`);
  log(`FUZZY:           ${fuzzy}${fuzzy === 0 ? "  (fuzzy не запускался — см. --fuzzy-only)" : ""}`);
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
