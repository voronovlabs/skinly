/**
 * Compatibility scoring engine — public entry point.
 *
 * Идея:
 *   1. Прогнать все правила → собрать RuleHit'ы.
 *   2. Сложить weight'ы поверх baseline=75.
 *   3. Применить «hard caps»: если хоть один avoidedList-флаг сработал,
 *      score не может быть выше 60 (продукт нарушает явный пользовательский
 *      запрет).
 *   4. Кламп в [25, 100] — engine никогда не выдаёт 0% при наличии профиля и
 *      ингредиентов. 0% = «engine не запускался» (отдельный sentinel).
 *   5. Verdict — пороги по score.
 *
 * Pure-функция: server- и client-safe, без БД, без Date, без Math.random.
 *
 * Если профиль пуст (никаких полей не заполнено) → возвращает специальный
 * "neutral" result со score=0 и lowConfidence=true. UI скроет match-bar.
 */

import type { SkinConcern } from "@/lib/types";
import {
  collectAvoidedTriggered,
  collectMatchedConcerns,
  RULES,
} from "./rules";
import { recognitionRatio } from "./ingredients";
import { buildIngredientFindings, buildRows } from "./explain";
import type {
  CompatibilityProfile,
  CompatibilityResult,
  CompatibilityVerdict,
  IngredientFact,
  RuleHit,
} from "./types";

const BASELINE = 75;
const SCORE_FLOOR = 25;
const SCORE_CEIL = 100;
/** Если avoidedList сработал — score не может быть выше этого. */
const AVOIDED_HARD_CAP = 60;
/** Минимальная доля распознанных ингредиентов для надёжного score. */
const RECOGNITION_THRESHOLD = 0.3;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isProfileEmpty(p: CompatibilityProfile): boolean {
  return (
    !p.skinType &&
    !p.sensitivity &&
    p.concerns.length === 0 &&
    p.avoidedList.length === 0 &&
    !p.goal
  );
}

const BLOCKER_KEY = "compatibility.reasons.avoidedFlag";

/**
 * Verdict = пороги score + гейты (Phase 1 redesign, см.
 * docs/compat-engine-redesign.md §6; score-математика НЕ менялась):
 *
 *   - blocker (нарушение avoidedList) → verdict не выше "mixed";
 *   - ЛЮБОЙ warning → verdict не выше "good" (excellent с предупреждением —
 *     противоречие, 206 случаев B1 в аудите 2026-07-11).
 */
function pickVerdict(
  score: number,
  warnings: readonly RuleHit[],
): CompatibilityVerdict {
  let v: CompatibilityVerdict;
  if (score >= 88) v = "excellent";
  else if (score >= 72) v = "good";
  else if (score >= 50) v = "mixed";
  else v = "risky";

  const hasBlocker = warnings.some((w) => w.key === BLOCKER_KEY);
  if (hasBlocker) {
    // Явный пользовательский запрет нарушен → максимум mixed.
    if (v === "excellent" || v === "good") v = "mixed";
    return v;
  }
  if (warnings.length > 0 && v === "excellent") v = "good";
  return v;
}

/* ───────── Reasons: группировка + слоты (Phase 1 explainability) ───────── */

/** Позитивы, завязанные на анкету (concerns/goal) — приоритетный слот. */
const PROFILE_SPECIFIC_KEYS = new Set([
  "compatibility.reasons.helpsConcern",
  "compatibility.reasons.goalAlignment",
]);

/** Сколько inci-примеров показываем в сгруппированной причине. */
const GROUP_EXAMPLES = 3;

interface ReasonGroup {
  rep: RuleHit; // репрезентативный hit (максимальный |weight|)
  count: number;
  inciList: string[];
  totalWeight: number;
}

/**
 * Сгруппировать hits по (key, concern, avoided): `dryFriendly × 8` становится
 * ОДНОЙ причиной `dryFriendlyMany` с {count} и {examples}. Для count=1
 * возвращается исходный hit без изменений (ключи и контракт прежние).
 */
function groupHits(hits: readonly RuleHit[]): ReasonGroup[] {
  const groups = new Map<string, ReasonGroup>();
  for (const h of hits) {
    const gk = `${h.key}:${h.concern ?? ""}:${h.avoided ?? ""}`;
    const g = groups.get(gk);
    if (!g) {
      groups.set(gk, {
        rep: h,
        count: 1,
        inciList: h.inci ? [h.inci] : [],
        totalWeight: h.weight,
      });
    } else {
      g.count += 1;
      g.totalWeight += h.weight;
      if (h.inci && !g.inciList.includes(h.inci)) g.inciList.push(h.inci);
      if (Math.abs(h.weight) > Math.abs(g.rep.weight)) g.rep = h;
    }
  }
  return [...groups.values()];
}

/** Группа → RuleHit для UI (count>1 → `<key>Many` + count/examples). */
function groupToHit(g: ReasonGroup): RuleHit {
  if (g.count === 1) return g.rep;
  return {
    ...g.rep,
    key: `${g.rep.key}Many`,
    args: {
      ...(g.rep.args ?? {}),
      ingredient: g.rep.inci ?? "",
      count: g.count,
      examples: g.inciList.slice(0, GROUP_EXAMPLES).join(", "),
    },
  };
}

/**
 * Топ-причины для UI (слоты, максимум 5):
 *   1. blocker (avoidedFlag), если есть;
 *   2. лучший profile-specific позитив (helpsConcern/goalAlignment);
 *   3. САМЫЙ ВЕСОМЫЙ warning — всегда, если warnings есть (в аудите
 *      предупреждение выпадало из объяснения в 570 случаях C3);
 *   4. лучшие generic-позитивы — до заполнения 4 слотов;
 *   5. + до 1 info-hit (`concernNotCovered`) в конец.
 * Повторы одного ключа схлопнуты группировкой (1752 случая D2).
 */
