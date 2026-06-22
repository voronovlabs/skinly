/**
 * Preference builder — on-the-fly из UserProductEvent (SERVER-ONLY).
 *
 * Один запрос: последние события subject за 90 дней + DM-данные товара
 * (category, brand_normalized, canonical ingredients). Без N+1, без кэша,
 * без новых таблиц.
 *
 * Веса событий (preference-специфичные, НЕ те, что хранятся в UserProductEvent):
 *   favorite +3 · like +3 · open_recommendation +2 · scan +1
 *   unfavorite −2 · dismiss −2 · dislike −3 · view/open 0
 *
 * Если значимых событий < 2 → возвращает null (рекомендации работают как раньше),
 * чтобы один случайный клик не ломал выдачу.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CandidateRow,
  Preference,
  PreferenceSignals,
  Subject,
} from "./types";

const LOOKBACK_DAYS = 90;
const EVENT_LIMIT = 500;
const MIN_EVENTS = 2;

const PREF_WEIGHTS: Record<string, number> = {
  favorite: 3,
  like: 3,
  open_recommendation: 2,
  scan: 1,
  unfavorite: -2,
  dismiss: -2,
  dislike: -3,
  view: 0,
  open: 0,
};

const SEEN_TYPES = new Set(["scan", "favorite", "open_recommendation"]);

interface RawEventRow {
  event_type: string;
  barcode: string;
  brand: string | null;
  category: string | null;
  canonical_ids: string[] | null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Нормализация Map весов в 0..1 по максимуму (пустая, если max ≤ 0). */
function normalize(raw: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of raw.values()) if (v > max) max = v;
  if (max <= 0) return new Map();
  const out = new Map<string, number>();
  for (const [k, v] of raw) if (v > 0) out.set(k, clamp01(v / max));
  return out;
}

export async function buildPreference(
  subject: Subject,
): Promise<Preference | null> {
  if (!subject.userId && !subject.anonymousId) return null;

  const subjectCond = subject.userId
    ? Prisma.sql`e."userId" = ${subject.userId}`
    : Prisma.sql`e."anonymousId" = ${subject.anonymousId}`;

  const rows = await prisma.$queryRaw<RawEventRow[]>(Prisma.sql`
    SELECT
      e."eventType"          AS event_type,
      e.barcode              AS barcode,
      p.brand_normalized     AS brand,
      p.category             AS category,
      CASE WHEN f.canonical_ingredients IS NULL THEN NULL
           ELSE ARRAY(SELECT el->>'canonical_id'
                      FROM jsonb_array_elements(f.canonical_ingredients) el)
      END                    AS canonical_ids
    FROM "UserProductEvent" e
    LEFT JOIN dm.dm_products p ON p.barcode = e.barcode
    LEFT JOIN dm.product_ingredient_features f ON f.business_key = p.business_key
    WHERE ${subjectCond}
      AND e."createdAt" >= now() - ${`${LOOKBACK_DAYS} days`}::interval
    ORDER BY e."createdAt" DESC
    LIMIT ${EVENT_LIMIT}
  `);

  const categoryRaw = new Map<string, number>();
  const brandRaw = new Map<string, number>();
  const ingredientRaw = new Map<string, number>();
  const perBarcodeNet = new Map<string, number>();
  const seenBarcodes = new Set<string>();
  let eventCount = 0;

  const add = (m: Map<string, number>, k: string | null, w: number) => {
    if (!k) return;
    m.set(k, (m.get(k) ?? 0) + w);
  };

  for (const r of rows) {
    const w = PREF_WEIGHTS[r.event_type] ?? 0;
    if (SEEN_TYPES.has(r.event_type)) seenBarcodes.add(r.barcode);
    if (w === 0) continue;
    eventCount += 1;
    perBarcodeNet.set(r.barcode, (perBarcodeNet.get(r.barcode) ?? 0) + w);
    if (w > 0) {
      add(categoryRaw, r.category, w);
      add(brandRaw, r.brand, w);
      for (const id of r.canonical_ids ?? []) add(ingredientRaw, id, w);
    }
  }

  if (eventCount < MIN_EVENTS) return null;

  const negativeBarcodes = new Set<string>();
  for (const [bc, net] of perBarcodeNet) if (net < 0) negativeBarcodes.add(bc);

  return {
    eventCount,
    categoryAffinity: normalize(categoryRaw),
    brandAffinity: normalize(brandRaw),
    ingredientAffinity: normalize(ingredientRaw),
    seenBarcodes,
    negativeBarcodes,
  };
}

/** Per-candidate сигналы из preference (top5_canonical как прокси состава). */
export function preferenceSignals(
  pref: Preference,
  cand: CandidateRow,
): PreferenceSignals {
  const likedCategoryAffinity = pref.categoryAffinity.get(cand.category) ?? 0;
  const likedBrandAffinity = pref.brandAffinity.get(cand.brand) ?? 0;

  let ingSum = 0;
  for (const id of cand.top5_canonical) ingSum += pref.ingredientAffinity.get(id) ?? 0;
  // 2 «сильно любимых» ингредиента → полный сигнал.
  const likedIngredientAffinity = clamp01(ingSum / 2);

  return {
    likedCategoryAffinity,
    likedBrandAffinity,
    likedIngredientAffinity,
    alreadySeen: pref.seenBarcodes.has(cand.barcode),
    negative: pref.negativeBarcodes.has(cand.barcode),
  };
}
