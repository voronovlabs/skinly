/**
 * MVP recommendations service — оркестрация (SERVER-ONLY, тянет prisma).
 *
 * Pipeline (perf-refactor, двухэтапный):
 *
 *   1. cache-check: неперсонализированные запросы (subject == null) отдаются
 *      из in-memory TTL cache (см. cache.ts). Персонализированные — никогда.
 *   2. seed-режим (barcode): кандидаты той же категории + ingredient_overlap.
 *      profile-режим (нет barcode): топ по качеству/распознанности.
 *      getRecoSeed и buildPreference запускаются ПАРАЛЛЕЛЬНО.
 *   3. Дешёвый pre-score для всего пула (без compatibility, без reasons):
 *      overlap + quality + recognized + risk(по флагам кандидата) + preference.
 *   4. Только top-K (COMPAT_TOP_K) идут в тяжёлый getDmCompatibilityInputs
 *      (jsonb_agg состава) + evaluateCompatibility → финальный score + gate.
 *      Если профиль пуст — compatibility НЕ считается вообще (score был бы 0).
 *   5. reasons строятся ТОЛЬКО для итоговых top-N позиций.
 *
 * Защиты (сохранены из v1):
 *   - low_seed_confidence: seed.recognized_ratio < 0.3 → вес overlap режется.
 *   - hard compatibility-gate: при профиле не отдаём compat < 60
 *     (fallback 50, затем без gate, если совсем мало).
 *
 * API-контракт (DTO RecommendationItem) НЕ менялся.
 */

import type { SkinProfileSummaryLike } from "@/lib/compatibility";
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
  blendPreference,
  buildReasons,
  classifyRecommendation,
  computeRiskPenalty,
  recommendationScore,
} from "./score";
import { buildPreference, preferenceSignals } from "./preference";
import { recoCacheGet, recoCacheKey, recoCacheSet } from "./cache";
import { createRecoTimer, type RecoTimer } from "./timing";
import type {
  CandidateRow,
  Preference,
  RecommendationItem,
  RecommendationsParams,
  SeedRow,
} from "./types";

/**
 * Размер пула кандидатов из SQL. Был 150 — избыточно: до финала доходят
 * limit ≤ 30 позиций, а ранжирование хвоста (позиции 100..150) на выдачу
 * не влияло. 100 оставляет запас для gate/fallback.
 */
const POOL_SIZE = 100;
/**
 * Сколько лучших по pre-score кандидатов получают тяжёлый compatibility
 * (jsonb_agg состава + движок). 40 = 4× дефолтного limit — запас на gate.
 */
const COMPAT_TOP_K = 40;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const LOW_SEED_CONFIDENCE = 0.3;
const COMPAT_GATE = 60;
const COMPAT_GATE_FALLBACK = 50;
const MIN_AFTER_GATE = 3;

interface ScoredCandidate {
  cand: CandidateRow;
  recScore: number;
  compatScoreRaw: number; // 0..100 (0 = нет данных / профиль пуст)
  riskPenalty: number;
  triggeredAvoidedCount: number;
}

/** Профиль «фактически пуст» → compatibility даст sentinel 0, не считаем. */
function isProfileEffectivelyEmpty(p: SkinProfileSummaryLike | null): boolean {
  if (!p) return true;
  return (
    !p.skinType &&
    !p.sensitivity &&
    !p.goal &&
    (p.concerns?.length ?? 0) === 0 &&
    (p.avoidedList?.length ?? 0) === 0
  );
}

