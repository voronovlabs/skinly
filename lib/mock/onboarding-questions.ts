import type { OnboardingQuestionDef } from "@/lib/types";

/**
 * 9 вопросов профиля кожи. Phase 12+: тексты заголовков, подзаголовков и
 * лейблы опций живут в messages/*.json — здесь только id + эмодзи + meta.
 *
 * Соответствие ключей i18n:
 *   onboarding.questions[id].title
 *   onboarding.questions[id].subtitle
 *   onboarding.questions[id].options[optionId]
 */
export const ONBOARDING_QUESTIONS: OnboardingQuestionDef[] = [
  // ── Блок "О вас" ──────────────────────────────────────────────────────────
  {
    id: "age",
    kind: "single",
    layout: "grid",
    options: [
      { id: "under22", emoji: "🌱" },
      { id: "y23_29", emoji: "🌿" },
      { id: "y30_39", emoji: "🌸" },
      { id: "y40plus", emoji: "🌺" },
    ],
  },
  {
    id: "gender",
    kind: "single",
    layout: "grid",
    options: [
      { id: "female", emoji: "👩" },
      { id: "male", emoji: "👨" },
    ],
  },
  {
    id: "pregnant",
    kind: "single",
    layout: "grid",
    // Пропускаем вопрос для мужчин
    skipIf: { questionId: "gender", values: ["male"] },
    options: [
      { id: "no", emoji: "🚫" },
      { id: "yes", emoji: "🤰" },
    ],
  },

  // ── Блок "Состояние кожи" ─────────────────────────────────────────────────
  {
    id: "skinBehavior",
    kind: "single",
    layout: "list",
    options: [
      { id: "normal", emoji: "" },
      { id: "combination", emoji: "" },
      { id: "oily", emoji: "" },
      { id: "dry", emoji: "" },
    ],
  },
  {
    id: "breakouts",
    kind: "single",
    layout: "list",
    options: [
      { id: "none", emoji: "" },
      { id: "occasional", emoji: "" },
      { id: "frequent", emoji: "" },
    ],
  },
  {
    id: "skinReaction",
    kind: "single",
    layout: "list",
    options: [
      { id: "calm", emoji: "" },
      { id: "mild", emoji: "" },
      { id: "couperose", emoji: "" },
      { id: "rosacea", emoji: "" },
    ],
  },
  {
    id: "pores",
    kind: "single",
    layout: "list",
    options: [
      { id: "none", emoji: "" },
      { id: "tzone", emoji: "" },
      { id: "allover", emoji: "" },
    ],
  },

  // ── Блок "Ваши цели" ──────────────────────────────────────────────────────
  {
    id: "goals",
    kind: "multi",
    layout: "list",
    maxSelect: 3,
    options: [
      { id: "even_tone", emoji: "" },
      { id: "anti_aging", emoji: "" },
      { id: "eye_care", emoji: "" },
      { id: "calm_skin", emoji: "" },
      { id: "hydration", emoji: "" },
      { id: "basic", emoji: "" },
    ],
  },
  {
    id: "special",
    kind: "multi",
    layout: "list",
    exclusiveOptionId: "nothing",
    options: [
      { id: "allergy", emoji: "" },
      { id: "retinoid", emoji: "" },
      { id: "nothing", emoji: "" },
    ],
  },
];
