/**
 * Adapter layer — приведение разных источников данных к engine input shape.
 *
 *   - DB BeautyProfile (uppercase enum'ы) → CompatibilityProfile (lowercase)
 *   - Demo store DemoSkinProfile             → CompatibilityProfile
 *   - DB ProductIngredient[] (with Ingredient) → IngredientFact[]
 *   - Mock Product.ingredients               → IngredientFact[]
 *
 * Главное: после адаптеров данные имеют тот же shape — engine один и тот же
 * для guest и user.
 */

import type {
  AvoidedIngredient as DbAvoided,
  BeautyProfile as DbBeautyProfile,
  Ingredient as DbIngredient,
  ProductIngredient as DbProductIngredient,
  SensitivityLevel as DbSensitivity,
  SkinConcern as DbConcern,
  SkinType as DbSkinType,
  SkincareGoal as DbGoal,
} from "@prisma/client";
import type {
  AvoidedIngredient,
  Ingredient as MockIngredient,
  Product as MockProduct,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@/lib/types";
import type { DemoSkinProfile } from "@/lib/demo-store";
import { inciToFact } from "./ingredients";
import type {
  CompatibilityProfile,
  IngredientFact,
} from "./types";

/* ───────── Profile adapters ───────── */

export function dbBeautyProfileToEngine(
  p: DbBeautyProfile | null | undefined,
): CompatibilityProfile {
  if (!p) return emptyProfile();
  return {
    skinType: lowerEnum<DbSkinType, SkinType>(p.skinType),
    sensitivity: lowerEnum<DbSensitivity, SensitivityLevel>(p.sensitivity),
    concerns: p.concerns.map((c) => lowerEnum<DbConcern, SkinConcern>(c)!),
    avoidedList: p.avoidedList.map(
      (a) => lowerEnum<DbAvoided, AvoidedIngredient>(a)!,
    ),
    goal: lowerEnum<DbGoal, SkincareGoal>(p.goal),
  };
}

export function demoProfileToEngine(
  p: DemoSkinProfile | null | undefined,
): CompatibilityProfile {
  if (!p) return emptyProfile();
  return {
    skinType: p.skinType ?? null,
    sensitivity: p.sensitivity ?? null,
    concerns: [...p.concerns],
    avoidedList: [...p.avoidedList],
    goal: p.goal ?? null,
  };
}

/**
 * Обобщённый «summary»-формат, который используется в SkinProfileCard
 * (lowercase id'шники) — бывает на user-странице после сериализации DB-профиля.
 */
export interface SkinProfileSummaryLike {
  skinType: string | null;
  sensitivity: string | null;
  concerns: string[];
  avoidedList: string[];
  goal: string | null;
}

export function summaryProfileToEngine(
  p: SkinProfileSummaryLike | null | undefined,
): CompatibilityProfile {
  if (!p) return emptyProfile();
  const n = normalizeProfileVocabulary(p);
  return {
    skinType: (n.skinType ?? null) as SkinType | null,
    sensitivity: (n.sensitivity ?? null) as SensitivityLevel | null,
    concerns: n.concerns as SkinConcern[],
    avoidedList: n.avoidedList as AvoidedIngredient[],
    goal: (n.goal ?? null) as SkincareGoal | null,
  };
}

/* ───────── Vocabulary adapter (Phase 1 redesign) ─────────
 *
 * Аудит 2026-07-11 (probes): анкета/клиенты могут прислать значения вне
 * словаря движка (`dryness`, `oiliness`, `oilControl`, `brightening`,
 * `soothing`, `silicones`) — раньше это был тихий no-op: пользователь думал,
 * что профиль учтён, движок его игнорировал. Здесь — детерминированный
 * маппинг на ближайшие валидные значения; неизвестное после маппинга
 * отфильтровывается (junk не должен попадать в engine).
 */

const VOCAB_CONCERNS = new Set([
  "acne", "aging", "pigmentation", "redness", "pores", "blackheads",
]);
const VOCAB_GOALS = new Set([
  "clear_skin", "anti_aging", "hydration", "even_tone", "minimal_routine",
]);
const VOCAB_AVOIDED = new Set([
  "fragrance", "alcohol", "sulfates", "parabens", "essential_oils",
]);

function normToken(v: string): string {
  return v.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** goal-синонимы → валидный SkincareGoal. */
const GOAL_SYNONYMS: Record<string, string> = {
  oilcontrol: "clear_skin",
  oil_control: "clear_skin",
  acnecontrol: "clear_skin",
  acne_control: "clear_skin",
  brightening: "even_tone",
  whitening: "even_tone",
  antiaging: "anti_aging",
  anti_age: "anti_aging",
  moisturizing: "hydration",
  hydrating: "hydration",
};

/** avoided-синонимы → валидный AvoidedIngredient. */
const AVOIDED_SYNONYMS: Record<string, string> = {
  essentialoils: "essential_oils",
  essential_oil: "essential_oils",
  parfum: "fragrance",
  perfume: "fragrance",
  sulphates: "sulfates",
  paraben: "parabens",
  // "silicones" движок пока не размечает (нет флага в KB/properties) —
  // отфильтруется; поддержка — отдельная data-задача (Phase 2).
};

/**
 * Нормализация словаря профиля. Сверх синонимов:
 *   - concern "dryness"  → goal=hydration (если goal пуст): пользователь,
 *     переживающий о сухости, хочет увлажнение;
 *   - concern "oiliness" → goal=clear_skin (если goal пуст);
 *   - goal "soothing"    → concern redness (ближайший канал движка).
 * Функция pure/deterministic; валидные значения проходят без изменений.
 */
export function normalizeProfileVocabulary(
  p: SkinProfileSummaryLike,
): SkinProfileSummaryLike {
  const concerns: string[] = [];
  let goal = p.goal ? normToken(p.goal) : null;

  if (goal && !VOCAB_GOALS.has(goal)) {
    if (GOAL_SYNONYMS[goal]) {
      goal = GOAL_SYNONYMS[goal];
    } else if (goal === "soothing" || goal === "calming") {
      concerns.push("redness");
      goal = null;
    } else {
      goal = null;
    }
  }

  for (const raw of p.concerns ?? []) {
    const c = normToken(raw);
    if (VOCAB_CONCERNS.has(c)) {
      concerns.push(c);
    } else if (c === "dryness") {
      if (!goal) goal = "hydration";
    } else if (c === "oiliness" || c === "oily") {
      if (!goal) goal = "clear_skin";
    }
    // прочее — junk, отфильтровываем
  }

  const avoidedList: string[] = [];
  for (const raw of p.avoidedList ?? []) {
    const a = normToken(raw);
    if (VOCAB_AVOIDED.has(a)) avoidedList.push(a);
    else if (AVOIDED_SYNONYMS[a]) avoidedList.push(AVOIDED_SYNONYMS[a]);
  }

  return {
    skinType: p.skinType,
    sensitivity: p.sensitivity,
    concerns: [...new Set(concerns)],
    avoidedList: [...new Set(avoidedList)],
    goal,
  };
}

export function emptyProfile(): CompatibilityProfile {
  return {
    skinType: null,
    sensitivity: null,
    concerns: [],
    avoidedList: [],
    goal: null,
  };
}

function lowerEnum<TIn extends string, TOut extends string>(
  v: TIn | null | undefined,
): TOut | null {
  if (v == null) return null;
  return v.toLowerCase() as TOut;
}

/* ───────── Ingredient adapters ───────── */

/**
 * DB ProductIngredient[] (с join на Ingredient) → engine facts.
 */
export function dbIngredientsToFacts(
  links: ReadonlyArray<DbProductIngredient & { ingredient: DbIngredient }>,
): IngredientFact[] {
  return links.map((l) => inciToFact(l.ingredient.inci, l.position));
}

/**
 * Mock Ingredient[] (Phase 2 каталог) → engine facts.
 */
export function mockIngredientsToFacts(
  list: readonly MockIngredient[],
): IngredientFact[] {
  return list.map((ing, i) => inciToFact(ing.inci, i + 1));
}

/**
 * Удобный wrapper: целый mock-Product → engine facts.
 */
export function mockProductToFacts(p: MockProduct): IngredientFact[] {
  return mockIngredientsToFacts(p.ingredients);
}