export async function getRecommendations(
  params: RecommendationsParams,
  timer: RecoTimer = createRecoTimer(),
): Promise<RecommendationItem[]> {
  const limit = Math.max(
    1,
    Math.min(Number.isFinite(params.limit) ? params.limit : DEFAULT_LIMIT, MAX_LIMIT),
  );
  const profile = params.profile ?? null;
  const profileProvided = params.profile != null;
  const profileEmpty = isProfileEffectivelyEmpty(profile);
  const engineProfile = summaryProfileToEngine(profile);
  const subject = params.subject ?? null;

  // ── Cache (только без subject: выдача детерминирована) ──
  const cacheKey = subject
    ? null
    : recoCacheKey(params.barcode ?? null, limit, profile);
  if (cacheKey) {
    const hit = recoCacheGet(cacheKey);
    if (hit) {
      timer.note(`barcode=${params.barcode ?? "—"} cached=1`);
      return hit;
    }
  }

  // ── Seed + preference ПАРАЛЛЕЛЬНО (независимые запросы) ──
  const [seed, preference] = await Promise.all([
    params.barcode
      ? timer.time("getRecoSeed", () => getRecoSeed(params.barcode!))
      : Promise.resolve<SeedRow | null>(null),
    subject
      ? timer.time("buildPreference", () => buildPreference(subject))
      : Promise.resolve<Preference | null>(null),
  ]);

  const lowSeedConfidence =
    !!seed && seed.recognizedRatio < LOW_SEED_CONFIDENCE;

  const candidates: CandidateRow[] =
    seed && seed.cset.length > 0
      ? await timer.time("getRecoSeedCandidates", () =>
          getRecoSeedCandidates(seed, POOL_SIZE),
        )
      : await timer.time("getRecoProfileCandidates", () =>
          getRecoProfileCandidates(POOL_SIZE),
        );

  if (candidates.length === 0) {
    timer.note(`barcode=${params.barcode ?? "—"} candidates=0`);
    debugLog({
      params, seed, lowSeedConfidence, candidates,
      beforeCompatibilityGate: 0, afterCompatibilityGate: 0,
      fallbackUsed: false, finalCount: 0, preference, topScored: [],
    });
    return [];
  }

  // ── Этап 1: дешёвый pre-score всего пула (без compatibility) ──
  const preScored: ScoredCandidate[] = timer.timeSync("preScore", () =>
    candidates.map((c) => {
      // triggeredAvoided без движка не знаем → 0 (уточним на этапе 2 для top-K).
      const risk = computeRiskPenalty(profile, c, 0);
      const base = recommendationScore({
        overlap: c.overlap,
        seedSetSize: seed?.cset.length ?? 0,
        qualityScore: c.quality_score,
        recognizedRatio: c.recognized_ratio,
        compatibilityScore: 0, // profileFit добавится на этапе 2
        riskPenalty: risk,
        sameBrand: !!seed && !!seed.brand && c.brand === seed.brand,
        lowSeedConfidence,
      });
      const sig = preference ? preferenceSignals(preference, c) : null;
      return {
        cand: c,
        recScore: sig ? blendPreference(base, sig) : base,
        compatScoreRaw: 0,
        riskPenalty: risk,
        triggeredAvoidedCount: 0,
      };
    }),
  );
  preScored.sort((a, b) => b.recScore - a.recScore);

  // ── Этап 2: тяжёлый compatibility ТОЛЬКО для top-K и ТОЛЬКО при профиле ──
  const topK = preScored.slice(0, Math.max(COMPAT_TOP_K, limit));
  let scored: ScoredCandidate[] = topK;

  if (!profileEmpty) {
    const dmInputs = await timer.time("getDmCompatibilityInputs", () =>
      getDmCompatibilityInputs(topK.map((s) => s.cand.barcode)),
    );
    scored = timer.timeSync("jsScoring", () =>
      topK.map((s) => {
        const c = s.cand;
        const dm = dmInputs.get(c.barcode);
        const facts = dm ? featuresToFacts(dm.rows) : [];
        const compat = evaluateCompatibility(engineProfile, facts);
        const risk = computeRiskPenalty(
          profile, c, compat.triggeredAvoided.length,
        );
        const base = recommendationScore({
          overlap: c.overlap,
          seedSetSize: seed?.cset.length ?? 0,
          qualityScore: c.quality_score,
          recognizedRatio: c.recognized_ratio,
          compatibilityScore: compat.score,
          riskPenalty: risk,
          sameBrand: !!seed && !!seed.brand && c.brand === seed.brand,
          lowSeedConfidence,
        });
        const sig = preference ? preferenceSignals(preference, c) : null;
        return {
          cand: c,
          recScore: sig ? blendPreference(base, sig) : base,
          compatScoreRaw: compat.score,
          riskPenalty: risk,
          triggeredAvoidedCount: compat.triggeredAvoided.length,
        };
      }),
    );
  }

  // ── Hard compatibility-gate (только при наличии профиля) ──
  const beforeCompatibilityGate = scored.length;
  let gated = scored;
  let fallbackUsed = false;
  if (profileProvided && !profileEmpty) {
    const strict = scored.filter((s) => s.compatScoreRaw >= COMPAT_GATE);
    if (strict.length >= MIN_AFTER_GATE) {
      gated = strict;
    } else {
      const relaxed = scored.filter(
        (s) => s.compatScoreRaw >= COMPAT_GATE_FALLBACK,
      );
      fallbackUsed = true;
      gated = relaxed.length >= MIN_AFTER_GATE ? relaxed : scored;
    }
  }
  const afterCompatibilityGate = gated.length;

  gated.sort((a, b) => b.recScore - a.recScore);
  const finalists = gated.slice(0, limit);

  // ── reasons строим ТОЛЬКО для итогового top-N ──
  const top: RecommendationItem[] = timer.timeSync("buildItems", () =>
    finalists.map((s) => {
      const c = s.cand;
      const { confidence, recommendationType } = classifyRecommendation(
        s.compatScoreRaw,
      );
      const sig = preference ? preferenceSignals(preference, c) : null;
      return {
        barcode: c.barcode,
        brand: c.brand,
        name: c.name,
        category: c.category,
        imageUrl: c.image_url,
        recommendationScore: Math.round(s.recScore * 100),
        compatibilityScore: s.compatScoreRaw > 0 ? s.compatScoreRaw : null,
        confidence,
        recommendationType,
        reasons: buildReasons({
          seed,
          cand: c,
          profile,
          lowSeedConfidence,
          compatibilityScore: s.compatScoreRaw,
          riskPenalty: s.riskPenalty,
          recommendationType,
          preference: sig,
        }),
      };
    }),
  );

  if (cacheKey) recoCacheSet(cacheKey, top);

  timer.note(
    `barcode=${params.barcode ?? "—"} mode=${seed ? "seed" : "profile"} ` +
      `pool=${candidates.length} topK=${topK.length} ` +
      `compat=${profileEmpty ? "skipped" : "computed"} final=${top.length}`,
  );
  debugLog({
    params, seed, lowSeedConfidence, candidates,
    beforeCompatibilityGate, afterCompatibilityGate,
    fallbackUsed, finalCount: top.length, preference,
    topScored: gated.slice(0, 5),
  });
  return top;
}

