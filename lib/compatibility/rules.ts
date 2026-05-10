/**
 * Compatibility engine — декларативные правила.
 *
 * Каждое правило получает (profile, facts) и эмитит RuleHit'ы. Правила
 * НЕ напрямую двигают score — score рассчитывает `score.ts` суммированием
 * weight'ов. Поэтому добавление правила = один объект в этот массив.
 *
 * Принципы:
 *   - Правила опираются ТОЛЬКО на семантику Fact'ов (tags, benefitsFor,
 *     flagsAvoided), а не на конкретные INCI. Это значит — расширение KB
 *     автоматически расширяет покрытие всех правил.
 *   - i18n-ключи стабильны: `compatibility.reasons.<id>` + аргументы.
 *   - Веса — взаимно понятные: «отдушка для чувствительной» -15, «ниацинамид
 *     для акне» +10. Жёсткие штрафы — для нарушений avoidedList (-25).
 *
 * Будущие правила (Phase 10.4 — interaction graph) добавятся сюда же,
 * без изменений engine API.
 */

import type {
  AvoidedIngredient,
  SkinConcern,
} from "@/lib/types";
import type {
  CompatibilityProfile,
  IngredientFact,
  RuleHit,
} from "./types";

interface RuleContext {
  profile: CompatibilityProfile;
  facts: readonly IngredientFact[];
}

interface Rule {
  id: string;
  evaluate: (ctx: RuleContext) => RuleHit[];
}

/** Дедупликация по `inci + key` — чтобы один и тот же ингредиент не вылезал
 *  дважды в одной и той же причине, если KB-aliases совпали. */
