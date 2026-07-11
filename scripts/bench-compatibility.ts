/**
 * Bench блока «Подходимость товара» — реальные измерения на живой БД.
 *
 * Меряет ОБА серверных пути расчёта совместимости одного товара:
 *
 *   WEB (SSR /product/[id-or-barcode]):
 *     productLoad (Prisma findUnique + ingredients include)
 *     → resolveCompatibility: dmCompatibilityInputs → featuresToFacts
 *       → evaluateCompatibility
 *
 *   MOBILE (GET /api/v1/products?forMe=1&q=<barcode>&limit=10 —
 *   его дергает compatibilityApi.evaluate ради ОДНОГО товара):
 *     productLoad(list+ingredients) (поиск по q + attachIngredients страницы)
 *     → resolveCompatibilityBatch: dmCompatibilityInputs(batch ≤10)
 *       → featuresToFacts ×N → evaluateCompatibility ×N
 *
 * Дополнительно:
 *   • profileLoad (getBeautyProfileByUserId реального user'а, если есть);
 *   • EXPLAIN (ANALYZE, BUFFERS) всех SQL пайплайна;
 *   • (--url) HTTP end-to-end: /products/:id и /products?forMe — ttfb/total/bytes.
 *
 * Запуск (нужен DATABASE_URL):
 *   npm run bench:compat 2>&1 | tee compat-bench.log
 *   npm run bench:compat -- --barcode 4600702084566
 *   npm run bench:compat -- --url http://localhost:3000
 *   npm run bench:compat -- --runs 9
 *
 * Скрипт read-only: ничего не пишет в БД, продуктовый код не меняет.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveCompatibility,
  resolveCompatibilityBatch,
} from "@/lib/compatibility/resolve-compatibility";
import { formatRuleHits } from "@/lib/compatibility/format-reasons";
import type { CompatTimer } from "@/lib/compatibility/timing";
import { listProducts } from "@/lib/db/repositories/product";
import { getBeautyProfileByUserId } from "@/lib/db/repositories/beauty-profile";
import {
  emptyProfile,
  summaryProfileToEngine,
  type CompatibilityProfile,
} from "@/lib/compatibility";

/* ───────────────────────── CLI args ───────────────────────── */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const ARG_BARCODE = arg("barcode");
const ARG_URL = arg("url");
const RUNS = Math.max(3, Number(arg("runs") ?? 7));

const FULL_PROFILE_SUMMARY = {
  skinType: "dry",
  sensitivity: "high",
  concerns: ["redness", "acne"],
  avoidedList: ["fragrance"],
  goal: "hydration",
};

/* ───────────────────── Collecting CompatTimer ───────────────────── */

interface RunResult {
  total: number;
  stages: Map<string, number>;
  counts: Map<string, number>;
  metas: string[];
}

