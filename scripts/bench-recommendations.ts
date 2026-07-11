/**
 * Bench recommendations pipeline — реальные измерения на живой БД.
 *
 * Меряет ВЕСЬ серверный путь GET /api/v1/recommendations (seed-режим карточки
 * товара — основной сценарий, плюс profile-режим) с разбивкой по этапам:
 *   getRecoSeed → buildPreference → getRecoSeedCandidates →
 *   preScore → getDmCompatibilityInputs → jsScoring (facts/engine) → buildItems
 * и дополнительно:
 *   • статистика БД (объёмы, размеры, категории);
 *   • проверка индексов из scripts/sql/reco-indexes.sql;
 *   • EXPLAIN (ANALYZE, BUFFERS) для всех SQL-запросов пайплайна;
 *   • (опция --url) HTTP end-to-end: TTFB + total + размер ответа.
 *
 * Запуск (нужен DATABASE_URL с dm-слоем):
 *   npx tsx scripts/bench-recommendations.ts | tee reco-bench.log
 *   npx tsx scripts/bench-recommendations.ts --barcode 4600702084566
 *   npx tsx scripts/bench-recommendations.ts --url http://localhost:3000
 *   npx tsx scripts/bench-recommendations.ts --runs 9
 *
 * Скрипт read-only: ничего не пишет в БД, продуктовый код не меняет.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRecommendations } from "@/lib/recommendations/service";
import { getRecoSeed } from "@/lib/db/repositories/dm-recommendations";
import type { RecoTimer } from "@/lib/recommendations/timing";
import type { Subject } from "@/lib/recommendations/types";
import type { SkinProfileSummaryLike } from "@/lib/compatibility";

/* ───────────────────────── CLI args ───────────────────────── */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const ARG_BARCODE = arg("barcode");
const ARG_URL = arg("url"); // например http://localhost:3000
const RUNS = Math.max(3, Number(arg("runs") ?? 7));

/** Профиль «худшего случая»: триггерит sensitivity/avoided/concern-правила. */
const FULL_PROFILE: SkinProfileSummaryLike = {
  skinType: "dry",
  sensitivity: "high",
  concerns: ["redness", "acne"],
  avoidedList: ["fragrance"],
  goal: "hydration",
};

/* ───────────────────── Collecting timer ───────────────────── */

interface RunResult {
  total: number;
  stages: Map<string, number>;
  meta: string;
  items: number;
}

function createCollectingTimer(): { timer: RecoTimer; result: RunResult } {
  const result: RunResult = {
    total: 0,
    stages: new Map(),
    meta: "",
    items: 0,
  };
  const startedAt = performance.now();
  const timer: RecoTimer = {
    enabled: true,
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        result.stages.set(
          label,
          (result.stages.get(label) ?? 0) + performance.now() - t0,
        );
      }
    },
    timeSync<T>(label: string, fn: () => T): T {
      const t0 = performance.now();
      try {
        return fn();
      } finally {
        result.stages.set(
          label,
          (result.stages.get(label) ?? 0) + performance.now() - t0,
        );
      }
    },
    mark(label: string, ms: number): void {
      result.stages.set(label, (result.stages.get(label) ?? 0) + ms);
    },
    note(meta: string): void {
      result.meta = meta;
    },
    flush(): void {
      result.total = performance.now() - startedAt;
    },
  };
  return { timer, result };
}

/* ───────────────────────── Stats utils ───────────────────────── */

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

function fmt(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms.toFixed(1);
}

function hr(title: string): void {
  console.log(`\n${"═".repeat(78)}\n  ${title}\n${"═".repeat(78)}`);
}

/* ───────────────────── 1. DB statistics ───────────────────── */

