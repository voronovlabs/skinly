/**
 * DM recommendations repository (MVP). Кандидаты для рекомендаций из
 * dm.dm_products ⋈ dm.product_ingredient_features. Без ML/embeddings.
 *
 * Gates (общие для всех функций):
 *   image_url валиден · brand_normalized IS NOT NULL · category <> 'Прочее'
 *   · quality_score >= 50 · recognized_ratio >= 0.3
 *
 * dm.* нет в Prisma schema → prisma.$queryRaw. Только чтение.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CandidateRow, SeedRow } from "@/lib/recommendations/types";

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
    has_fragrance: r.has_fragrance,
    has_essential_oils: r.has_essential_oils,
    has_drying_alcohol: r.has_drying_alcohol,
    irritancy_max: r.irritancy_max,
  };
}

/** Кандидаты той же категории с ingredient_overlap к seed (overlap >= 1). */
export async function getRecoSeedCandidates(
  seed: SeedRow,
  pool: number,
): Promise<CandidateRow[]> {
  if (seed.cset.length === 0) return [];
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

/** Профильные кандидаты (без seed): топ по качеству/распознанности. */
export async function getRecoProfileCandidates(
  pool: number,
): Promise<CandidateRow[]> {
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