function createCollectingTimer(): { timer: CompatTimer; result: RunResult } {
  const result: RunResult = {
    total: 0,
    stages: new Map(),
    counts: new Map(),
    metas: [],
  };
  const startedAt = performance.now();
  const add = (l: string, ms: number) =>
    result.stages.set(l, (result.stages.get(l) ?? 0) + ms);
  const timer: CompatTimer = {
    enabled: true,
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        add(label, performance.now() - t0);
      }
    },
    timeSync<T>(label: string, fn: () => T): T {
      const t0 = performance.now();
      try {
        return fn();
      } finally {
        add(label, performance.now() - t0);
      }
    },
    mark: add,
    count(label: string, n: number): void {
      result.counts.set(label, (result.counts.get(label) ?? 0) + n);
    },
    note(meta: string): void {
      if (!result.metas.includes(meta)) result.metas.push(meta);
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
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmt(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms.toFixed(1);
}

function hr(title: string): void {
  console.log(`\n${"═".repeat(78)}\n  ${title}\n${"═".repeat(78)}`);
}

function printRuns(
  totals: number[],
  perStage: Map<string, number[]>,
  counts: Map<string, number>,
  metas: string[],
): void {
  const st = [...totals].sort((a, b) => a - b);
  console.log(
    `      total: run1=${fmt(totals[0])}ms  p50=${fmt(pct(st, 50))}ms  max=${fmt(pct(st, 100))}ms`,
  );
  for (const [label, arr] of perStage) {
    const sorted = [...arr].sort((a, b) => a - b);
    console.log(
      `        ${label.padEnd(36)} run1=${fmt(arr[0]).padStart(7)}ms  p50=${fmt(pct(sorted, 50)).padStart(7)}ms  max=${fmt(pct(sorted, 100)).padStart(7)}ms`,
    );
  }
  if (counts.size) {
    console.log(
      `      n (run1): ${[...counts].map(([l, n]) => `${l}=${n}`).join(" ")}`,
    );
  }
  if (metas.length) console.log(`      meta: ${metas.join(" · ")}`);
}

/* ───────────────────── 1. DB stats + флаги ───────────────────── */

async function printDbStats(): Promise<void> {
  hr("1. БД и флаги");
  console.log(
    `  USE_DM_COMPATIBILITY=${process.env.USE_DM_COMPATIBILITY ?? "—"} ` +
      `(движок: ${process.env.USE_DM_COMPATIBILITY === "true" ? "DM canonical" : "legacy KB"})`,
  );
  const rows = await prisma.$queryRaw<{ rel: string; n: number }[]>(Prisma.sql`
    SELECT 'public.Product' AS rel, count(*)::int AS n FROM "Product"
    UNION ALL
    SELECT 'public.ProductIngredient', count(*)::int FROM "ProductIngredient"
    UNION ALL
    SELECT 'public.Ingredient', count(*)::int FROM "Ingredient"
    UNION ALL
    SELECT 'dm.product_ingredient_features', count(*)::int
    FROM dm.product_ingredient_features
    UNION ALL
    SELECT 'dm.ingredient_properties', count(*)::int FROM dm.ingredient_properties
  `);
  for (const r of rows) {
    console.log(`  ${r.rel.padEnd(36)} ${String(r.n).padStart(9)} rows`);
  }
}

/* ───────────────────── 2. Выбор товаров ───────────────────── */

interface Pick {
  label: string;
  barcode: string;
  total_ingredients: number;
  recognized: number;
}

/** Товары с маленьким/средним/большим составом, существующие в public И dm. */
async function pickProducts(): Promise<Pick[]> {
  if (ARG_BARCODE) {
    const rows = await prisma.$queryRaw<Pick[]>(Prisma.sql`
      SELECT 'custom' AS label, p.barcode,
             f.total_ingredients::int, f.recognized_ingredients::int AS recognized
      FROM "Product" p
      JOIN dm.product_ingredient_features f ON f.barcode = p.barcode
      WHERE p.barcode = ${ARG_BARCODE}
      LIMIT 1
    `);
    if (rows.length === 0) {
      throw new Error(`barcode ${ARG_BARCODE} не найден в Product ⋈ dm`);
    }
    return rows;
  }
  return prisma.$queryRaw<Pick[]>(Prisma.sql`
    WITH joined AS (
      SELECT p.barcode, f.total_ingredients, f.recognized_ingredients
      FROM "Product" p
      JOIN dm.product_ingredient_features f ON f.barcode = p.barcode
      WHERE f.recognized_ratio >= 0.3 AND f.total_ingredients >= 3
    ),
    ranked AS (
      SELECT *,
        ntile(100) OVER (ORDER BY total_ingredients) AS pctile
      FROM joined
    )
    SELECT DISTINCT ON (label) label, barcode,
           total_ingredients::int, recognized_ingredients::int AS recognized
    FROM (
      SELECT 'small (p10)'  AS label, * FROM ranked WHERE pctile = 10
      UNION ALL
      SELECT 'medium (p50)' AS label, * FROM ranked WHERE pctile = 50
      UNION ALL
      SELECT 'large (p95)'  AS label, * FROM ranked WHERE pctile = 95
    ) t
    ORDER BY label, random()
  `);
}

/* ───────────────────── 3. profileLoad ───────────────────── */

async function benchProfileLoad(): Promise<void> {
  hr("2. profileLoad — BeautyProfile реального user'а");
  const users = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "userId" AS id FROM "BeautyProfile" LIMIT 1
  `);
  if (users.length === 0) {
    console.log("  ⚠️ BeautyProfile нет — этап profileLoad пропущен");
    return;
  }
  const totals: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await getBeautyProfileByUserId(users[0].id);
    totals.push(performance.now() - t0);
  }
  const st = [...totals].sort((a, b) => a - b);
  console.log(
    `  getBeautyProfileByUserId: run1=${fmt(totals[0])}ms p50=${fmt(pct(st, 50))}ms max=${fmt(pct(st, 100))}ms`,
  );
}

/* ───────────────────── 4. Service-level bench ───────────────────── */

const PRODUCT_INCLUDE = {
  ingredients: {
    include: { ingredient: true },
    orderBy: { position: "asc" as const },
  },
};

async function benchWebPath(picks: Pick[]): Promise<void> {
  hr(`3. WEB path (SSR карточки) — ${RUNS} прогонов на сценарий`);
  console.log(
    "  productLoad = findUnique(+ingredients), затем resolveCompatibility.\n" +
      "  Сценарии: профиль пуст (guest без анкеты) / полный профиль.\n" +
      "  Источник facts: dm (USE_DM_COMPATIBILITY) и legacy — оба, для сравнения.",
  );

  const scenarios: { name: string; profile: CompatibilityProfile; forceDm: boolean }[] = [
    { name: "профиль пуст · facts=dm", profile: emptyProfile(), forceDm: true },
    { name: "полный профиль · facts=dm", profile: summaryProfileToEngine(FULL_PROFILE_SUMMARY), forceDm: true },
    { name: "полный профиль · facts=legacy(KB)", profile: summaryProfileToEngine(FULL_PROFILE_SUMMARY), forceDm: false },
  ];

  await prisma.$queryRaw(Prisma.sql`SELECT 1`); // прогрев соединения

  for (const pick of picks) {
    console.log(
      `\n  ── ${pick.label}: barcode ${pick.barcode} ` +
        `(${pick.total_ingredients} ингр., распознано ${pick.recognized}) ──`,
    );
    for (const sc of scenarios) {
      const totals: number[] = [];
      const perStage = new Map<string, number[]>();
      let counts = new Map<string, number>();
      let metas: string[] = [];
      for (let run = 0; run < RUNS; run++) {
        const { timer, result } = createCollectingTimer();
        const product = await timer.time("productLoad", () =>
          prisma.product.findUnique({
            where: { barcode: pick.barcode },
            include: PRODUCT_INCLUDE,
          }),
        );
        if (!product) break;
        await resolveCompatibility(
          {
            barcode: product.barcode,
            legacyIngredients: product.ingredients.map((l) => ({
              inci: l.ingredient.inci,
              position: l.position,
            })),
            profile: sc.profile,
            forceDm: sc.forceDm,
          },
          timer,
        );
        timer.flush();
        totals.push(result.total);
        if (run === 0) {
          counts = result.counts;
          metas = result.metas;
        }
        for (const [label, ms] of result.stages) {
          if (!perStage.has(label)) perStage.set(label, []);
          perStage.get(label)!.push(ms);
        }
      }
      console.log(`\n    ▸ ${sc.name}`);
      printRuns(totals, perStage, counts, metas);
    }
  }
}

async function benchMobilePath(picks: Pick[]): Promise<void> {
  hr(`4. MOBILE path (/products?forMe=1&q=<barcode>&limit=10) — ${RUNS} прогонов`);
  console.log(
    "  Ровно то, что выполняет backend, когда мобильная карточка считает\n" +
      "  подходимость ОДНОГО товара: поиск по q + ингредиенты страницы +\n" +
      "  batch-совместимость ≤10 товаров.",
  );
  const engineProfile = summaryProfileToEngine(FULL_PROFILE_SUMMARY);

  for (const pick of picks) {
    console.log(`\n  ── ${pick.label}: barcode ${pick.barcode} ──`);
    const totals: number[] = [];
    const perStage = new Map<string, number[]>();
    let counts = new Map<string, number>();
    let metas: string[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { timer, result } = createCollectingTimer();
      const page = await timer.time("productLoad(list+ingredients)", () =>
        listProducts({
          q: pick.barcode,
          withIngredients: true,
          limit: 10,
        }),
      );
      const resolved = await resolveCompatibilityBatch(
        engineProfile,
        page.items.map((item) => ({
          barcode: item.barcode,
          legacyIngredients: item.inciList ?? [],
        })),
        { timer },
      );
      timer.flush();
      timer.count("itemsScored", resolved.length);
      totals.push(result.total);
      if (run === 0) {
        counts = result.counts;
        metas = result.metas;
      }
      for (const [label, ms] of result.stages) {
        if (!perStage.has(label)) perStage.set(label, []);
        perStage.get(label)!.push(ms);
      }
    }
    printRuns(totals, perStage, counts, metas);
  }
}

/* ───────── 4b. NEW: /products/:id/compatibility (AFTER-путь) ───────── */

/**
 * Точная реплика внутренностей app/api/v1/products/[id]/compatibility:
 * лёгкий findUnique(barcode) → resolveCompatibility → formatRuleHits.
 * Кэш роута здесь НЕ используется — меряем холодную работу; тёплую
 * (cache hit) показывает HTTP-режим (run2+).
 */
async function benchNewEndpoint(picks: Pick[]): Promise<void> {
  hr(`4b. NEW endpoint path (/products/:id/compatibility) — ${RUNS} прогонов`);
  console.log(
    "  AFTER-путь мобильной подходимости: точечный lookup вместо searchProducts.",
  );
  const engineProfile = summaryProfileToEngine(FULL_PROFILE_SUMMARY);
  const select = {
    id: true,
    barcode: true,
    ingredients: {
      select: { position: true, ingredient: { select: { inci: true } } },
      orderBy: { position: "asc" as const },
    },
  };

  for (const pick of picks) {
    console.log(`\n  ── ${pick.label}: barcode ${pick.barcode} ──`);
    const totals: number[] = [];
    const perStage = new Map<string, number[]>();
    let counts = new Map<string, number>();
    let metas: string[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { timer, result } = createCollectingTimer();
      const product = await timer.time("productLoad.byBarcode", () =>
        prisma.product.findUnique({ where: { barcode: pick.barcode }, select }),
      );
      if (!product) break;
      const resolved = await resolveCompatibility(
        {
          barcode: product.barcode,
          legacyIngredients: product.ingredients.map((l) => ({
            inci: l.ingredient.inci,
            position: l.position,
          })),
          profile: engineProfile,
        },
        timer,
      );
      const dto = timer.timeSync("buildExplanation", () => ({
        productId: product.id,
        barcode: product.barcode,
        score: resolved.result.score,
        verdict: resolved.result.verdict,
        lowConfidence: resolved.result.lowConfidence,
        source: resolved.source,
        reasons: formatRuleHits(resolved.result.reasons, "ru"),
        positives: formatRuleHits(resolved.result.positives, "ru"),
        warnings: formatRuleHits(resolved.result.warnings, "ru"),
      }));
      const bytes = timer.timeSync(
        "serialization",
        () => JSON.stringify(dto).length,
      );
      timer.flush();
      timer.count("bytes", bytes);
      timer.count("reasons", dto.reasons.length);
      totals.push(result.total);
      if (run === 0) {
        counts = result.counts;
        metas = result.metas;
      }
      for (const [label, ms] of result.stages) {
        if (!perStage.has(label)) perStage.set(label, []);
        perStage.get(label)!.push(ms);
      }
    }
    printRuns(totals, perStage, counts, metas);
  }
}

/* ───────────────────── 5. EXPLAIN ANALYZE ───────────────────── */

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

/** Свёртка регистра — копия foldSql из lib/db/repositories/product.ts. */
const CYR_UP = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
const CYR_LO = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";

async function benchExplain(pick: Pick): Promise<void> {
  hr("5. EXPLAIN (ANALYZE, BUFFERS) — SQL пайплайна подходимости");
  console.log(
    "  ⚠️ SQL — копии запросов из product.ts / dm-products.ts / [id]/route.ts.\n" +
      "  При изменении запросов в репозиториях обновить и здесь.",
  );

  const product = await prisma.product.findUnique({
    where: { barcode: pick.barcode },
    select: { id: true },
  });

  // Мобильная карточка открывается по id-или-barcode: первый lookup по id
  // для barcode-URL — гарантированный промах (меряем его цену).
  await explain(
    "productLoad.byId (промах для barcode-URL)",
    Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${pick.barcode}`,
  );
  await explain(
    "productLoad.byBarcode",
    Prisma.sql`SELECT "id" FROM "Product" WHERE "barcode" = ${pick.barcode}`,
  );
  if (product) {
    await explain(
      "ingredients include (ProductIngredient ⋈ Ingredient)",
      Prisma.sql`
        SELECT pi."position", i.*
        FROM "ProductIngredient" pi
        JOIN "Ingredient" i ON i."id" = pi."ingredientId"
        WHERE pi."productId" = ${product.id}
        ORDER BY pi."position"
      `,
    );
    await explain(
      "reviewAggregate",
      Prisma.sql`
        SELECT avg("rating"), count(*)
        FROM "ProductReview" WHERE "productId" = ${product.id}
      `,
    );
  }

  // Поиск по q=<barcode> — то, что выполняет mobile-путь (searchProducts).
  const pat = Prisma.raw(`'%${pick.barcode}%'`);
  const trFrom = Prisma.raw(`'${CYR_UP}'`);
  const trTo = Prisma.raw(`'${CYR_LO}'`);
  await explain(
    `searchProducts(q=${pick.barcode}) — mobile forMe`,
    Prisma.sql`
      SELECT "id", "barcode", "brand", "name", "category"::text, "emoji", "imageUrl"
      FROM "Product"
      WHERE ((
        lower(translate("brand", ${trFrom}, ${trTo})) LIKE ${pat}
        OR lower(translate("name", ${trFrom}, ${trTo})) LIKE ${pat}
        OR lower(translate("category"::text, ${trFrom}, ${trTo})) LIKE ${pat}
      ) OR "barcode" LIKE ${pat})
      LIMIT 11 OFFSET 0
    `,
  );

  // Одиночный DM-вход (web-путь): jsonb_agg 12 полей на ингредиент.
  await explain(
    "queryCompatRows(1 barcode) — getDmCompatibilityInput",
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
      WHERE p.barcode IN (${pick.barcode})
      GROUP BY p.barcode, p.business_key, p.brand_normalized,
               p.product_name_normalized, p.category, p.image_url,
               p.quality_score, f.recognized_ratio, f.total_ingredients
    `,
  );
}

/* ───────────────────── 6. HTTP end-to-end (--url) ───────────────────── */

async function httpProbe(
  label: string,
  url: string,
): Promise<void> {
  const ttfbs: number[] = [];
  const totals: number[] = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = await fetch(url, { headers: { accept: "application/json" } });
    ttfbs.push(performance.now() - t0);
    const text = await res.text();
    totals.push(performance.now() - t0);
    bytes = text.length;
    status = res.status;
  }
  const sT = [...ttfbs].sort((a, b) => a - b);
  const sTot = [...totals].sort((a, b) => a - b);
  console.log(
    `  ${label}: status=${status} ` +
      `ttfb run1=${fmt(ttfbs[0])}ms p50=${fmt(pct(sT, 50))}ms · ` +
      `total run1=${fmt(totals[0])}ms p50=${fmt(pct(sTot, 50))}ms · ${bytes} байт`,
  );
}

async function benchHttp(picks: Pick[]): Promise<void> {
  if (!ARG_URL) return;
  hr(`6. HTTP end-to-end — ${ARG_URL}`);
  console.log(
    "  Полный путь мобильной карточки = ОБА запроса последовательно\n" +
      "  (сначала product, потом forMe) — сумма их total ≈ время до verdict.",
  );
  const profileQs =
    "skinType=dry&sensitivity=high&concerns=redness,acne&avoided=fragrance&goal=hydration";
  for (const pick of picks) {
    console.log(`\n  ── ${pick.label}: barcode ${pick.barcode} ──`);
    await httpProbe(
      "GET /products/:barcode        ",
      `${ARG_URL}/api/v1/products/${pick.barcode}`,
    );
    await httpProbe(
      "BEFORE /products?forMe=1&q=…  ",
      `${ARG_URL}/api/v1/products?forMe=1&q=${pick.barcode}&limit=10&${profileQs}`,
    );
    await httpProbe(
      "AFTER  /products/:b/compat…   ",
      `${ARG_URL}/api/v1/products/${pick.barcode}/compatibility?${profileQs}`,
    );
    console.log(
      "    (AFTER: run1 = cache miss (холодная работа), run2+ = cache hit — warm)",
    );
  }
}

/* ───────────────────────── main ───────────────────────── */

async function main(): Promise<void> {
  console.log(
    `compat-bench · ${new Date().toISOString()} · runs=${RUNS}` +
      `${ARG_BARCODE ? ` · barcode=${ARG_BARCODE}` : ""}` +
      `${ARG_URL ? ` · url=${ARG_URL}` : ""}`,
  );
  await printDbStats();

  const picks = await pickProducts();
  if (picks.length === 0) {
    console.log("⚠️ Не удалось выбрать товары (Product ⋈ dm пуст?)");
    return;
  }
  picks.sort((a, b) => a.total_ingredients - b.total_ingredients);
  console.log(
    `\n  Выбраны товары: ${picks
      .map((p) => `${p.label}=${p.barcode}(${p.total_ingredients})`)
      .join(" · ")}`,
  );

  await benchProfileLoad();
  await benchWebPath(picks);
  await benchMobilePath(picks); // BEFORE: старый mobile-путь через forMe
  await benchNewEndpoint(picks); // AFTER: точечный endpoint
  await benchExplain(picks[picks.length - 1]); // самый большой состав
  await benchHttp(picks);

  hr("Готово");
  console.log(
    "  Пришлите этот лог + строки [compat-timing] из dev-сервера\n" +
      "  (COMPAT_TIMING=1) и [compat-timing:mobile]/[compat-timing:web]\n" +
      "  из клиентов — по ним заполняется отчёт\n" +
      "  docs/compat-performance-investigation.md.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
