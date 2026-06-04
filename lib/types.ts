/**
 * Доменные типы Skinly.
 *
 * Phase 2 использует их только для mock-данных. В Phase 6 (Domain) часть из
 * них переедет в Prisma-схему как enum'ы и модели.
 *
 * Phase 3: UI-лейблы (skin type, sensitivity, история-buckets, etc.)
 * больше НЕ хранятся в данных — они приходят из messages/{ru|en}.json
 * через next-intl. Здесь живут только идентификаторы.
 */

/* ───────── Ингредиенты и продукты ───────── */

export type IngredientSafety = "beneficial" | "neutral" | "caution" | "danger";

export interface Ingredient {
  id: string;
  inci: string;
  /** Локализованное имя — пока хранится в product mock на RU. */
  displayName: string;
  /** Короткий ярлык, который показывается на бейдже карточки. */
  shortLabel: string;
  description: string;
  safety: IngredientSafety;
}

export type VerdictTone = "good" | "caution";

export type CompatibilityStatus =
  | "compatible"
  | "patch_test"
  | "supports"
  | "treats"
  | "warning"
  | "incompatible";

export interface CompatibilityRow {
  label: string;
  status: CompatibilityStatus;
  caption: string;
}

export interface Product {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  category: string;
  /** Эмодзи-плейсхолдер до подключения реальных изображений. */
  emoji: string;
  matchScore: number;
  verdict: VerdictTone;
  verdictTitle: string;
  verdictSubtitle: string;
  aiExplanation: string[];
  ingredients: Ingredient[];
  compatibility: CompatibilityRow[];
}

/* ───────── История сканирований ───────── */

export type HistoryBucket = "today" | "yesterday" | "week" | "older";

export interface ScanRecord {
  id: string;
  productId: string;
  product: Product;
  scannedAt: Date;
  bucket: HistoryBucket;
}

/* ───────── Профиль кожи ───────── */

export type SkinType = "dry" | "oily" | "combination" | "normal";
export type SensitivityLevel = "none" | "mild" | "high" | "reactive";
export type SkinConcern =
  | "acne"
  | "aging"
  | "pigmentation"
  | "redness"
  | "pores"
  | "blackheads";
export type AvoidedIngredient =
  | "fragrance"
  | "alcohol"
  | "sulfates"
  | "parabens"
  | "essential_oils";
export type SkincareGoal =
  | "clear_skin"
  | "anti_aging"
  | "hydration"
  | "even_tone"
  | "minimal_routine";

/* ───────── Профиль волос ───────── */

export type HairType = "straight" | "wavy" | "curly" | "coily";
export type ScalpType = "normal" | "dry" | "oily" | "sensitive";
export type HairConcern =
  | "frizz"
  | "damage"
  | "hair_loss"
  | "dandruff"
  | "dullness"
  | "split_ends";
export type HaircareGoal =
  | "hydration"
  | "volume"
  | "repair"
  | "growth"
  | "color_protection"
  | "anti_frizz";

export interface HairProfile {
  hairType: HairType;
  scalpType: ScalpType;
  concerns: HairConcern[];
  goal: HaircareGoal;
  completion: number;
}

export interface SkinProfile {
  skinType: SkinType;
  sensitivity: SensitivityLevel;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal;
  /** 0..100 — индикатор заполненности. */
  completion: number;
}

export interface UserProfile {
  name: string;
  email: string;
  avatarEmoji: string;
  plan: "free" | "pro";
  skinProfile: SkinProfile;
  stats: {
    scans: number;
    products: number;
    avgMatch: number;
  };
}

/* ───────── Onboarding ───────── */

export type OnboardingAnswerKind = "single" | "multi";

/**
 * Опция вопроса. Лейбл (`label`) НЕ хранится здесь — мы его смотрим в
 * messages/*.json по ключу `onboarding.questions.<questionId>.options.<optionId>`.
 */
export interface OnboardingOptionDef {
  id: string;
  emoji: string;
}

/**
 * Определение вопроса. `title` / `subtitle` лежат в messages.
 */
export interface OnboardingQuestionDef {
  id: string;
  kind: OnboardingAnswerKind;
  options: OnboardingOptionDef[];
  /** multi: максимальное количество выборов. */
  maxSelect?: number;
  /** "grid" — 2-col с эмодзи (по умолчанию), "list" — полная ширина с текстом. */
  layout?: "grid" | "list";
  /** Скрыть вопрос, если другой вопрос имеет одно из указанных значений. */
  skipIf?: { questionId: string; values: string[] };
  /** Выбор этой опции снимает все остальные (и наоборот). */
  exclusiveOptionId?: string;
}
