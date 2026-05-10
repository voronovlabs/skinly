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

function pickVerdict(
  score: number,
  warnings: readonly RuleHit[],
): CompatibilityVerdict {
  // Жёсткое: сработал avoidedList → минимум "mixed", даже если score высокий.
  const hasHardWarning = warnings.some(
    (w) => w.key === "compatibility.reasons.avoidedFlag",
  );
  if (hasHardWarning && score >= 70) return "mixed";

  if (score >= 88) return "excellent";
  if (score >= 72) return "good";
  if (score >= 50) return "mixed";
  return "risky";
}

/**
 * Топ-причины для UI: 1 hard warning (если есть) + до 3 позитивов.
 * Если нет позитивов — берём warnings.
 */
function pickTopReasons(
  positives: readonly RuleHit[],
  warnings: readonly RuleHit[],
): RuleHit[] {
  const out: RuleHit[] = [];
  const hardWarning = warnings.find(
    (w) => w.key === "compatibility.reasons.avoidedFlag",
  );
  if (hardWarning) out.push(hardWarning);

  // Сортировка позитивов по абсолютному вкладу.
  const sortedPositives = [...positives].sort((a, b) => b.weight - a.weight);
  for (const p of sortedPositives) {
    if (out.length >= 4) break;
    out.push(p);
  }

  // Если позитивов нет — добираем warnings.
  if (out.length < 2) {
    const sortedWarnings = [...warnings].sort((a, b) => a.weight - b.weight);
    for (const w of sortedWarnings) {
      if (out.length >= 4) break;
      if (w === hardWarning) continue;
      out.push(w);
    }
  }
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
  const reasons = pickTopReasons(positives, warnings);
  const matchedConcerns: SkinConcern[] = collectMatchedConcerns(profile, facts);
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