async function printDbStats(): Promise<void> {
  hr("1. БД: объёмы и распределение");

  const counts = await prisma.$queryRaw<
    { rel: string; n: number; size: string }[]
  >(Prisma.sql`
    SELECT * FROM (
      SELECT 'dm.dm_products' AS rel, count(*)::int AS n,
             pg_size_pretty(pg_total_relation_size('dm.dm_products')) AS size
      FROM dm.dm_products
      UNION ALL
      SELECT 'dm.product_ingredient_features', count(*)::int,
             pg_size_pretty(pg_total_relation_size('dm.product_ingredient_features'))
      FROM dm.product_ingredient_features
      UNION ALL
      SELECT 'dm.ingredients_canonical', count(*)::int,
             pg_size_pretty(pg_total_relation_size('dm.ingredients_canonical'))
      FROM dm.ingredients_canonical
      UNION ALL
      SELECT 'dm.ingredient_properties', count(*)::int,
             pg_size_pretty(pg_total_relation_size('dm.ingredient_properties'))
      FROM dm.ingredient_properties
      UNION ALL
      SELECT 'public.UserProductEvent', count(*)::int,
             pg_size_pretty(pg_total_relation_size('"UserProductEvent"'))
      FROM "UserProductEvent"
    ) t
  `);
  for (const c of counts) {
    console.log(`  ${c.rel.padEnd(38)} ${String(c.n).padStart(8)} rows  ${c.size}`);
  }

  // Категории ПОСЛЕ gates — реальный размер пула кандидатов seed-режима.
  const cats = await prisma.$queryRaw<
    { category: string; n: number; avg_cset: number }[]
  >(Prisma.sql`
    SELECT p.category, count(*)::int AS n,
           round(avg(jsonb_array_length(f.canonical_ingredients)))::int AS avg_cset
    FROM dm.dm_products p
    JOIN dm.product_ingredient_features f USING (business_key)
    WHERE p.barcode IS NOT NULL
      AND p.image_url IS NOT NULL
      AND p.image_url !~* '1x1|placeholder|no[-_]image|default'
      AND p.brand_normalized IS NOT NULL
      AND p.category <> 'Прочее'
      AND p.quality_score >= 50
      AND f.recognized_ratio >= 0.3
    GROUP BY 1 ORDER BY n DESC
  `);
  console.log("\n  Категории после gates (= пул seed-кандидатов):");
  for (const c of cats) {
    console.log(
      `    ${c.category.padEnd(24)} ${String(c.n).padStart(7)} товаров, ср. состав ${c.avg_cset} canonical`,
    );
  }
}

/* ───────────────────── 2. Index check ───────────────────── */

const EXPECTED_INDEXES = [
  "idx_dm_products_barcode",
  "idx_dm_products_business_key",
  "idx_pif_business_key",
  "idx_dm_products_category_quality",
  "idx_dm_products_profile_feed",
  "idx_ingredients_canonical_id",
  "idx_ingredient_properties_id",
];

async function printIndexCheck(): Promise<void> {
  hr("2. Индексы (scripts/sql/reco-indexes.sql)");
  const rows = await prisma.$queryRaw<{ indexname: string; tablename: string }[]>(
    Prisma.sql`
      SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'dm'
    `,
  );
  const present = new Set(rows.map((r) => r.indexname));
  for (const idx of EXPECTED_INDEXES) {
    console.log(`  ${present.has(idx) ? "✅" : "❌ ОТСУТСТВУЕТ"}  ${idx}`);
  }
  const extra = rows.filter((r) => !EXPECTED_INDEXES.includes(r.indexname));
  if (extra.length) {
    console.log("  Прочие индексы dm.*:");
    for (const r of extra) console.log(`    · ${r.indexname} (${r.tablename})`);
  }
}

/* ───────────────────── 3. Seed selection ───────────────────── */

interface SeedPick {
  barcode: string;
  category: string;
  cat_size: number;
  cset_len: number;
}

