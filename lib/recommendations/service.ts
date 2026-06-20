/**
 * MVP recommendations service — оркестрация (SERVER-ONLY, тянет prisma).
 *
 *   1. seed-режим (barcode): кандидаты той же категории + ingredient_overlap.
 *      profile-режим (нет barcode): топ по качеству/распознанности.
 *   2. compatibility для пула считаем через DM-вход (getDmCompatibilityInputs)
 *      + featuresToFacts + evaluateCompatibility — тем же движком, что и web.
 *   3. recommendation_score (формула MVP) → hard compatibility-gate → top-N.
 *
 * Защиты:
 *   - low_seed_confidence: если seed.recognized_ratio < 0.3, overlap слабый →
 *     режем его вес (в score.ts) и не врём в reasons.
 *   - hard compatibility-gate: при наличии профиля не отдаём кандидатов с
 *     compatibilityScore < 60 (fallback 50, затем — без gate, если совсем мало).
 *
 * Импортируется только серверным route-handler'ом. Без ML/embeddings.
 */

import {
  evaluateCompatibility,
  featuresToFacts,
  summaryProfileToEngine,
} from "@/lib/compatibility";
import { getDmCompatibilityInputs } from "@/lib/db/repositories/dm-products";
import {
  getRecoDebugCounts,
  getRecoProfileCandidates,
  getRecoSeed,
  getRecoSeedCandidates,
} from "@/lib/db/repositories/dm-recommendations";
import {
  buildReasons,
  classifyRecommendation,
  computeRiskPenalty,
  recommendationScore,
} from "./score";
import type {
  CandidateRow,
  RecommendationItem,
  RecommendationsParams,
  SeedRow,
} from "./types";

const POOL_SIZE = 150;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const LOW_SEED_CONFIDENCE = 0.3;
const COMPAT_GATE = 60;
const COMPAT_GATE_FALLBACK = 50;
const MIN_AFTER_GATE = 3;

interface ScoredCandidate {
  item: RecommendationItem;
  recScore: number;
  compatScoreRaw: number; // 0..100 (0 = нет данных)
}

export async function getRecommendations(
  params: RecommendationsParams,
): Promise<RecommendationItem[]> {
  const limit = Math.max(
    1,
    Math.min(Number.isFinite(params.limit) ? params.limit : DEFAULT_LIMIT, MAX_LIMIT),
  );
  const engineProfile = summaryProfileToEngine(params.profile ?? null);
  const profileProvided = params.profile != null;

  let seed: SeedRow | null = null;
  if (params.barcode) seed = await getRecoSeed(params.barcode);

  const lowSeedConfidence =
    !!seed && seed.recognizedRatio < LOW_SEED_CONFIDENCE;

  const candidates: CandidateRow[] =
    seed && seed.cset.length > 0
      ? await getRecoSeedCandidates(seed, POOL_SIZE)
      : await getRecoProfileCandidates(POOL_SIZE);

  if (candidates.length === 0) {
    debugLog({
      params,
      seed,
      lowSeedConfidence,
      candidates,
      beforeCompatibilityGate: 0,
      afterCompatibilityGate: 0,
      fallbackUsed: false,
      finalCount: 0,
    });
    return [];
  }

  // Compatibility одним запросом за весь пул (без N+1).
  const dmInputs = await getDmCompatibilityInputs(candidates.map((c) => c.barcode));

  const scored: ScoredCandidate[] = candidates.map((c) => {
    const dm = dmInputs.get(c.barcode);
    const facts = dm ? featuresToFacts(dm.rows) : [];
    const compat = evaluateCompatibility(engineProfile, facts);
    const compatScoreRaw = compat.score; // 0 = пустой профиль / нет состава
    const risk = computeRiskPenalty(
      params.profile ?? null,
      c,
      compat.triggeredAvoided.length,
    );
    const sameBrand = !!seed && !!seed.brand && c.brand === seed.brand;

    const recScore = recommendationScore({
      overlap: c.overlap,
      seedSetSize: seed?.cset.length ?? 0,
      qualityScore: c.quality_score,
      recognizedRatio: c.recognized_ratio,
      compatibilityScore: compatScoreRaw,
      riskPenalty: risk,
      sameBrand,
      lowSeedConfidence,
    });

    const { confidence, recommendationType } =
      classifyRecommendation(compatScoreRaw);

    const item: RecommendationItem = {
      barcode: c.barcode,
      brand: c.brand,
      name: c.name,
      category: c.category,
      imageUrl: c.image_url,
      recommendationScore: Math.round(recScore * 100),
      compatibilityScore: compatScoreRaw > 0 ? compatScoreRaw : null,
      confidence,
      recommendationType,
      reasons: buildReasons({
        seed,
        cand: c,
        profile: params.profile ?? null,
        lowSeedConfidence,
        compatibilityScore: compatScoreRaw,
        riskPenalty: risk,
        recommendationType,
      }),
    };
    return { item, recScore, compatScoreRaw };
  });

  // Hard compatibility-gate (только при наличии профиля).
  const beforeCompatibilityGate = scored.length;
  let gated = scored;
  let fallbackUsed = false;
  if (profileProvided) {
    const strict = scored.filter((s) => s.compatScoreRaw >= COMPAT_GATE);
    if (strict.length >= MIN_AFTER_GATE) {
      gated = strict;
    } else {
      const relaxed = scored.filter((s) => s.compatScoreRaw >= COMPAT_GATE_FALLBACK);
      fallbackUsed = true;
      // Совсем мало даже на 50 → не режем (но reasons не врут: «Подходит по
      // профилю» добавляется только при compat >= 75).
      gated = relaxed.length >= MIN_AFTER_GATE ? relaxed : scored;
    }
  }
  const afterCompatibilityGate = gated.length;

  gated.sort((a, b) => b.recScore - a.recScore);
  const top = gated.slice(0, limit).map((s) => s.item);

  debugLog({
    params,
    seed,
    lowSeedConfidence,
    candidates,
    beforeCompatibilityGate,
    afterCompatibilityGate,
    fallbackUsed,
    finalCount: top.length,
  });
  return top;
}

function debugLog(d: {
  params: RecommendationsParams;
  seed: SeedRow | null;
  lowSeedConfidence: boolean;
  candidates: CandidateRow[];
  beforeCompatibilityGate: number;
  afterCompatibilityGate: number;
  fallbackUsed: boolean;
  finalCount: number;
}): void {
  if (process.env.RECO_DEBUG !== "1") return;
  const topOverlap = d.candidates.reduce((m, c) => Math.max(m, c.overlap), 0);
  // eslint-disable-next-line no-console
  console.log(
    `[reco] seed=${d.params.barcode ?? "—"} mode=${d.seed ? "seed" : "profile"} ` +
      `seedRecognizedRatio=${d.seed ? d.seed.recognizedRatio.toFixed(4) : "—"} ` +
      `lowSeedConfidence=${d.lowSeedConfidence} ` +
      `candidatesAfterGates=${d.candidates.length} topOverlap=${topOverlap} ` +
      `beforeCompatibilityGate=${d.beforeCompatibilityGate} ` +
      `afterCompatibilityGate=${d.afterCompatibilityGate} ` +
      `fallbackUsed=${d.fallbackUsed} final=${d.finalCount}`,
  );
  if (d.seed) {
    void getRecoDebugCounts(d.seed).then((c) => {
      // eslint-disable-next-line no-console
      console.log(
        `[reco] candidatesBeforeGates=${c.beforeGates} candidatesAfterGates=${c.afterGates}`,
      );
    });
  }
}
