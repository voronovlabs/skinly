/**
 * MVP recommendations service — оркестрация (SERVER-ONLY, тянет prisma).
 *
 *   1. seed-режим (barcode): кандидаты той же категории + ingredient_overlap.
 *      profile-режим (нет barcode): топ по качеству/распознанности.
 *   2. compatibility для пула считаем через DM-вход (getDmCompatibilityInputs)
 *      + featuresToFacts + evaluateCompatibility — тем же движком, что и web.
 *   3. recommendation_score (формула MVP) → сортировка → top-N.
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

export async function getRecommendations(
  params: RecommendationsParams,
): Promise<RecommendationItem[]> {
  const limit = Math.max(
    1,
    Math.min(Number.isFinite(params.limit) ? params.limit : DEFAULT_LIMIT, MAX_LIMIT),
  );
  const engineProfile = summaryProfileToEngine(params.profile ?? null);

  let seed: SeedRow | null = null;
  if (params.barcode) seed = await getRecoSeed(params.barcode);

  const candidates: CandidateRow[] =
    seed && seed.cset.length > 0
      ? await getRecoSeedCandidates(seed, POOL_SIZE)
      : await getRecoProfileCandidates(POOL_SIZE);

  if (candidates.length === 0) {
    debugLog(params, seed, candidates, 0);
    return [];
  }

  // Compatibility одним запросом за весь пул (без N+1).
  const dmInputs = await getDmCompatibilityInputs(candidates.map((c) => c.barcode));

  const scored = candidates.map((c) => {
    const dm = dmInputs.get(c.barcode);
    const facts = dm ? featuresToFacts(dm.rows) : [];
    const compat = evaluateCompatibility(engineProfile, facts);
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
      compatibilityScore: compat.score,
      riskPenalty: risk,
      sameBrand,
    });

    const item: RecommendationItem = {
      barcode: c.barcode,
      brand: c.brand,
      name: c.name,
      category: c.category,
      imageUrl: c.image_url,
      recommendationScore: Math.round(recScore * 100),
      compatibilityScore: compat.score > 0 ? compat.score : null,
      reasons: buildReasons({ seed, cand: c, profile: params.profile ?? null }),
    };
    return { item, recScore };
  });

  scored.sort((a, b) => b.recScore - a.recScore);
  const top = scored.slice(0, limit).map((s) => s.item);

  debugLog(params, seed, candidates, top.length);
  return top;
}

function debugLog(
  params: RecommendationsParams,
  seed: SeedRow | null,
  candidates: CandidateRow[],
  finalCount: number,
): void {
  if (process.env.RECO_DEBUG !== "1") return;
  const topOverlap = candidates.reduce((m, c) => Math.max(m, c.overlap), 0);
  // eslint-disable-next-line no-console
  console.log(
    `[reco] seed=${params.barcode ?? "—"} mode=${seed ? "seed" : "profile"} ` +
      `candidatesAfterGates=${candidates.length} topOverlap=${topOverlap} final=${finalCount}`,
  );
  if (seed) {
    void getRecoDebugCounts(seed).then((d) => {
      // eslint-disable-next-line no-console
      console.log(
        `[reco] candidatesBeforeGates=${d.beforeGates} candidatesAfterGates=${d.afterGates}`,
      );
    });
  }
}