function topEntries(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(", ");
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
  preference: Preference | null;
  topScored: ScoredCandidate[];
}): void {
  if (process.env.RECO_DEBUG !== "1") return;
  const topOverlap = d.candidates.reduce((m, c) => Math.max(m, c.overlap), 0);
  const subj = d.params.subject;
  const subjectType = subj?.userId ? "user" : subj?.anonymousId ? "anon" : "none";
  const subjectId = subj?.userId ?? subj?.anonymousId ?? "—";
  // eslint-disable-next-line no-console
  console.log(
    `[reco] seed=${d.params.barcode ?? "—"} mode=${d.seed ? "seed" : "profile"} ` +
      `subjectType=${subjectType} subjectId=${subjectId} ` +
      `preferenceEventCount=${d.preference?.eventCount ?? 0} ` +
      `seedRecognizedRatio=${d.seed ? d.seed.recognizedRatio.toFixed(4) : "—"} ` +
      `lowSeedConfidence=${d.lowSeedConfidence} ` +
      `candidatesAfterGates=${d.candidates.length} topOverlap=${topOverlap} ` +
      `beforeCompatibilityGate=${d.beforeCompatibilityGate} ` +
      `afterCompatibilityGate=${d.afterCompatibilityGate} ` +
      `fallbackUsed=${d.fallbackUsed} final=${d.finalCount}`,
  );
  if (d.preference) {
    const p = d.preference;
    // eslint-disable-next-line no-console
    console.log(
      `[reco] likedCategories=[${topEntries(p.categoryAffinity, 5)}] ` +
        `likedBrands=[${topEntries(p.brandAffinity, 5)}] ` +
        `likedIngredients=[${topEntries(p.ingredientAffinity, 10)}] ` +
        `alreadySeen=${p.seenBarcodes.size} negative=${p.negativeBarcodes.size}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[reco] top5=[${d.topScored
        .map((s) => `${s.cand.barcode}:rec${Math.round(s.recScore * 100)}/compat${s.compatScoreRaw || "—"}`)
        .join(", ")}]`,
    );
  }
  if (d.seed) {
    void getRecoDebugCounts(d.seed).then((c) => {
      // eslint-disable-next-line no-console
      console.log(
        `[reco] candidatesBeforeGates=${c.beforeGates} candidatesAfterGates=${c.afterGates}`,
      );
    });
  }
}
