import type {
  AvoidedIngredient,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * BeautyProfile repository. 1:1 с User через unique userId.
 * upsert идемпотентен — повторный onboarding перетирает старый профиль.
 */

export interface BeautyProfileInput {
  skinType: SkinType;
  sensitivity: SensitivityLevel;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal;
  /** 0..100 */
  completion: number;
}

export async function getBeautyProfileByUserId(userId: string) {
  return prisma.beautyProfile.findUnique({ where: { userId } });
}

export async function upsertBeautyProfile(
  userId: string,
  input: BeautyProfileInput,
) {
  return prisma.beautyProfile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: { ...input },
  });
}
