/**
 * Compatibility engine — barrel.
 *
 * Public API:
 *   - evaluateCompatibility(profile, facts)  → CompatibilityResult
 *   - inciToFact(inci, position?)            → IngredientFact
 *   - inciListToFacts([{inci,position}])     → IngredientFact[]
 *   - findKbEntry(inci)                      → KbEntry | null
 *
 * Adapters:
 *   - dbBeautyProfileToEngine(BeautyProfile) → CompatibilityProfile
 *   - demoProfileToEngine(DemoSkinProfile)   → CompatibilityProfile
 *   - summaryProfileToEngine(SkinProfileSummary) → CompatibilityProfile
 *   - dbIngredientsToFacts(ProductIngredient[]) → IngredientFact[]
 *   - mockIngredientsToFacts(MockIngredient[]) → IngredientFact[]
 *   - mockProductToFacts(MockProduct)        → IngredientFact[]
 *
 * Все функции pure и server-/client-safe (без БД, без Date.now, без рандомов).
 */

export {
  evaluateCompatibility,
  findKbEntry,
  inciToFact,
  inciListToFacts,
} from "./score";

export type {
  CompatibilityProfile,
  CompatibilityResult,
  CompatibilityVerdict,
  CompatibilityRowComputed,
  CompatibilityRowStatus,
  IngredientFact,
  IngredientFinding,
  IngredientSafety,
  IngredientTag,
  KbEntry,
  RuleHit,
} from "./types";

export {
  dbBeautyProfileToEngine,
  demoProfileToEngine,
  summaryProfileToEngine,
  emptyProfile,
  dbIngredientsToFacts,
  mockIngredientsToFacts,
  mockProductToFacts,
} from "./adapters";

export type { SkinProfileSummaryLike } from "./adapters";

export { recognitionRatio } from "./ingredients";
