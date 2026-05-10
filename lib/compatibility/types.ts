/**
 * Compatibility engine — типы.
 *
 * Phase 10.1: deterministic rules engine. Без AI, без LLM, без БД-зависимостей.
 * Все типы — pure data; engine может работать в Edge / RSC / клиенте одинаково.
 *
 * Соглашения:
 *   - Идентификаторы (skinType, sensitivity, concerns, avoidedList, goal)
 *     хранятся в lowercase-форме (`"dry"`, `"high"`, `"acne"`, ...) — совпадает
 *     с messages/*.json и demo-store. DB-енумы (`DRY`) приводятся к lowercase
 *     через `lib/compatibility/adapters.ts` ДО входа в engine.
 *   - Reason-сообщения возвращаются в виде `key + args` (i18n keys); сам перевод
 *     делает компонент-потребитель через next-intl.
 *
 * Future-proofing:
 *   - Phase 10.2 (AI explanation): добавит к Result поле `aiExplanation?: string[]`
 *     поверх engine output (без изменения engine API).
 *   - Phase 10.3 (ML scoring): сможет переопределить `score` после rules,
 *     оставаясь совместимым с UI.
 *   - Phase 10.4 (ingredient interaction graph): новый набор rules внутри
 *     `rules.ts`; engine API не меняется.
 */

import type {
  AvoidedIngredient,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@/lib/types";

/* ───────── Profile (engine input) ───────── */

export interface CompatibilityProfile {
  skinType: SkinType | null;
  sensitivity: SensitivityLevel | null;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal | null;
}

/* ───────── Ingredient knowledge ───────── */

/**
 * Дополнительные тэги, которые понимает rules-движок (помимо явных
 * benefitsFor / cautionsFor). Например, `fragrance` нужен правилу
 * `sensitivity_trigger`, даже если flagsAvoided пуст.
 */
export type IngredientTag =
  | "humectant"
  | "barrier"
  | "soothing"
  | "occlusive"
  | "exfoliant_aha"
  | "exfoliant_bha"
  | "exfoliant_pha"
  | "retinoid"
  | "vitamin_c"
  | "antioxidant"
  | "fragrance"
  | "alcohol_drying"
  | "essential_oil"
  | "comedogenic_oil"
  | "heavy_oil"
  | "physical_filter"
  | "chemical_filter"
  | "sulfate_surfactant"
  | "paraben"
  | "active";

export type IngredientSafety = "beneficial" | "neutral" | "caution" | "danger";

/**
 * Запись knowledge-base. Ровно одна на канонический ингредиент.
 */
export interface KbEntry {
  /** Стабильный id (используется в i18n: `compatibility.ingredients.<id>.*`). */
  id: string;
  /** Каноническое INCI. */
  inci: string;
  /** Дополнительные строки, по которым lookup тоже совпадает. */
  aliases: readonly string[];
  benefitsFor: readonly SkinConcern[];
  cautionsFor: readonly SkinConcern[];
  flagsAvoided: readonly AvoidedIngredient[];
  tags: readonly IngredientTag[];
  baseSafety: IngredientSafety;
}

/**
 * Один ингредиент продукта, уже сопоставленный с KB. Если KB не нашёл —
 * `kbId === null` и поля заполняются дефолтами (нейтрально).
 */
export interface IngredientFact {
  /** Исходное INCI (для отображения / debug). */
  inci: string;
  /** Позиция в составе (1 — первый). 0, если неизвестна. */
  position: number;
  /** Резолвленный KB id или null. */
  kbId: string | null;
  benefitsFor: readonly SkinConcern[];
  cautionsFor: readonly SkinConcern[];
  flagsAvoided: readonly AvoidedIngredient[];
  tags: readonly IngredientTag[];
  baseSafety: IngredientSafety;
}

/* ───────── Rule output ───────── */

/**
 * Один «голос» правила. Идёт в `score` через `weight`, и в UI через `key/args`
 * (i18n).
 */
export interface RuleHit {
  /** Ключ-идентификатор причины — стабильный, для i18n и отладки. */
  key: string;
  /** Аргументы для ICU. */
  args?: Record<string, string | number>;
  /** Положительная (плюс к score) или предупреждающая (минус). */
  kind: "positive" | "warning";
  /** Δ-score от этого hit'а. Положительный — буст, отрицательный — штраф. */
  weight: number;
  /** Ингредиент, спровоцировавший правило (если применимо). */
  inci?: string;
  /** Продакшн-id KB-entry (если применимо). */
  kbId?: string;
  /** Концерн, к которому относится hit (если правило по концерну). */
  concern?: SkinConcern;
  /** Avoided-флаг, к которому относится hit. */
  avoided?: AvoidedIngredient;
}

/* ───────── Compatibility table row (UI shape) ───────── */

export type CompatibilityRowStatus =
  | "compatible"
  | "supports"
  | "treats"
  | "patch_test"
  | "warning"
  | "incompatible";

/**
 * Готовая к рендеру строка «Совместимость с кожей». Лейбл/caption — ключи i18n.
 * Аргументы локализуются на стороне компонента-потребителя.
 */
export interface CompatibilityRowComputed {
  /** i18n key для label, например `compatibility.rows.skinType` */
  labelKey: string;
  labelArgs?: Record<string, string | number>;
  /** i18n key для caption (пр. `compatibility.captions.compatible`). */
  captionKey: string;
  captionArgs?: Record<string, string | number>;
  status: CompatibilityRowStatus;
}

/* ───────── Ingredient finding (UI shape) ───────── */

export interface IngredientFinding {
  inci: string;
  position: number;
  kbId: string | null;
  /** Safety _с учётом профиля_ (не базовая). */
  evaluatedSafety: IngredientSafety;
  /**
   * Короткий ярлык для бейджа карточки. Возвращается как i18n-key,
   * например `compatibility.tags.beneficial`.
   */
  shortLabelKey: string;
  /** i18n-key для описания. */
  descriptionKey?: string;
}

/* ───────── Final result ───────── */

export type CompatibilityVerdict = "excellent" | "good" | "mixed" | "risky";

export interface CompatibilityResult {
  /** 0..100 (engine никогда не возвращает 0 при наличии profile + ingredients). */
  score: number;
  verdict: CompatibilityVerdict;
  /** Топовые причины — для VerdictCard subtitle / explanation block. */
  reasons: RuleHit[];
  /** Все позитивные hits. */
  positives: RuleHit[];
  /** Все предупреждающие hits. */
  warnings: RuleHit[];
  /** Концерны профиля, которые продукт реально адресует. */
  matchedConcerns: SkinConcern[];
  /** Avoided-флаги, которые продукт нарушает. */
  triggeredAvoided: AvoidedIngredient[];
  /** Готовые строки «Совместимость с кожей» (4-6 штук). */
  rows: CompatibilityRowComputed[];
  /** Per-ingredient findings — для IngredientCard. */
  ingredientFindings: IngredientFinding[];
  /**
   * Индикатор «engine знает мало об этом продукте». Возникает, если из всех
   * ингредиентов KB резолвнул < 30%. UI может скрыть match badge.
   */
  lowConfidence: boolean;
}