async function pickSeeds(): Promise<SeedPick[]> {
  if (ARG_BARCODE) {
    const rows = await prisma.$queryRaw<SeedPick[]>(Prisma.sql`
      SELECT p.barcode, p.category,
             (SELECT count(*)::int FROM dm.dm_products p2 WHERE p2.category = p.category) AS cat_size,
             jsonb_array_length(f.canonical_ingredients)::int AS cset_len
      FROM dm.dm_products p
      JOIN dm.product_ingredient_features f USING (business_key)
      WHERE p.barcode = ${ARG_BARCODE} LIMIT 1
    `);
    if (rows.length === 0) throw new Error(`barcode ${ARG_BARCODE} не найден в dm`);
    return rows;
  }
  // Автовыбор: по одному сиду из самой большой / средней / малой категории —
  // время getRecoSeedCandidates зависит от размера категории.
  return prisma.$queryRaw<SeedPick[]>(Prisma.sql`
    WITH gated AS (
      SELECT p.barcode, p.category, jsonb_array_length(f.canonical_ingredients) AS cset_len
      FROM dm.dm_products p
      JOIN dm.product_ingredient_features f USING (business_key)
      WHERE p.barcode IS NOT NULL
        AND p.image_url IS NOT NULL
        AND p.brand_normalized IS NOT NULL
        AND p.category <> 'Прочее'
        AND p.quality_score >= 50
        AND f.recognized_ratio >= 0.3
        AND jsonb_array_length(f.canonical_ingredients) >= 8
    ),
    cats AS (
      SELECT category, count(*)::int AS n,
             row_number() OVER (ORDER BY count(*) DESC) AS rn,
             count(*) OVER () AS total_cats
      FROM gated GROUP BY 1
    ),
    chosen AS (
      SELECT category, n FROM cats
      WHERE rn = 1 OR rn = (total_cats + 1) / 2 OR rn = total_cats
    )
    SELECT DISTINCT ON (g.category)
      g.barcode, g.category, c.n AS cat_size, g.cset_len::int
    FROM gated g JOIN chosen c USING (category)
    ORDER BY g.category, random()
  `);
}

/* ───────────────────── 4. Service-level bench ───────────────────── */

interface Scenario {
  name: string;
  profile: SkinProfileSummaryLike | null;
  subject: Subject | null;
  cache: boolean;
}

async function findSubjectWithEvents(): Promise<Subject | null> {
  const rows = await prisma.$queryRaw<
    { user_id: string | null; anon_id: string | null; n: number }[]
  >(Prisma.sql`
    SELECT e."userId" AS user_id, e."anonymousId" AS anon_id, count(*)::int AS n
    FROM "UserProductEvent" e
    WHERE e."createdAt" >= now() - interval '90 days'
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 1
  `);
  const r = rows[0];
  if (!r || r.n < 2) return null;
  console.log(
    `  subject с событиями: ${r.user_id ? "user" : "anon"} (${r.n} событий за 90д)`,
  );
  return { userId: r.user_id, anonymousId: r.user_id ? null : r.anon_id };
}