function dedupeByInciKey(hits: RuleHit[]): RuleHit[] {
  const seen = new Set<string>();
  const out: RuleHit[] = [];
  for (const h of hits) {
    const id = `${h.key}:${h.inci ?? ""}:${h.concern ?? ""}:${h.avoided ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(h);
  }
  return out;
}

/* ───────── Rules ───────── */

const ruleAvoidedList: Rule = {
  id: "avoided_list",
  evaluate: ({ profile, facts }) => {
    if (profile.avoidedList.length === 0) return [];
    const hits: RuleHit[] = [];
    for (const f of facts) {
      for (const flag of f.flagsAvoided) {
        if (profile.avoidedList.includes(flag)) {
          hits.push({
            kind: "warning",
            key: "compatibility.reasons.avoidedFlag",
            args: { ingredient: f.inci, avoided: flag },
            // Жёсткий штраф — это явный пользовательский запрет.
            weight: -25,
            inci: f.inci,
            kbId: f.kbId ?? undefined,
            avoided: flag,
          });
        }
      }
    }
    return dedupeByInciKey(hits);
  },
};

const ruleSensitivity: Rule = {
  id: "sensitivity",
  evaluate: ({ profile, facts }) => {
    if (profile.sensitivity !== "high" && profile.sensitivity !== "reactive") {
      return [];
    }
    const hits: RuleHit[] = [];
    for (const f of facts) {
      const trigger =
        f.tags.includes("fragrance") ||
        f.tags.includes("essential_oil") ||
        f.tags.includes("alcohol_drying");
      if (!trigger) continue;
      hits.push({
        kind: "warning",
        key: "compatibility.reasons.sensitiveTrigger",
        args: { ingredient: f.inci },
        weight: profile.sensitivity === "reactive" ? -18 : -12,
        inci: f.inci,
        kbId: f.kbId ?? undefined,
      });
    }
    return dedupeByInciKey(hits);
  },
};

const ruleStrongActivesForSensitive: Rule = {
  id: "strong_actives_for_sensitive",
  evaluate: ({ profile, facts }) => {
    if (profile.sensitivity !== "high" && profile.sensitivity !== "reactive") {
      return [];
    }
    const strong = facts.filter(
      (f) =>
        f.tags.includes("retinoid") ||
        f.tags.includes("exfoliant_aha") ||
        f.tags.includes("exfoliant_bha"),
    );
    return strong.map<RuleHit>((f) => ({
      kind: "warning",
      key: "compatibility.reasons.activeForSensitive",
      args: { ingredient: f.inci },
      weight: profile.sensitivity === "reactive" ? -10 : -6,
      inci: f.inci,
      kbId: f.kbId ?? undefined,
    }));
  },
};

/** Универсальное правило «концерн помогает / мешает». Покрывает все концерны. */
const ruleConcernMatch: Rule = {
  id: "concern_match",
  evaluate: ({ profile, facts }) => {
    if (profile.concerns.length === 0) return [];
    const hits: RuleHit[] = [];
    for (const concern of profile.concerns) {
      for (const f of facts) {
        if (f.benefitsFor.includes(concern)) {
          hits.push({
            kind: "positive",
            key: "compatibility.reasons.helpsConcern",
            args: { ingredient: f.inci, concern },
            weight: weightForConcernHelp(concern, f),
            inci: f.inci,
            kbId: f.kbId ?? undefined,
            concern,
          });
        }
        if (f.cautionsFor.includes(concern)) {
          hits.push({
            kind: "warning",
            key: "compatibility.reasons.cautionForConcern",
            args: { ingredient: f.inci, concern },
            weight: -10,
            inci: f.inci,
            kbId: f.kbId ?? undefined,
            concern,
          });
        }
      }
    }
    return dedupeByInciKey(hits);
  },
};

function weightForConcernHelp(
  _concern: SkinConcern,
  f: IngredientFact,
): number {
  // Активы — сильнее, чем soothing-ingredients.
  if (f.tags.includes("active")) return 12;
  if (f.tags.includes("antioxidant") || f.tags.includes("soothing")) return 6;
  return 8;
}

/* ── skinType-специфичные правила ── */

const ruleSkinDry: Rule = {
  id: "skin_dry",
  evaluate: ({ profile, facts }) => {
    if (profile.skinType !== "dry") return [];
    const hits: RuleHit[] = [];
    for (const f of facts) {
      if (
        f.tags.includes("humectant") ||
        f.tags.includes("barrier") ||
        f.tags.includes("occlusive")
      ) {
        hits.push({
          kind: "positive",
          key: "compatibility.reasons.dryFriendly",
          args: { ingredient: f.inci },
          weight: 5,
          inci: f.inci,
          kbId: f.kbId ?? undefined,
        });
      }
      if (f.tags.includes("alcohol_drying")) {
        hits.push({
          kind: "warning",
          key: "compatibility.reasons.dryStripping",
          args: { ingredient: f.inci },
          weight: -8,
          inci: f.inci,
          kbId: f.kbId ?? undefined,
        });
      }
    }
    return dedupeByInciKey(hits);
  },
};

const ruleSkinOily: Rule = {
  id: "skin_oily",
  evaluate: ({ profile, facts }) => {
    if (profile.skinType !== "oily") return [];
    const hits: RuleHit[] = [];
    for (const f of facts) {
      if (f.tags.includes("heavy_oil") || f.tags.includes("comedogenic_oil")) {
        hits.push({
          kind: "warning",
          key: "compatibility.reasons.oilyHeavy",
          args: { ingredient: f.inci },
          weight: -10,
          inci: f.inci,
          kbId: f.kbId ?? undefined,
        });
      }
      // Лёгкие увлажнители — позитивны для жирной кожи.
      if (f.tags.includes("humectant") && !f.tags.includes("occlusive")) {
        hits.push({
          kind: "positive",
          key: "compatibility.reasons.oilyLightHydration",
          args: { ingredient: f.inci },
          weight: 4,
          inci: f.inci,
          kbId: f.kbId ?? undefined,
        });
      }
    }
    return dedupeByInciKey(hits);
  },
};

const ruleSkinCombination: Rule = {
  id: "skin_combination",
  evaluate: ({ profile, facts }) => {
    if (profile.skinType !== "combination") return [];
    const hits: RuleHit[] = [];
    for (const f of facts) {
      if (f.tags.includes("comedogenic_oil")) {
        hits.push({
          kind: "warning",
          key: "compatibility.reasons.combinationComedogenic",
          args: { ingredient: f.inci },
          weight: -6,
          inci: f.inci,
          kbId: f.kbId ?? undefined,
        });
      }
      if (f.tags.includes("humectant") || f.tags.includes("barrier")) {
        hits.push({
          kind: "positive",
          key: "compatibility.reasons.combinationBalanced",
          args: { ingredient: f.inci },
          weight: 3,
          inci: f.inci,
          kbId: f.kbId ?? undefined,
        });
      }
    }
    return dedupeByInciKey(hits);
  },
};

const ruleSkinNormal: Rule = {
  id: "skin_normal",
  evaluate: ({ profile, facts }) => {
    if (profile.skinType !== "normal") return [];
    // Нормальная кожа — никаких penalty по типу. Лёгкий бонус барьерным
    // ингредиентам (поддержание).
    return facts
      .filter(
        (f) => f.tags.includes("barrier") || f.tags.includes("antioxidant"),
      )
      .map<RuleHit>((f) => ({
        kind: "positive",
        key: "compatibility.reasons.normalMaintenance",
        args: { ingredient: f.inci },
        weight: 2,
        inci: f.inci,
        kbId: f.kbId ?? undefined,
      }));
  },
};

/** Goal-bonus: подсветить «по цели» (hydration / anti-aging / clear skin / even tone). */
const ruleGoal: Rule = {
  id: "goal_alignment",
  evaluate: ({ profile, facts }) => {
    if (!profile.goal) return [];
    const hits: RuleHit[] = [];
    for (const f of facts) {
      const matched = goalMatchesFact(profile.goal, f);
      if (!matched) continue;
      hits.push({
        kind: "positive",
        key: "compatibility.reasons.goalAlignment",
        args: { ingredient: f.inci, goal: profile.goal },
        weight: 4,
        inci: f.inci,
        kbId: f.kbId ?? undefined,
      });
    }
    return dedupeByInciKey(hits);
  },
};

function goalMatchesFact(
  goal: NonNullable<CompatibilityProfile["goal"]>,
  f: IngredientFact,
): boolean {
  switch (goal) {
    case "hydration":
      return f.tags.includes("humectant") || f.tags.includes("barrier");
    case "anti_aging":
      return (
        f.tags.includes("retinoid") ||
        f.tags.includes("antioxidant") ||
        f.tags.includes("vitamin_c") ||
        f.benefitsFor.includes("aging")
      );
    case "clear_skin":
      return (
        f.benefitsFor.includes("acne") ||
        f.benefitsFor.includes("blackheads") ||
        f.benefitsFor.includes("pores")
      );
    case "even_tone":
      return (
        f.benefitsFor.includes("pigmentation") || f.tags.includes("vitamin_c")
      );
    case "minimal_routine":
      // Лёгкий бонус мульти-функциональным ингредиентам (несколько benefitsFor).
      return f.benefitsFor.length >= 2;
    default:
      return false;
  }
}

/* ── Master rule list — порядок не важен, hits собираются all-at-once ── */

export const RULES: readonly Rule[] = [
  ruleAvoidedList,
  ruleSensitivity,
  ruleStrongActivesForSensitive,
  ruleConcernMatch,
  ruleSkinDry,
  ruleSkinOily,
  ruleSkinCombination,
  ruleSkinNormal,
  ruleGoal,
];

/* ───────── Helpers exported for engine ───────── */

export function collectAvoidedTriggered(
  profile: CompatibilityProfile,
  facts: readonly IngredientFact[],
): AvoidedIngredient[] {
  if (profile.avoidedList.length === 0) return [];
  const out = new Set<AvoidedIngredient>();
  for (const f of facts) {
    for (const flag of f.flagsAvoided) {
      if (profile.avoidedList.includes(flag)) out.add(flag);
    }
  }
  return [...out];
}

export function collectMatchedConcerns(
  profile: CompatibilityProfile,
  facts: readonly IngredientFact[],
): SkinConcern[] {
  if (profile.concerns.length === 0) return [];
  const out = new Set<SkinConcern>();
  for (const concern of profile.concerns) {
    if (facts.some((f) => f.benefitsFor.includes(concern))) out.add(concern);
  }
  return [...out];
}
