/**
 * DM recommendations repository (MVP). Кандидаты для рекомендаций из
 * dm.dm_products ⋈ dm.product_ingredient_features. Без ML/embeddings.
 *
 * Gates (общие для всех функций):
 *   image_url валиден · brand_normalized IS NOT NULL · category <> 'Прочее'
 *   · quality_score >= 50 · recognized_ratio >= 0.3
 *   ⚠️ Копия gates захардкожена в MV dm.reco_profile_feed
 *   (sql/dm/34_reco_candidates.sql) — менять синхронно.
 *
 * Perf (bench 2026-07-11): legacy-запросы разворачивали jsonb-состав
 * ~17–20k товаров категории на КАЖДЫЙ запрос (p50 1.7–2.4 s seed-режим,
 * ~0.95 s profile-режим). Fast-path работает поверх MV из
 * sql/dm/34_reco_candidates.sql:
 *   - dm.product_canonical    → overlap = count(*) по index-only scan;
 *   - dm.reco_profile_feed    → готовый top профильной ленты.
 * Выдача идентична legacy (тот же счёт overlap, те же gates, та же
 * сортировка). Если MV не применены — автоматический fallback на legacy
 * (медленный, но рабочий). Форс legacy: env RECO_LEGACY_SQL=1.
 *
 * dm.* нет в Prisma schema → prisma.$queryRaw. Только чтение.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CandidateRow, SeedRow } from "@/lib/recommendations/types";

/* ───────── Fast-path capability check (once per process) ───────── */

let recoMvsPromise: Promise<boolean> | null = null;

