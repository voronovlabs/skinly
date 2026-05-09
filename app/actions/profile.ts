"use server";

/**
 * Server actions для BeautyProfile (анкета кожи).
 *
 * Контракт:
 *   - guest или anonymous → no-op, returns { persisted: false }
 *   - user                → upsert в БД, returns { persisted: true }
 *   - DB-ошибка           → returns { persisted: false, reason: "db_unavailable" }
 *
 * Файл "use server" → экспортируем только async-функции (правило Next 15).
 */

import { Prisma } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { upsertBeautyProfile } from "@/lib/db/repositories/beauty-profile";
import type {
  AvoidedIngredient,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@prisma/client";

export interface UpsertProfileInput {
  skinType: SkinType;
  sensitivity: SensitivityLevel;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal;
  completion: number;
}

export type UpsertProfileResult =
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

export async function upsertBeautyProfileAction(
  input: UpsertProfileInput,
): Promise<UpsertProfileResult> {
  // Минимальная валидация: completion 0..100; остальное полагаемся на enum-типы.
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
    await upsertBeautyProfile(session.userId, input);
    return { ok: true, persisted: true };
  } catch (e) {
    if (isDbDownError(e)) return { ok: false, reason: "db_unavailable" };
    console.error("[profile] upsert failed:", e);
    return { ok: false, reason: "db_unavailable" };
  }
}
