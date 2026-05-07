import type { OnboardingQuestionDef } from "@/lib/types";

/**
 * 5 вопросов профиля кожи. Phase 3: тексты заголовков, подзаголовков и
 * лейблы опций живут в messages/*.json — здесь только id + эмодзи.
 *
 * Соответствие ключей i18n:
 *   onboarding.questions[id].title
 *   onboarding.questions[id].subtitle
 *   onboarding.questions[id].options[optionId]
 */
export const ONBOARDING_QUESTIONS: OnboardingQuestionDef[] = [
  {
    id: "skinType",
    kind: "single",
    options: [
      { id: "dry", emoji: "💧" },
      { id: "oily", emoji: "✨" },
      { id: "combination", emoji: "⚖️" },
      { id: "normal", emoji: "😊" },
    ],
  },
  {
    id: "sensitivity",
    kind: "single",
    options: [
      { id: "none", emoji: "🛡️" },
      { id: "mild", emoji: "🌿" },
      { id: "high", emoji: "💧" },
      { id: "reactive", emoji: "🔥" },
    ],
  },
  {
    id: "concerns",
    kind: "multi",
    options: [
      { id: "acne", emoji: "🔬" },
      { id: "aging", emoji: "✨" },
      { id: "pigmentation", emoji: "🌿" },
      { id: "redness", emoji: "🌸" },
      { id: "pores", emoji: "🔍" },
      { id: "blackheads", emoji: "⚫" },
    ],
  },
  {
    id: "avoided",
    kind: "multi",
    options: [
      { id: "fragrance", emoji: "🌹" },
      { id: "alcohol", emoji: "🧪" },
      { id: "sulfates", emoji: "🫧" },
      { id: "parabens", emoji: "⚗️" },
      { id: "essential_oils", emoji: "🌿" },
    ],
  },
  {
    id: "goal",
    kind: "single",
    options: [
      { id: "clear_skin", emoji: "✨" },
      { id: "anti_aging", emoji: "🕰️" },
      { id: "hydration", emoji: "💧" },
      { id: "even_tone", emoji: "🎨" },
      { id: "minimal_routine", emoji: "🎯" },
    ],
  },
];
