import type { UserProfile } from "@/lib/types";

/**
 * Mock-профиль текущего пользователя.
 *
 * Phase 3: лейблы (skin type / sensitivity / concerns / avoided / goal)
 * больше не хранятся здесь — они в messages/*.json под ключами
 *   profile.skinTypes / profile.sensitivities /
 *   profile.concernLabels / profile.avoidedLabels /
 *   onboarding.questions.goal.options
 *
 * Phase 6: будет заменено на Prisma-запрос.
 */
export const MOCK_USER: UserProfile = {
  name: "Александра",
  email: "alexandra@email.com",
  avatarEmoji: "👤",
  plan: "free",
  skinProfile: {
    skinType: "dry",
    sensitivity: "high",
    concerns: ["aging", "redness"],
    avoidedList: ["fragrance", "alcohol"],
    goal: "hydration",
    completion: 75,
  },
  stats: {
    scans: 24,
    products: 18,
    avgMatch: 87,
  },
};
