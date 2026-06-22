/**
 * MVP recommendation scoring + объяснения. PURE (без БД/движка).
 *
 * Нормальные веса:
 *   0.35 overlap + 0.25 quality + 0.20 recognized + 0.20 profileFit
 *   − 0.10 risk − 0.05 same_brand
 *
 * Если seed «слабый» (recognized_ratio < 0.3) — overlap ненадёжен, поэтому
 * его вес режется, а ценность переносится на profileFit/quality:
 *   0.10 overlap + 0.30 quality + 0.20 recognized + 0.40 profileFit (− risk/brand)
 */

import type { SkinProfileSummaryLike } from "@/lib/compatibility";
import type {
  CandidateRow,
  Confidence,
  PreferenceSignals,
  RecommendationType,
  SeedRow,
} from "./types";

/**
 * Классификация по compatibilityScore (raw 0..100):
 *   >= 75 → high / strong
 *   >= 60 → medium / strong
 *   <  60 → low / fallback
 */
export function classifyRecommendation(compatScore: number): {
  confidence: Confidence;
  recommendationType: RecommendationType;
} {
  if (compatScore >= 75) return { confidence: "high", recommendationType: "strong" };
  if (compatScore >= 60) return { confidence: "medium", recommendationType: "strong" };
  return { confidence: "low", recommendationType: "fallback" };
}

const W_NORMAL = {
  overlap: 0.35,
  quality: 0.25,
  recognized: 0.2,
  profileFit: 0.2,
  risk: 0.1,
  sameBrand: 0.05,
} as const;

/** Low-confidence seed: overlap почти не учитываем, упор на профиль/качество. */
const W_LOWCONF = {
  overlap: 0.1,
  quality: 0.3,
  recognized: 0.2,
  profileFit: 0.4,
  risk: 0.1,
  sameBrand: 0.05,
} as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export interface ScoreInputs {
  overlap: number;
  seedSetSize: number; // 0 → профильный режим (overlap-компонент = 0)
  qualityScore: number; // 0..100
  recognizedRatio: number; // 0..1
  compatibilityScore: number; // 0..100 (0 = нет данных)
  riskPenalty: number; // 0..1
  sameBrand: boolean;
  /** seed.recognized_ratio < 0.3 → overlap ненадёжен. */
  lowSeedConfidence: boolean;
}

/** Итоговый recommendation_score в 0..1. */
export function recommendationScore(i: ScoreInputs): number {
  const W = i.lowSeedConfidence ? W_LOWCONF : W_NORMAL;

  const overlapNorm =
    i.seedSetSize > 0 ? clamp01(i.overlap / i.seedSetSize) : 0;
  const qualityNorm = clamp01(i.qualityScore / 100);
  const recognizedNorm = clamp01(i.recognizedRatio);
  const profileFit =
    i.compatibilityScore > 0 ? clamp01(i.compatibilityScore / 100) : 0;

  const raw =
    W.overlap * overlapNorm +
    W.quality * qualityNorm +
    W.recognized * recognizedNorm +
    W.profileFit * profileFit -
    W.risk * clamp01(i.riskPenalty) -
    W.sameBrand * (i.sameBrand ? 1 : 0);

  return clamp01(raw);
}

/**
 * Подмешать предпочтения к базовому score (0..1 → 0..1). Применяется ТОЛЬКО
 * когда preference есть (eventCount ≥ 2). Без preference базовый score не
 * меняется — текущее поведение endpoint'а сохраняется 1:1.
 *
 *   final = base*0.75
 *         + 0.08*catAff + 0.07*brandAff + 0.08*ingAff
 *         − 0.06*alreadySeen − 0.10*negative
 */
export function blendPreference(
  baseScore: number,
  p: PreferenceSignals,
): number {
  const raw =
    baseScore * 0.75 +
    0.08 * clamp01(p.likedCategoryAffinity) +
    0.07 * clamp01(p.likedBrandAffinity) +
    0.08 * clamp01(p.likedIngredientAffinity) -
    0.06 * (p.alreadySeen ? 1 : 0) -
    0.1 * (p.negative ? 1 : 0);
  return clamp01(raw);
}

const SENSITIVE = new Set(["high", "reactive"]);