async function benchService(seeds: SeedPick[]): Promise<void> {
  hr(`3. Service bench — getRecommendations(), ${RUNS} прогонов на сценарий`);
  console.log(
    "  run1 = холодный (page cache / plan cache), далее — тёплые. Кэш выдачи\n" +
      "  управляется на сценарий: cache=off → RECO_CACHE=0 (меряем реальную работу).",
  );

  const subject = await findSubjectWithEvents();

  const scenarios: Scenario[] = [
    { name: "гость · без профиля · cache OFF", profile: null, subject: null, cache: false },
    { name: "гость · полный профиль · cache OFF", profile: FULL_PROFILE, subject: null, cache: false },
    { name: "гость · полный профиль · cache ON (run1=MISS, далее HIT)", profile: FULL_PROFILE, subject: null, cache: true },
  ];
  if (subject) {
    scenarios.push({
      name: "user · полный профиль · preference (кэш не применим)",
      profile: FULL_PROFILE,
      subject,
      cache: false,
    });
  } else {
    console.log("  ⚠️ событий UserProductEvent < 2 — сценарий preference пропущен");
  }

  // Прогрев соединения (пул Prisma), чтобы run1 не включал TCP+TLS+auth.
  await prisma.$queryRaw(Prisma.sql`SELECT 1`);

  for (const seed of seeds) {
    console.log(
      `\n  ── seed ${seed.barcode} · категория «${seed.category}» ` +
        `(${seed.cat_size} товаров, состав ${seed.cset_len}) ──`,
    );
    for (const sc of scenarios) {
      process.env.RECO_CACHE = sc.cache ? "1" : "0";
      const perStage = new Map<string, number[]>();
      const totals: number[] = [];
      let meta = "";
      for (let run = 0; run < RUNS; run++) {
        const { timer, result } = createCollectingTimer();
        const items = await getRecommendations(
          {
            barcode: seed.barcode,
            limit: 10,
            profile: sc.profile,
            subject: sc.subject,
          },
          timer,
        );
        timer.flush();
        result.items = items.length;
        totals.push(result.total);
        meta = result.meta || meta;
        for (const [label, ms] of result.stages) {
          if (!perStage.has(label)) perStage.set(label, []);
          perStage.get(label)!.push(ms);
        }
      }
      const sortedTotals = [...totals].sort((a, b) => a - b);
      console.log(`\n    ▸ ${sc.name}`);
      console.log(
        `      total: run1=${fmt(totals[0])}ms  p50=${fmt(pct(sortedTotals, 50))}ms  max=${fmt(pct(sortedTotals, 100))}ms`,
      );
      for (const [label, arr] of perStage) {
        const sorted = [...arr].sort((a, b) => a - b);
        console.log(
          `        ${label.padEnd(34)} run1=${fmt(arr[0]).padStart(7)}ms  p50=${fmt(pct(sorted, 50)).padStart(7)}ms  max=${fmt(pct(sorted, 100)).padStart(7)}ms  (${arr.length}/${RUNS} прогонов)`,
        );
      }
      if (meta) console.log(`      meta: ${meta}`);
    }
  }
  delete process.env.RECO_CACHE;

  // Profile-режим (без barcode) — вторичный сценарий, 1 сценарий для сравнения.
  console.log("\n  ── profile-режим (без barcode) · полный профиль · cache OFF ──");
  process.env.RECO_CACHE = "0";
  const totals: number[] = [];
  const perStage = new Map<string, number[]>();
  for (let run = 0; run < RUNS; run++) {
    const { timer, result } = createCollectingTimer();
    await getRecommendations(
      { barcode: null, limit: 10, profile: FULL_PROFILE, subject: null },
      timer,
    );
    timer.flush();
    totals.push(result.total);
    for (const [label, ms] of result.stages) {
      if (!perStage.has(label)) perStage.set(label, []);
      perStage.get(label)!.push(ms);
    }
  }
  const st = [...totals].sort((a, b) => a - b);
  console.log(
    `      total: run1=${fmt(totals[0])}ms  p50=${fmt(pct(st, 50))}ms  max=${fmt(pct(st, 100))}ms`,
  );
  for (const [label, arr] of perStage) {
    const sorted = [...arr].sort((a, b) => a - b);
    console.log(
      `        ${label.padEnd(34)} run1=${fmt(arr[0]).padStart(7)}ms  p50=${fmt(pct(sorted, 50)).padStart(7)}ms`,
    );
  }
  delete process.env.RECO_CACHE;
}

/* ───────────────────── 5. EXPLAIN ANALYZE ───────────────────── */

/**
 * ВАЖНО: SQL ниже — точные копии запросов из
 * lib/db/repositories/dm-recommendations.ts / dm-products.ts /
 * lib/recommendations/preference.ts. При изменении запросов в репозиториях
 * обновите и этот блок (bench намеренно не лезет в приватные функции).
 */
