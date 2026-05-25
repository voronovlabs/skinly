import type { HairConcern, HairType, HaircareGoal, ScalpType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface HairProfileInput {
  hairType: HairType;
  scalpType: ScalpType;
  concerns: HairConcern[];
  goal: HaircareGoal;
  completion: number;
}

export async function getHairProfileByUserId(userId: string) {
  return prisma.hairProfile.findUnique({ where: { userId } });
}

export async function upsertHairProfile(userId: string, input: HairProfileInput) {
  return prisma.hairProfile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: { ...input },
  });
}