/** true → MV из 34_reco_candidates.sql на месте, работаем по fast-path. */
function hasRecoMvs(): Promise<boolean> {
  if (process.env.RECO_LEGACY_SQL === "1") return Promise.resolve(false);
  if (!recoMvsPromise) {
    recoMvsPromise = prisma
      .$queryRaw<{ pc: string | null; feed: string | null }[]>(Prisma.sql`
        SELECT to_regclass('dm.product_canonical')::text  AS pc,
               to_regclass('dm.reco_profile_feed')::text AS feed
      `)
      .then((rows) => {
        const ok = Boolean(rows[0]?.pc) && Boolean(rows[0]?.feed);
        if (!ok) {
          console.warn(
            "[reco] dm.product_canonical / dm.reco_profile_feed не найдены — " +
              "legacy SQL путь (медленный). Примените sql/dm/34_reco_candidates.sql",
          );
        }
        return ok;
      })
      .catch(() => {
        // Ошибка проверки не должна ломать рекомендации — уходим в legacy
        // и позволяем повторить проверку на следующем запросе.
        recoMvsPromise = null;
        return false;
      });
  }
  return recoMvsPromise;
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

const CANDIDATE_COLS = Prisma.sql`
  p.business_key,
  p.barcode,
  p.brand_normalized                      AS brand,
  p.product_name_normalized               AS name,
  p.category,
  p.image_url,
  p.quality_score::int                    AS quality_score,
  f.recognized_ratio::float8              AS recognized_ratio,
  f.has_fragrance, f.has_drying_alcohol, f.has_essential_oils,
  f.has_acids, f.has_retinoids,
  f.comedogenicity_max, f.irritancy_max, f.allergenicity_max,
  coalesce(f.top5_canonical, '{}'::text[]) AS top5_canonical
`;

interface RawSeed {
  business_key: string;
  barcode: string;
  brand: string | null;
  category: string;
  cset: string[];
  recognized_ratio: number;
  has_fragrance: boolean;
  has_essential_oils: boolean;
  has_drying_alcohol: boolean;
  irritancy_max: number;
}

/** Seed-товар по штрихкоду (с canonical-набором состава). */
export async function getRecoSeed(barcode: string): Promise<SeedRow | null> {
  const rows = await prisma.$queryRaw<RawSeed[]>(Prisma.sql`
    SELECT
      p.business_key, p.barcode, p.brand_normalized AS brand, p.category,
      ARRAY(SELECT e->>'canonical_id'
            FROM jsonb_array_elements(f.canonical_ingredients) e) AS cset,
      f.recognized_ratio::float8 AS recognized_ratio,
      f.has_fragrance, f.has_essential_oils, f.has_drying_alcohol, f.irritancy_max
    FROM dm.dm_products p
    JOIN dm.product_ingredient_features f USING (business_key)
    WHERE p.barcode = ${barcode}
    LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    businessKey: r.business_key,
    barcode: r.barcode,
    brand: r.brand,
    category: r.category,
    cset: r.cset ?? [],
    recognizedRatio: r.recognized_ratio,
    has_fragrance: r.has_fragrance,
    has_essential_oils: r.has_essential_oils,
    has_drying_alcohol: r.has_drying_alcohol,
    irritancy_max: r.irritancy_max,
  };
}

/**
 * Кандидаты той же категории с ingredient_overlap к seed (overlap >= 1).
 *
 * Fast-path (dm.product_canonical):
 *   overlap = count(*) GROUP BY business_key по btree-индексу
 *   (category, canonical_id) INCLUDE (business_key). Postgres читает ТОЛЬКО
 *   posting-строки ингредиентов seed'а внутри категории (index-only scan),
 *   вместо детоаста + двойного jsonb_array_elements по ~17–20k составов.
 *   Семантика count идентична legacy: считаются те же вхождения (включая
 *   дубли canonical_id в составе кандидата), gates и сортировка те же.
 *
 * Legacy-path: прежний запрос (медленный) — если MV не применены.
 */
export async function getRecoSeedCandidates(
  seed: SeedRow,
  pool: number,
): Promise<CandidateRow[]> {
  if (seed.cset.length === 0) return [];

  if (await hasRecoMvs()) {
    return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      WITH ov AS (
        SELECT pc.business_key, count(*)::int AS overlap
        FROM dm.product_canonical pc
        WHERE pc.category = ${seed.category}
          AND pc.canonical_id IN (${Prisma.join(seed.cset)})
          AND pc.business_key <> ${seed.businessKey}
        GROUP BY pc.business_key
      )
      SELECT ${CANDIDATE_COLS}, ov.overlap
      FROM ov
      JOIN dm.dm_products p USING (business_key)
      JOIN dm.product_ingredient_features f USING (business_key)
      WHERE ${GATES}
      ORDER BY ov.overlap DESC, p.quality_score DESC, f.recognized_ratio DESC
      LIMIT ${pool}
    `);
  }

  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH cand AS (
      SELECT ${CANDIDATE_COLS}, f.canonical_ingredients
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
    SELECT
      business_key, barcode, brand, name, category, image_url, quality_score,
      recognized_ratio, has_fragrance, has_drying_alcohol, has_essential_oils,
      has_acids, has_retinoids, comedogenicity_max, irritancy_max,
      allergenicity_max, top5_canonical, overlap
    FROM scored
    WHERE overlap >= 1
    ORDER BY overlap DESC, quality_score DESC, recognized_ratio DESC
    LIMIT ${pool}
  `);
}

/**
 * Профильные кандидаты (без seed): топ по качеству/распознанности.
 *
 * Fast-path: запрос не зависит от параметров → результат статичен между
 * refresh'ами DM и материализован в dm.reco_profile_feed (top-500).
 * Читаем готовые строки (~1 мс) вместо скана/джойна 42k+ товаров.
 * MV не гарантирует порядок скана → ORDER BY повторяется по 500 строкам.
 */
export async function getRecoProfileCandidates(
  pool: number,
): Promise<CandidateRow[]> {
  if (await hasRecoMvs()) {
    return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT
        business_key, barcode, brand, name, category, image_url,
        quality_score, recognized_ratio, has_fragrance, has_drying_alcohol,
        has_essential_oils, has_acids, has_retinoids, comedogenicity_max,
        irritancy_max, allergenicity_max, top5_canonical, 0 AS overlap
      FROM dm.reco_profile_feed
      ORDER BY quality_score DESC, recognized_ratio DESC
      LIMIT ${pool}
    `);
  }

  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT ${CANDIDATE_COLS}, 0 AS overlap
    FROM dm.dm_products p
    JOIN dm.product_ingredient_features f USING (business_key)
    WHERE ${GATES}
    ORDER BY p.quality_score DESC, f.recognized_ratio DESC
    LIMIT ${pool}
  `);
}

/** Dev-only диагностика воронки кандидатов для seed. */
export async function getRecoDebugCounts(
  seed: SeedRow,
): Promise<{ beforeGates: number; afterGates: number }> {
  const rows = await prisma.$queryRaw<
    { before_gates: number; after_gates: number }[]
  >(Prisma.sql`
    SELECT
      count(*)::int AS before_gates,
      count(*) FILTER (WHERE
        p.image_url IS NOT NULL
        AND p.image_url !~* '1x1|placeholder|no[-_]image|default'
        AND p.brand_normalized IS NOT NULL
        AND p.quality_score >= 50
        AND f.recognized_ratio >= 0.3
      )::int AS after_gates
    FROM dm.dm_products p
    JOIN dm.product_ingredient_features f USING (business_key)
    WHERE p.category = ${seed.category}
      AND p.business_key <> ${seed.businessKey}
      AND p.barcode IS NOT NULL
  `);
  return {
    beforeGates: rows[0]?.before_gates ?? 0,
    afterGates: rows[0]?.after_gates ?? 0,
  };
}
