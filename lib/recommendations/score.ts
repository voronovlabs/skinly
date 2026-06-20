/**
 * MVP recommendation scoring + объяснения. PURE (без БД/движка).
 *
 * recommendation_score =
 *     0.35 * ingredient_overlap   (jaccard-ish к seed; 0 в профильном режиме)
 *   + 0.25 * quality_score        (/100)
 *   + 0.20 * recognized_ratio     (0..1)
 *   + 0.20 * profile_fit          (compatibilityScore/100)
 *   − 0.10 * risk_penalty         (профиль-зависимо)
 *   − 0.05 * same_brand_penalty   (для seed-режима — разнообразие выдачи)
 */

import type { SkinProfileSummaryLike } from "@/lib/compatibility";
import type { CandidateRow, SeedRow } from "./types";

const W = {
  overlap: 0.35,
  quality: 0.25,
  recognized: 0.2,
  profileFit: 0.2,
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
}

/** Итоговый recommendation_score в 0..1. */
export function recommendationScore(i: ScoreInputs): number {
  const overlapNorm =
    i.seedSetSize > 0 ? clamp01(i.overlap / i.seedSetSize) : 0;
  const qualityNorm = clamp01(i.qualityScore / 100);
  const recognizedNorm = clamp01(i.recognizedRatio);
  const profileFit = i.compatibilityScore > 0 ? clamp01(i.compatibilityScore / 100) : 0;

  const raw =
    W.overlap * overlapNorm +
    W.quality * qualityNorm +
    W.recognized * recognizedNorm +
    W.profileFit * profileFit -
    W.risk * clamp01(i.riskPenalty) -
    W.sameBrand * (i.sameBrand ? 1 : 0);

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
  // Кандидат нарушает явный avoided пользователя — сильный штраф.
  if (triggeredAvoidedCount > 0) r += 0.5;
  // Чувствительная кожа + потенциальные триггеры.
  if (profile && SENSITIVE.has(profile.sensitivity ?? "")) {
    if (cand.has_fragrance || cand.has_essential_oils || cand.has_drying_alcohol) {
      r += 0.3;
    }
  }
  // Лёгкий вклад по числовой раздражимости.
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

/** До 4 человекочитаемых причин, приоритезированных. */
export function buildReasons(args: {
  seed: SeedRow | null;
  cand: CandidateRow;
  profile: SkinProfileSummaryLike | null;
}): string[] {
  const { seed, cand, profile } = args;
  const out: string[] = [];

  if (seed && cand.overlap >= 2) out.push("Похожий состав");

  const avoidsFragrance = profile?.avoidedList?.includes("fragrance");
  if (avoidsFragrance && !cand.has_fragrance) out.push("Без отдушки");

  const sensitive = profile != null && SENSITIVE.has(profile.sensitivity ?? "");
  if (sensitive && cand.irritancy_max <= 1 && !cand.has_essential_oils) {
    out.push("Лучше подходит для чувствительной кожи");
  }

  for (const id of cand.top5_canonical) {
    const label = ACTIVE_LABELS[id];
    if (label) {
      out.push(label);
      break;
    }
  }

  if (cand.quality_score >= 70 && cand.recognized_ratio >= 0.6) {
    out.push("Хорошее качество данных");
  }

  return out.slice(0, 4);
}
