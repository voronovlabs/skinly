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
  return {
    skinType: (p.skinType ?? null) as SkinType | null,
    sensitivity: (p.sensitivity ?? null) as SensitivityLevel | null,
    concerns: p.concerns as SkinConcern[],
    avoidedList: p.avoidedList as AvoidedIngredient[],
    goal: (p.goal ?? null) as SkincareGoal | null,
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
