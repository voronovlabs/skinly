"use server";

import { Prisma } from "@prisma/client";
import type { HairConcern, HairType, HaircareGoal, ScalpType } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { upsertHairProfile } from "@/lib/db/repositories/hair-profile";

export interface UpsertHairProfileInput {
  hairType: HairType;
  scalpType: ScalpType;
  concerns: HairConcern[];
  goal: HaircareGoal;
  completion: number;
}

export type UpsertHairProfileResult =
  | { ok: true; persisted: true }
  | { ok: true; persisted: false; reason: "guest" | "anonymous" }
  | { ok: false; reason: "db_unavailable" | "validation" };

function isDbDownError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  if (e instanceof Prisma.PrismaClientRustPanicError) return true;
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    ["P1001", "P1002", "P1017"].includes(e.code)
  ) {
    return true;
  }
  return false;
}

export async function upsertHairProfileAction(
  input: UpsertHairProfileInput,
): Promise<UpsertHairProfileResult> {
  if (
    typeof input.completion !== "number" ||
    input.completion < 0 ||
    input.completion > 100
  ) {
    return { ok: false, reason: "validation" };
  }

  const session = await getCurrentSession();
  if (!session) return { ok: true, persisted: false, reason: "anonymous" };
  if (session.type !== "user") {
    return { ok: true, persisted: false, reason: "guest" };
  }

  try {
    await upsertHairProfile(session.userId, input);
    return { ok: true, persisted: true };
  } catch (e) {
    if (isDbDownError(e)) return { ok: false, reason: "db_unavailable" };
    console.error("[hair-profile] upsert failed:", e);
    return { ok: false, reason: "db_unavailable" };
  }
}