function pickTopReasons(
  positives: readonly RuleHit[],
  warnings: readonly RuleHit[],
  infos: readonly RuleHit[],
): RuleHit[] {
  const posGroups = groupHits(positives).sort(
    (a, b) => b.totalWeight - a.totalWeight,
  );
  const warnGroups = groupHits(warnings).sort(
    (a, b) => a.totalWeight - b.totalWeight,
  );

  const out: RuleHit[] = [];
  const used = new Set<ReasonGroup>();

  const blocker = warnGroups.find((g) => g.rep.key === BLOCKER_KEY);
  if (blocker) {
    out.push(groupToHit(blocker));
    used.add(blocker);
  }

  const profileSpecific = posGroups.find((g) =>
    PROFILE_SPECIFIC_KEYS.has(g.rep.key),
  );
  if (profileSpecific) {
    out.push(groupToHit(profileSpecific));
    used.add(profileSpecific);
  }

  const topWarning = warnGroups.find((g) => !used.has(g));
  if (topWarning) {
    out.push(groupToHit(topWarning));
    used.add(topWarning);
  }

  for (const g of posGroups) {
    if (out.length >= 4) break;
    if (used.has(g)) continue;
    out.push(groupToHit(g));
    used.add(g);
  }
  // Если позитивов не хватило — добираем оставшиеся warnings.
  for (const g of warnGroups) {
    if (out.length >= 4) break;
    if (used.has(g)) continue;
    out.push(groupToHit(g));
    used.add(g);
  }

  // Честность персонализации: заявленный concern без покрытия в составе.
  if (infos.length > 0) out.push(infos[0]);

  return out;
}

/**
 * Подсчитать compatibility для (profile, facts).
 *
 * Idempotent / pure / cheap: O(N_rules × N_facts).
 */
export function evaluateCompatibility(
  profile: CompatibilityProfile,
  facts: readonly IngredientFact[],
): CompatibilityResult {
  // Если профиль пуст — engine ничего сказать не может. Это НЕ ошибка;
  // просто нет почвы. UI скроет match-circle и покажет CTA «Заполнить анкету».
  const profileEmpty = isProfileEmpty(profile);

  // Собираем hits из всех rules.
  const hits: RuleHit[] = profileEmpty
    ? []
    : RULES.flatMap((r) => r.evaluate({ profile, facts }));

  const positives = hits.filter((h) => h.kind === "positive");
  const warnings = hits.filter((h) => h.kind === "warning");

  const recognized = recognitionRatio(facts);
  const lowConfidence =
    profileEmpty || facts.length === 0 || recognized < RECOGNITION_THRESHOLD;

  // ── Score ──
  let score: number;
  if (profileEmpty || facts.length === 0) {
    // sentinel: 0 → UI знает, что «нет почвы»
    score = 0;
  } else {
    const sumPositives = positives.reduce((s, h) => s + h.weight, 0);
    const sumWarnings = warnings.reduce((s, h) => s + h.weight, 0);

    // diminishing returns на позитивах: после +30 каждый следующий идёт x0.5
    const dampenedPositives =
      sumPositives <= 30 ? sumPositives : 30 + (sumPositives - 30) * 0.5;

    let raw = BASELINE + dampenedPositives + sumWarnings;
    raw = clamp(raw, SCORE_FLOOR, SCORE_CEIL);

    // Hard cap: avoidedList триггер.
    const hardWarning = warnings.some(
      (h) => h.key === "compatibility.reasons.avoidedFlag",
    );
    if (hardWarning) {
      raw = Math.min(raw, AVOIDED_HARD_CAP);
    }

    // Если KB распознал слишком мало — притянуть к baseline (защита от
    // overconfidence на неизвестном составе).
    if (lowConfidence) {
      raw = Math.round(raw * 0.5 + BASELINE * 0.5);
    }

    score = Math.round(raw);
  }

  const verdict = pickVerdict(score || BASELINE, warnings);
  const matchedConcerns: SkinConcern[] = collectMatchedConcerns(profile, facts);

  // info-hits (weight 0, в score не участвуют): заявленный concern, под
  // который в составе нет ни одного benefits-ингредиента. Пользователь
  // видит, что анкета учтена, даже когда совпадений нет.
  const infos: RuleHit[] = profileEmpty || facts.length === 0
    ? []
    : profile.concerns
        .filter((c) => !matchedConcerns.includes(c))
        .slice(0, 1)
        .map((concern) => ({
          kind: "info" as const,
          key: "compatibility.reasons.concernNotCovered",
          args: { concern },
          weight: 0,
          concern,
        }));

  const reasons = pickTopReasons(positives, warnings, infos);
  const triggeredAvoided = collectAvoidedTriggered(profile, facts);
  const rows = buildRows({
    profile,
    matchedConcerns,
    triggeredAvoided,
    warnings,
    positives,
  });
  const ingredientFindings = buildIngredientFindings(facts, hits);

  return {
    score,
    verdict,
    reasons,
    positives,
    warnings,
    matchedConcerns,
    triggeredAvoided,
    rows,
    ingredientFindings,
    lowConfidence,
  };
}

/* ───────── Re-exports for convenience ───────── */

export type {
  CompatibilityProfile,
  CompatibilityResult,
  CompatibilityVerdict,
  IngredientFact,
  IngredientFinding,
  RuleHit,
  CompatibilityRowComputed,
  CompatibilityRowStatus,
  IngredientSafety,
  IngredientTag,
  KbEntry,
} from "./types";

export { findKbEntry, inciToFact, inciListToFacts } from "./ingredients";
