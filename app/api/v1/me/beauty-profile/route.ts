import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import {
  getBeautyProfileByUserId,
  upsertBeautyProfile,
} from "@/lib/db/repositories/beauty-profile";
import {
  dbBeautyProfileToSkinProfile,
  skinProfileToDbInput,
  type SkinProfileDTO,
} from "@/lib/api/mappers";
import {
  apiJson,
  apiPreflight,
  serverError,
  unauthorized,
  validation,
} from "@/lib/api/respond";

/**
 * /api/v1/me/beauty-profile — анкета кожи для mobile (Bearer access-токен).
 *
 * GET  → SkinProfile | null   (lowercase DTO; null если анкета не заполнена)
 * PUT  → SkinProfile          (тело — lowercase DTO; апсёрт в тот же Postgres)
 *
 * Ошибки: 401 (нет/невалиден токен), 422 (битый JSON / нет skinType), 500 (БД).
 * Enum-конвертация lowercase ↔ Prisma UPPERCASE — через `lib/api/mappers`.
 * Cookies/server actions не трогает.
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }

  try {
    const profile = await getBeautyProfileByUserId(session.userId);
    return apiJson(dbBeautyProfileToSkinProfile(profile), {
      cache: "no-store",
    });
  } catch (e) {
    console.error("[api/v1/me/beauty-profile] GET failed:", e);
    return serverError();
  }
}

/** Безопасно приводит произвольное тело к SkinProfileDTO (валидация значений — в маппере). */
function coerceSkinProfile(body: unknown): SkinProfileDTO {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    skinType: str(b.skinType),
    sensitivity: str(b.sensitivity),
    concerns: strArr(b.concerns),
    avoidedList: strArr(b.avoidedList),
    goal: str(b.goal),
    completion: typeof b.completion === "number" ? b.completion : 0,
  } as SkinProfileDTO;
}

export async function PUT(req: NextRequest) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validation("Invalid JSON body");
  }

  // skinProfileToDbInput валидирует enum-значения и возвращает null,
  // если нет минимально необходимого skinType.
  const dbInput = skinProfileToDbInput(coerceSkinProfile(body));
  if (!dbInput) {
    return validation("skinType is required");
  }

  try {
    const saved = await upsertBeautyProfile(session.userId, dbInput);
    return apiJson(dbBeautyProfileToSkinProfile(saved), { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/me/beauty-profile] PUT failed:", e);
    return serverError();
  }
}