async function explain(label: string, query: Prisma.Sql): Promise<void> {
  console.log(`\n  ── EXPLAIN (ANALYZE, BUFFERS): ${label} ──`);
  try {
    const rows = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${query}`,
    );
    for (const r of rows) console.log(`    ${r["QUERY PLAN"]}`);
  } catch (e) {
    console.log(`    ⚠️ не удалось: ${(e as Error).message.split("\n")[0]}`);
  }
}

const GATES = Prisma.sql`
  p.barcode IS NOT NULL
  AND p.image_url IS NOT NULL
  AND p.image_url !~* '1x1|placeholder|no[-_]image|default'
  AND p.brand_normalized IS NOT NULL
  AND p.category <> 'Прочее'
  AND p.quality_score >= 50
  AND f.recognized_ratio >= 0.3
`;

async function benchExplain(seedPick: SeedPick, subject: Subject | null): Promise<void> {
  hr("4. EXPLAIN (ANALYZE, BUFFERS) — SQL пайплайна");

  const seed = await getRecoSeed(seedPick.barcode);
  if (!seed) {
    console.log("  ⚠️ seed не найден, EXPLAIN пропущен");
    return;
  }

  await explain(
    `getRecoSeed(${seed.barcode})`,
    Prisma.sql`
      SELECT
        p.business_key, p.barcode, p.brand_normalized AS brand, p.category,
        ARRAY(SELECT e->>'canonical_id'
              FROM jsonb_array_elements(f.canonical_ingredients) e) AS cset,
        f.recognized_ratio::float8 AS recognized_ratio,
        f.has_fragrance, f.has_essential_oils, f.has_drying_alcohol, f.irritancy_max
      FROM dm.dm_products p
      JOIN dm.product_ingredient_features f USING (business_key)
      WHERE p.barcode = ${seed.barcode}
      LIMIT 1
    `,
  );

  if (seed.cset.length > 0) {
    await explain(
      `getRecoSeedCandidates(категория «${seed.category}», cset=${seed.cset.length})`,
      Prisma.sql`
        WITH cand AS (
          SELECT p.business_key, p.barcode, f.canonical_ingredients,
                 p.quality_score::int AS quality_score,
                 f.recognized_ratio::float8 AS recognized_ratio
          FROM dm.dm_products p
          JOIN dm.product_ingredient_features f USING (business_key)
          WHERE p.category = ${seed.category}
            AND p.business_key <> ${seed.businessKey}
            AND ${GATES}
        ),
        scored AS (
          SELECT c.*,
            (SELECT count(*)::int
               FROM jsonb_array_elements(c.canonical_ingredients) e
               WHERE (e->>'canonical_id') IN (${Prisma.join(seed.cset)})) AS overlap
          FROM cand c
        )
        SELECT business_key, barcode, quality_score, recognized_ratio, overlap
        FROM scored
        WHERE overlap >= 1
        ORDER BY overlap DESC, quality_score DESC, recognized_ratio DESC
        LIMIT 100
      `,
    );
  }

  // top-K barcodes для queryCompatRows — берём реальные из candidates.
  const top = await prisma.$queryRaw<{ barcode: string }[]>(Prisma.sql`
    SELECT p.barcode
    FROM dm.dm_products p
    JOIN dm.product_ingredient_features f USING (business_key)
    WHERE p.category = ${seed.category} AND ${GATES}
    ORDER BY p.quality_score DESC LIMIT 40
  `);
  const barcodes = top.map((t) => t.barcode);
  if (barcodes.length > 0) {
    await explain(
      `queryCompatRows(${barcodes.length} barcodes) — getDmCompatibilityInputs`,
      Prisma.sql`
        SELECT
          p.barcode, p.business_key,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'canonical_id',   ci.canonical_id,
                'position',       ci.position,
                'inci_name',      c.inci_name,
                'display_ru',     c.display_ru,
                'display_en',     c.display_en,
                'tags',           coalesce(pr.tags,          '{}'::text[]),
                'benefits_for',   coalesce(pr.benefits_for,  '{}'::text[]),
                'cautions_for',   coalesce(pr.cautions_for,  '{}'::text[]),
                'flags_avoided',  coalesce(pr.flags_avoided, '{}'::text[]),
                'comedogenicity', coalesce(pr.comedogenicity, 0),
                'irritancy',      coalesce(pr.irritancy, 0),
                'allergenicity',  coalesce(pr.allergenicity, 0)
              ) ORDER BY ci.position
            ) FILTER (WHERE ci.canonical_id IS NOT NULL),
            '[]'::jsonb
          ) AS facts
        FROM dm.dm_products p
        JOIN dm.product_ingredient_features f USING (business_key)
        LEFT JOIN LATERAL jsonb_to_recordset(f.canonical_ingredients)
               AS ci(canonical_id text, position int) ON true
        LEFT JOIN dm.ingredients_canonical  c  ON c.canonical_id  = ci.canonical_id
        LEFT JOIN dm.ingredient_properties  pr ON pr.canonical_id = ci.canonical_id
        WHERE p.barcode IN (${Prisma.join(barcodes)})
        GROUP BY p.barcode, p.business_key, p.brand_normalized,
                 p.product_name_normalized, p.category, p.image_url,
                 p.quality_score, f.recognized_ratio, f.total_ingredients
      `,
    );
  }

  await explain(
    "getRecoProfileCandidates (profile-режим)",
    Prisma.sql`
      SELECT p.business_key, p.barcode, p.quality_score::int AS quality_score
      FROM dm.dm_products p
      JOIN dm.product_ingredient_features f USING (business_key)
      WHERE ${GATES}
      ORDER BY p.quality_score DESC, f.recognized_ratio DESC
      LIMIT 100
    `,
  );

  if (subject) {
    const subjectCond = subject.userId
      ? Prisma.sql`e."userId" = ${subject.userId}`
      : Prisma.sql`e."anonymousId" = ${subject.anonymousId}`;
    await explain(
      "buildPreference (UserProductEvent за 90 дней)",
      Prisma.sql`
        SELECT
          e."eventType" AS event_type, e.barcode,
          p.brand_normalized AS brand, p.category,
          CASE WHEN f.canonical_ingredients IS NULL THEN NULL
               ELSE ARRAY(SELECT el->>'canonical_id'
                          FROM jsonb_array_elements(f.canonical_ingredients) el)
          END AS canonical_ids
        FROM "UserProductEvent" e
        LEFT JOIN dm.dm_products p ON p.barcode = e.barcode
        LEFT JOIN dm.product_ingredient_features f ON f.business_key = p.business_key
        WHERE ${subjectCond}
          AND e."createdAt" >= now() - ${"90 days"}::interval
        ORDER BY e."createdAt" DESC
        LIMIT 500
      `,
    );
  }
}

/* ───────────────────── 6. HTTP end-to-end (опция) ───────────────────── */

async function benchHttp(seeds: SeedPick[]): Promise<void> {
  if (!ARG_URL) return;
  hr(`5. HTTP end-to-end — ${ARG_URL}/api/v1/recommendations`);
  console.log(
    "  Меряет полный route: сеть + auth + service + сериализация.\n" +
      "  ttfb = заголовки получены; total = тело получено и распарсено.",
  );
  for (const seed of seeds) {
    const sp = new URLSearchParams({
      barcode: seed.barcode,
      limit: "10",
      skinType: "dry",
      sensitivity: "high",
      concerns: "redness,acne",
      avoided: "fragrance",
      goal: "hydration",
    });
    const url = `${ARG_URL}/api/v1/recommendations?${sp}`;
    const ttfbs: number[] = [];
    const totals: number[] = [];
    let bytes = 0;
    let itemsN = 0;
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const res = await fetch(url, { headers: { accept: "application/json" } });
      ttfbs.push(performance.now() - t0);
      const text = await res.text();
      totals.push(performance.now() - t0);
      bytes = text.length;
      try {
        itemsN = (JSON.parse(text) as { items?: unknown[] }).items?.length ?? 0;
      } catch {
        /* ignore */
      }
    }
    const sT = [...ttfbs].sort((a, b) => a - b);
    const sTot = [...totals].sort((a, b) => a - b);
    console.log(
      `\n  seed ${seed.barcode} («${seed.category}»): ` +
        `ttfb run1=${fmt(ttfbs[0])}ms p50=${fmt(pct(sT, 50))}ms · ` +
        `total run1=${fmt(totals[0])}ms p50=${fmt(pct(sTot, 50))}ms · ` +
        `${bytes} байт · items=${itemsN}`,
    );
  }
}

/* ───────────────────────── main ───────────────────────── */

async function main(): Promise<void> {
  console.log(
    `reco-bench · ${new Date().toISOString()} · runs=${RUNS}` +
      `${ARG_BARCODE ? ` · barcode=${ARG_BARCODE}` : ""}` +
      `${ARG_URL ? ` · url=${ARG_URL}` : ""}`,
  );
  await printDbStats();
  await printIndexCheck();

  const seeds = await pickSeeds();
  if (seeds.length === 0) {
    console.log("⚠️ Не удалось выбрать seed-товары — dm-слой пуст?");
    return;
  }
  // Сортируем: самая большая категория первой (worst case).
  seeds.sort((a, b) => b.cat_size - a.cat_size);

  await benchService(seeds);
  const subject = await findSubjectWithEvents();
  await benchExplain(seeds[0], subject);
  await benchHttp(seeds);

  hr("Готово");
  console.log(
    "  Пришлите этот лог целиком — по нему заполняется отчёт\n" +
      "  docs/reco-performance-investigation.md (тайминги, вклад этапов, план).",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
