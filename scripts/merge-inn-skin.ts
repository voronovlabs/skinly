/**
 * Skinly · DRY-RUN сверка · inn-skin staging ↔ public."Product"
 *
 * Запуск:
 *   npm run merge:inn-skin            # отчёт, НИЧЕГО не пишет
 *   npm run merge:inn-skin -- --examples 10
 *
 * Что делает (только чтение):
 *   1. Считает staging (raw + normalized).
 *   2. Делит нормализованные строки по сценарию слияния:
 *        - eligible-by-EAN   : есть валидный EAN (для inn-skin = 0)
 *        - matched-high      : совпало с Product по brand+name (sim ≥ 0.60)
 *        - matched-low       : слабое совпадение (0.35 ≤ sim < 0.60)
 *        - would-be-new      : нет совпадения в Product
 *   3. Печатает 5 примеров товаров, 5 примеров совпадений, качество INCI.
 *
 * ВАЖНО (политика идентификаторов): товары без настоящего EAN НЕ
 * сливаются в public."Product". Они остаются в staging, в отчёте видно,
 * что бы совпало. Реальный merge включим, когда спроектируем канонический
 * идентификатор для товаров без EAN. Поэтому `--apply` намеренно запрещён.
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (msg: string) => console.log(msg);
const ts = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const HIGH = 0.6;
const LOW = 0.35;

interface CliArgs {
  examples: number;
  apply: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      examples: { type: "string", default: "5" },
      apply: { type: "boolean", default: false },
    },
  });
  const examples = parseInt(String(values.examples), 10);
  return {
    examples: Number.isFinite(examples) && examples > 0 ? examples : 5,
    apply: Boolean(values.apply),
  };
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

async function main(): Promise<void> {
  const args = parseCli();
  if (args.apply) {
    ts(
      "[merge inn-skin] --apply ЗАПРЕЩЁН: товары без настоящего EAN не сливаются в Product. " +
        "Сначала проектируем канонический идентификатор. Запускаю как dry-run.",
    );
  }
  ts("[merge inn-skin] DRY-RUN — ничего не пишется в Product");

  await ensureSchema(ts);
  const prisma = getPrisma();

  /* ── staging counts ── */
  const counts = await prisma.$queryRaw<
    { raw: bigint; norm: bigint }[]
  >(Prisma.sql`
    SELECT
      (SELECT count(*) FROM scrape.inn_skin_products)             AS raw,
      (SELECT count(*) FROM scrape.inn_skin_products_normalized)  AS norm
  `);
  const rawN = n(counts[0]?.raw);
  const normN = n(counts[0]?.norm);

  /* ──────────────────────────────────────────────────────────────────────
   * Bounded matching (быстро, без зависаний).
   *
   * Старый путь делал LATERAL по всему "Product" (62k) с пересчётом
   * dm.brand_key/dm.name_key и ORDER BY similarity ДЛЯ КАЖДОЙ staging-строки
   * → O(rows × каталог) + сортировки → зависание.
   *
   * Новый путь:
   *   1. ОДИН проход по Product → temp-пул кандидатов, ограниченный реально
   *      встречающимися brand_key (из staging) и капом 500 строк на бренд.
   *   2. 24 staging-строки матчатся против КРОШЕЧНОГО пула, а не каталога.
   * Всё в одной транзакции (temp-таблицы живут до COMMIT) + statement_timeout
   * как страховка от зависания.
   *
   * (Опциональный буст на будущее, если каталог сильно вырастет:
   *  CREATE INDEX ON "Product" (dm.brand_key(brand)); — тогда п.1 пойдёт по
   *  индексу. Сейчас не добавляем, чтобы не трогать витрину.)
   * ────────────────────────────────────────────────────────────────────── */
  type BucketRow = {
    eligible_ean: bigint;
    matched_high: bigint;
    matched_low: bigint;
    would_new: bigint;
  };
  type MatchRow = {
    staged: string | null;
    product: string | null;
    p_brand: string | null;
    sim: number | null;
  };

  let b: BucketRow | undefined;
  let matches: MatchRow[] = [];

  if (normN === 0) {
    ts("[merge inn-skin] staging пуст — сначала scrape + normalize. Матчинг пропущен.");
  } else {
    const tStart = Date.now();
    try {
      const out = await prisma.$transaction(
        async (tx) => {
          // Страховка: не висеть дольше 20с — упасть с понятной ошибкой.
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '20000'`);

          // Пул кандидатов: один seq-scan Product, фильтр по brand_key из
          // staging, кап 500 строк на бренд. name_key считаем только для
          // выживших строк (после фильтра и капа).
          await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE _inn_cand ON COMMIT DROP AS
            WITH involved AS (
              SELECT DISTINCT brand_key
              FROM scrape.inn_skin_products_normalized
              WHERE coalesce(brand_key,'') <> ''
            ),
            scanned AS (
              SELECT pr.id, pr.brand, pr.name, dm.brand_key(pr.brand) AS bkey
              FROM "Product" pr
              WHERE dm.brand_key(pr.brand) IN (SELECT brand_key FROM involved)
            ),
            capped AS (
              SELECT id, brand, name, bkey,
                     row_number() OVER (PARTITION BY bkey ORDER BY id DESC) AS rn
              FROM scanned
            )
            SELECT id, brand, name, bkey, dm.name_key(name) AS nkey
            FROM capped
            WHERE rn <= 500
          `);

          // Лучшее совпадение для каждой staging-строки против мелкого пула.
          await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE _inn_match ON COMMIT DROP AS
            SELECT
              nrm.source_product_id,
              nrm.has_valid_ean,
              nrm.product_name_normalized,
              m.name  AS product_name,
              m.brand AS product_brand,
              m.sim
            FROM scrape.inn_skin_products_normalized nrm
            LEFT JOIN LATERAL (
              SELECT c.name, c.brand,
                     similarity(c.nkey, coalesce(nrm.name_key,'')) AS sim
              FROM _inn_cand c
              WHERE coalesce(nrm.brand_key,'') <> ''
                AND c.bkey = nrm.brand_key
              ORDER BY similarity(c.nkey, coalesce(nrm.name_key,'')) DESC NULLS LAST
              LIMIT 1
            ) m ON true
          `);

          const candCount = await tx.$queryRaw<{ cnt: bigint }[]>(
            Prisma.sql`SELECT count(*) AS cnt FROM _inn_cand`,
          );
          ts(`[merge inn-skin] candidate pool: ${n(candCount[0]?.cnt)} Product rows`);

          const bucketRows = await tx.$queryRaw<BucketRow[]>(Prisma.sql`
            SELECT
              count(*) FILTER (WHERE has_valid_ean)                              AS eligible_ean,
              count(*) FILTER (WHERE NOT has_valid_ean AND sim >= ${HIGH})       AS matched_high,
              count(*) FILTER (WHERE NOT has_valid_ean AND sim >= ${LOW} AND sim < ${HIGH}) AS matched_low,
              count(*) FILTER (WHERE NOT has_valid_ean AND (sim IS NULL OR sim < ${LOW}))   AS would_new
            FROM _inn_match
          `);

          const matchRows = await tx.$queryRaw<MatchRow[]>(Prisma.sql`
            SELECT
              product_name_normalized AS staged,
              product_name            AS product,
              product_brand           AS p_brand,
              sim
            FROM _inn_match
            WHERE sim >= ${LOW}
            ORDER BY sim DESC NULLS LAST
            LIMIT ${args.examples}
          `);

          return { bucketRows, matchRows };
        },
        { timeout: 25_000, maxWait: 5_000 },
      );

      b = out.bucketRows[0];
      matches = out.matchRows;
      ts(`[merge inn-skin] matching done in ${Date.now() - tStart}ms`);
    } catch (e) {
      ts(
        `[merge inn-skin] матчинг прерван (${Date.now() - tStart}ms): ${
          e instanceof Error ? e.message : String(e)
        }. Печатаю отчёт без блока совпадений.`,
      );
    }
  }

  /* ── INCI quality ── */
  const inci = await prisma.$queryRaw<
    { with_inci: bigint; avg_len: number | null; avg_tokens: number | null }[]
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE coalesce(ingredients_raw,'') <> '')          AS with_inci,
      avg(length(ingredients_raw)) FILTER (WHERE coalesce(ingredients_raw,'') <> '') AS avg_len,
      avg(coalesce(array_length(ingredients_normalized,1),0))
        FILTER (WHERE ingredients_normalized IS NOT NULL)                 AS avg_tokens
    FROM scrape.inn_skin_products_normalized
  `);
  const iq = inci[0];

  /* ── 5 примеров товаров ── */
  const sample = await prisma.$queryRaw<
    {
      brand_normalized: string | null;
      product_name_normalized: string | null;
      category: string | null;
      retailer_article: string | null;
      price_value: number | null;
      has_inci: boolean;
    }[]
  >(Prisma.sql`
    SELECT
      nrm.brand_normalized,
      nrm.product_name_normalized,
      nrm.category,
      nrm.retailer_article,
      s.price_value,
      (coalesce(nrm.ingredients_raw,'') <> '') AS has_inci
    FROM scrape.inn_skin_products_normalized nrm
    JOIN scrape.inn_skin_products s ON s.id = nrm.source_product_id
    ORDER BY s.created_at ASC
    LIMIT ${args.examples}
  `);

  /* (примеры совпадений уже посчитаны выше в одной транзакции — `matches`) */

  /* ── печать отчёта ── */
  log("");
  log("════════════════ inn-skin · DRY-RUN MERGE REPORT ════════════════");
  log(`staging raw rows:          ${rawN}`);
  log(`staging normalized rows:   ${normN}`);
  log("");
  log("сценарий слияния (нормализованные строки):");
  log(`  eligible by real EAN:    ${n(b?.eligible_ean)}  → можно слить в Product`);
  log(`  matched high (sim≥${HIGH}):  ${n(b?.matched_high)}  → вероятно тот же товар в Product`);
  log(`  matched low  (≥${LOW}):    ${n(b?.matched_low)}  → требует ручной проверки`);
  log(`  would-be-new (no match): ${n(b?.would_new)}  → нет в Product`);
  log("");
  log(
    "ПОЛИТИКА: 0 товаров слито в Product. Источник даёт только артикулы " +
      "продавца (не EAN) → всё держим в staging до канонического ID.",
  );
  log("");
  log("INCI quality:");
  log(`  with INCI:               ${n(iq?.with_inci)} / ${normN}`);
  log(`  avg INCI length (chars): ${iq?.avg_len ? Math.round(iq.avg_len) : 0}`);
  log(`  avg parsed tokens:       ${iq?.avg_tokens ? Math.round(iq.avg_tokens) : 0}`);
  log("");
  log(`примеры товаров (до ${args.examples}):`);
  for (const r of sample) {
    log(
      `  • [${r.brand_normalized ?? "—"}] ${trunc(r.product_name_normalized, 46)} ` +
        `| ${r.category ?? "—"} | art=${r.retailer_article ?? "—"} ` +
        `| ${r.price_value ?? "—"}₽ | inci=${r.has_inci ? "yes" : "no"}`,
    );
  }
  log("");
  log(`примеры совпадений с Product (sim≥${LOW}, до ${args.examples}):`);
  if (matches.length === 0) {
    log("  (нет совпадений — все товары новые относительно текущего каталога)");
  } else {
    for (const r of matches) {
      log(
        `  • "${trunc(r.staged, 40)}" ≈ "${trunc(r.product, 40)}" ` +
          `[${r.p_brand ?? "—"}] sim=${r.sim?.toFixed(2) ?? "—"}`,
      );
    }
  }
  log("═════════════════════════════════════════════════════════════════");
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