/** Профиль-зависимый штраф риска 0..1. */
export function computeRiskPenalty(
  profile: SkinProfileSummaryLike | null,
  cand: CandidateRow,
  triggeredAvoidedCount: number,
): number {
  let r = 0;
  if (triggeredAvoidedCount > 0) r += 0.5;
  if (profile && SENSITIVE.has(profile.sensitivity ?? "")) {
    if (cand.has_fragrance || cand.has_essential_oils || cand.has_drying_alcohol) {
      r += 0.3;
    }
  }
  r += (Math.min(cand.irritancy_max, 3) / 3) * 0.2;
  return clamp01(r);
}

/** Лейблы «содержит актив» по canonical_id. */
const ACTIVE_LABELS: Record<string, string> = {
  niacinamide: "Содержит ниацинамид",
  panthenol: "Содержит пантенол",
  sodium_hyaluronate: "Содержит гиалуроновую кислоту",
  ceramide_np: "Содержит церамиды",
  centella: "Содержит центеллу",
  vitamin_c: "Содержит витамин C",
  retinol: "Содержит ретинол",
  azelaic_acid: "Содержит азелаиновую кислоту",
  allantoin: "Содержит аллантоин",
  squalane: "Содержит сквалан",
};

/**
 * До 4 человекочитаемых причин, приоритезированных. Причины не должны врать:
 *   - «Похожий состав» — только при надёжном seed и реальном overlap;
 *   - «Лучше для чувствительной кожи» — только при высоком compat и низком риске;
 *   - «Подходит по профилю» — только при высоком compat.
 */
export function buildReasons(args: {
  seed: SeedRow | null;
  cand: CandidateRow;
  profile: SkinProfileSummaryLike | null;
  lowSeedConfidence: boolean;
  compatibilityScore: number; // raw 0..100
  riskPenalty: number; // 0..1
  recommendationType: RecommendationType;
  /** Сигналы предпочтений (null = персонализации нет). */
  preference?: PreferenceSignals | null;
}): string[] {
  const {
    seed,
    cand,
    profile,
    lowSeedConfidence,
    compatibilityScore,
    riskPenalty,
    recommendationType,
    preference,
  } = args;
  const isStrong = recommendationType === "strong";
  const out: string[] = [];

  // Похожий состав — только если seed надёжен и overlap реальный.
  if (seed && !lowSeedConfidence && cand.overlap >= 2) {
    out.push("Похожий состав");
  }
  // Честное предупреждение про слабый состав seed.
  if (seed && lowSeedConfidence) {
    out.push("Ограниченная уверенность по составу");
  }

  // Preference-причины (только если реальный сигнал есть). Максимум 2.
  if (preference) {
    const prefReasons: string[] = [];
    if (preference.likedCategoryAffinity > 0) {
      prefReasons.push("Похоже на товары, которые вы сохраняли");
    }
    if (preference.likedBrandAffinity > 0) {
      prefReasons.push("Бренд из ваших интересов");
    }
    if (preference.likedIngredientAffinity > 0) {
      prefReasons.push("Похожий активный состав");
    }
    // «Вы уже смотрели» НЕ показываем — только штрафуем в score.
    out.push(...prefReasons.slice(0, 2));
  }

  // Fallback (low) — честно помечаем как альтернативу той же категории.
  if (!isStrong && seed) {
    out.push("Альтернатива из той же категории");
  }
  // Подходит по профилю — только для strong при высоком compat.
  if (isStrong && compatibilityScore >= 75) {
    out.push("Подходит по профилю");
  }

  const avoidsFragrance = profile?.avoidedList?.includes("fragrance");
  if (avoidsFragrance && !cand.has_fragrance) out.push("Без отдушки");

  // Чувствительная кожа — только для strong при высоком compat и низком риске.
  const sensitive = profile != null && SENSITIVE.has(profile.sensitivity ?? "");
  if (
    isStrong &&
    sensitive &&
    compatibilityScore >= 70 &&
    riskPenalty < 0.2 &&
    cand.irritancy_max <= 1 &&
    !cand.has_essential_oils
  ) {
    out.push("Лучше подходит для чувствительной кожи");
  }

  for (const id of cand.top5_canonical) {
    const label = ACTIVE_LABELS[id];
    if (label) {
      out.push(label);
      break;
    }
  }

  // Качество данных — только при достаточной распознанности кандидата.
  if (cand.quality_score >= 70 && cand.recognized_ratio >= 0.5) {
    out.push("Хорошее качество данных");
  }

  return out.slice(0, 4);
}
