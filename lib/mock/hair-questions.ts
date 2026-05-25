import type { OnboardingQuestionDef } from "@/lib/types";

export const HAIR_ONBOARDING_QUESTIONS: OnboardingQuestionDef[] = [
  {
    id: "hairType",
    kind: "single",
    options: [
      { id: "straight", emoji: "〰️" },
      { id: "wavy", emoji: "🌊" },
      { id: "curly", emoji: "🌀" },
      { id: "coily", emoji: "🍥" },
    ],
  },
  {
    id: "scalpType",
    kind: "single",
    options: [
      { id: "normal", emoji: "😊" },
      { id: "dry", emoji: "🏜️" },
      { id: "oily", emoji: "✨" },
      { id: "sensitive", emoji: "🌸" },
    ],
  },
  {
    id: "concerns",
    kind: "multi",
    options: [
      { id: "frizz", emoji: "⚡" },
      { id: "damage", emoji: "💔" },
      { id: "hair_loss", emoji: "🍂" },
      { id: "dandruff", emoji: "❄️" },
      { id: "dullness", emoji: "🌫️" },
      { id: "split_ends", emoji: "✂️" },
    ],
  },
  {
    id: "goal",
    kind: "single",
    options: [
      { id: "hydration", emoji: "💧" },
      { id: "volume", emoji: "🎈" },
      { id: "repair", emoji: "🔧" },
      { id: "growth", emoji: "🌱" },
      { id: "color_protection", emoji: "🎨" },
      { id: "anti_frizz", emoji: "🧘" },
    ],
  },
];
