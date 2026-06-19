/**
 * DM products repository (Stage 2, шаг 2).
 *
 * Доступ к каноническому слою `dm.*` для compatibility-движка. Эти объекты —
 * raw SQL (materialized views + reference tables), их НЕТ в Prisma schema,
 * поэтому работаем через `prisma.$queryRaw`.
 *
 * Один запрос вытягивает сразу:
 *   dm.dm_products  ⋈  dm.product_ingredient_features
 *                   ⋈  dm.ingredients_canonical
 *                   ⋈  dm.ingredient_properties
 * и собирает состав в jsonb-массив → нет N+1.
 *
 * Чистый data-access. Ничего не подключено к API/UI/движку — пока используется
 * только smoke-скриптом. score.ts/rules.ts/explain.ts/inciToFact не трогаем.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DmIngredientRow } from "@/lib/compatibility";

/* ───────── Public types ───────── */

export interface DmProductHeader {
  barcode: string;
  businessKey: string;
  brandNormalized: string | null;
  productName: string | null;
  category: string | null;
  imageUrl: string | null;
  qualityScore: number;
}

export interface DmCompatibilityInput {
  product: DmProductHeader;
  rows: DmIngredientRow[];
  recognizedRatio: number;
  totalIngredients: number;
  /** recognizedRatio < 0.3 — движок пометит score как «приблизительный». */
  lowConfidence: boolean;
}

const LOW_CONFIDENCE_THRESHOLD = 0.3;

/* ───────── Raw row shapes ───────── */

interface RawCompatRow {
  barcode: string;
  business_key: string;
  brand_normalized: string | null;
  product_name_normalized: string | null;
  category: string | null;
  image_url: string | null;
  quality_score: number;
  recognized_ratio: number;
  total_ingredients: number;
  /** jsonb-массив → уже распарсен Prisma в массив объектов DmIngredientRow. */
  facts: DmIngredientRow[] | null;
}

interface RawHeaderRow {
  barcode: string;
  business_key: string;
  brand_normalized: string | null;
  product_name_normalized: string | null;
  category: string | null;
  image_url: string | null;
  quality_score: number;
}

/* ───────── Mappers ───────── */

function toHeader(r: RawHeaderRow): DmProductHeader {
  return {
    barcode: r.barcode,
    businessKey: r.business_key,
    brandNormalized: r.brand_normalized,
    productName: r.product_name_normalized,
    category: r.category,
    imageUrl: r.image_url,
    qualityScore: r.quality_score,
  };
}

function toInput(r: RawCompatRow): DmCompatibilityInput {
  return {
    product: toHeader(r),
    rows: r.facts ?? [],
    recognizedRatio: r.recognized_ratio,
    totalIngredients: r.total_ingredients,
    lowConfidence: r.recognized_ratio < LOW_CONFIDENCE_THRESHOLD,
  };
}

/* ───────── Core query (1 запрос, без N+1) ───────── */

async function queryCompatRows(barcodes: string[]): Promise<RawCompatRow[]> {
  if (barcodes.length === 0) return [];
  return prisma.$queryRaw<RawCompatRow[]>(Prisma.sql`
    SELECT
      p.barcode,
      p.business_key,
      p.brand_normalized,
      p.product_name_normalized,
      p.category,
      p.image_url,
      p.quality_score::int        AS quality_score,
      f.recognized_ratio::float8  AS recognized_ratio,
      f.total_ingredients::int    AS total_ingredients,
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
  `);
}

/* ───────── Public API ───────── */

/** Только заголовок товара из dm.dm_products (без состава). */
export async function getDmProductByBarcode(
  barcode: string,
): Promise<DmProductHeader | null> {
  const rows = await prisma.$queryRaw<RawHeaderRow[]>(Prisma.sql`
    SELECT barcode, business_key, brand_normalized, product_name_normalized,
           category, image_url, quality_score::int AS quality_score
    FROM dm.dm_products
    WHERE barcode = ${barcode}
    LIMIT 1
  `);
  return rows[0] ? toHeader(rows[0]) : null;
}

/** Канонический состав товара (готов к featuresToFacts). */
export async function getDmProductIngredientFacts(
  barcode: string,
): Promise<DmIngredientRow[]> {
  const input = await getDmCompatibilityInput(barcode);
  return input?.rows ?? [];
}

/** Полный вход для движка по одному barcode. */
export async function getDmCompatibilityInput(
  barcode: string,
): Promise<DmCompatibilityInput | null> {
  const rows = await queryCompatRows([barcode]);
  return rows[0] ? toInput(rows[0]) : null;
}

/**
 * Batch-вариант: вход для движка по списку barcode одним запросом (против N+1
 * на forMe-листингах). Возвращает Map по barcode; отсутствующие просто не в Map.
 */
export async function getDmCompatibilityInputs(
  barcodes: string[],
): Promise<Map<string, DmCompatibilityInput>> {
  const out = new Map<string, DmCompatibilityInput>();
  const unique = [...new Set(barcodes.filter(Boolean))];
  if (unique.length === 0) return out;
  const rows = await queryCompatRows(unique);
  for (const r of rows) out.set(r.barcode, toInput(r));
  return out;
}
