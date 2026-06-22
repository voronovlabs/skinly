/**
 * MVP recommendations — общие типы (без ML/embeddings).
 */

import type { SkinProfileSummaryLike } from "@/lib/compatibility";

/** Кандидат, как его отдаёт SQL поверх dm.* (после gates). */
export interface CandidateRow {
  business_key: string;
  barcode: string;
  brand: string; // brand_normalized
  name: string; // product_name_normalized
  category: string;
  image_url: string | null;
  quality_score: number; // 0..100
  recognized_ratio: number; // 0..1
  has_fragrance: boolean;
  has_drying_alcohol: boolean;
  has_essential_oils: boolean;
  has_acids: boolean;
  has_retinoids: boolean;
  comedogenicity_max: number;
  irritancy_max: number;
  allergenicity_max: number;
  top5_canonical: string[];
  /** пересечение canonical с seed; 0 в профильном режиме. */
  overlap: number;
}

/** Seed-товар (когда передан barcode). */
export interface SeedRow {
  businessKey: string;
  barcode: string;
  brand: string | null;
  category: string;
  cset: string[]; // canonical_id'шники состава
  /** 0..1 — насколько надёжен состав seed'а. < 0.3 → low confidence. */
  recognizedRatio: number;
  has_fragrance: boolean;
  has_essential_oils: boolean;
  has_drying_alcohol: boolean;
  irritancy_max: number;
}

/** Кто запрашивает рекомендации (для персонализации по событиям). */
export interface Subject {
  userId: string | null;
  anonymousId: string | null;
}

export interface RecommendationsParams {
  barcode?: string | null;
  limit: number;
  profile: SkinProfileSummaryLike | null;
  /** null → без персонализации (как раньше). */
  subject?: Subject | null;
}

/** Preference vector, собранный on-the-fly из UserProductEvent. */
export interface Preference {
  eventCount: number;
  /** category → affinity 0..1. */
  categoryAffinity: Map<string, number>;
  /** brand_normalized → affinity 0..1. */
  brandAffinity: Map<string, number>;
  /** canonical_id → affinity 0..1. */
  ingredientAffinity: Map<string, number>;
  /** scan/favorite/open_recommendation. */
  seenBarcodes: Set<string>;
  /** net-negative (unfavorite/dismiss/dislike перевесили). */
  negativeBarcodes: Set<string>;
}

/** Per-candidate сигналы предпочтений (0..1 + флаги). */
export interface PreferenceSignals {
  likedCategoryAffinity: number;
  likedBrandAffinity: number;
  likedIngredientAffinity: number;
  alreadySeen: boolean;
  negative: boolean;
}

export type Confidence = "high" | "medium" | "low";
export type RecommendationType = "strong" | "fallback";

export interface RecommendationItem {
  barcode: string;
  brand: string;
  name: string;
  category: string;
  imageUrl: string | null;
  /** 0..100 — итог формулы MVP. */
  recommendationScore: number;
  /** 0..100 из compatibility-движка; null если профиль пуст / нет состава. */
  compatibilityScore: number | null;
  /** Сила рекомендации для UI: high/medium = strong, low = fallback. */
  confidence: Confidence;
  recommendationType: RecommendationType;
  reasons: string[];
}
