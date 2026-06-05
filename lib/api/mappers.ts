import {
  AvoidedIngredient,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@prisma/client";
import type { BeautyProfile, User } from "@prisma/client";
import type { BeautyProfileInput } from "@/lib/db/repositories/beauty-profile";
import type {
  AvoidedIngredient as AvoidedIngredientLower,
  SensitivityLevel as SensitivityLevelLower,
  SkinConcern as SkinConcernLower,
  SkinType as SkinTypeLower,
  SkincareGoal as SkincareGoalLower,
} from "@/lib/types";

/**
 * DTO-мэппинг для будущего mobile REST API.
 *
 * Три представления одних и тех же данных:
 *   - Prisma `BeautyProfile` / `User` — UPPERCASE enum'ы (`DRY`, `ACNE`, …),
 *   - wire DTO (то, что ест mobile) — lowercase значения (`dry`, `acne`, …),
 *     те же union'ы, что в web `lib/types.ts`.
 *
 * Все значения enum'ов отличаются только регистром (`ESSENTIAL_OILS` ↔
 * `essential_oils`), поэтому конвертация — это `toUpperCase` / `toLowerCase`
 * с валидацией по рантайм-значениям Prisma-enum'ов (невалидные отбрасываются).
 *
 * Модуль чистый (без БД/HTTP) — только трансформации. Ничего существующего
 * не меняет.
 */

/* ───────── DTO-типы (wire-контракт для mobile) ───────── */

export interface MeDTO {
  id: string;
  email: string;
  name: string | null;
  locale: "ru" | "en";
  /** ISO-8601. */
  createdAt: string;
}

/** Совпадает с mobile `SkinProfile`: lowercase значения, nullable поля. */
export interface SkinProfileDTO {
  skinType: SkinTypeLower | null;
  sensitivity: SensitivityLevelLower | null;
  concerns: SkinConcernLower[];
  avoidedList: AvoidedIngredientLower[];
  goal: SkincareGoalLower | null;
  completion: number;
}

/* ───────── enum helpers ───────── */

/** lowercase wire-значение → Prisma UPPERCASE enum, либо null если невалидно. */
function toDbEnum<T extends Record<string, string>>(
  enumObj: T,
  value: string,
): T[keyof T] | null {
  const upper = value.toUpperCase();
  const valid = Object.values(enumObj) as string[];
  return valid.includes(upper) ? (upper as T[keyof T]) : null;
}

/** Массив lowercase → массив валидных Prisma enum'ов (невалидные отброшены). */
function toDbEnumArray<T extends Record<string, string>>(
  enumObj: T,
  values: string[],
): T[keyof T][] {
  const out: T[keyof T][] = [];
  for (const v of values) {
    const mapped = toDbEnum(enumObj, v);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

/** Prisma UPPERCASE enum → lowercase wire-значение (значения валидны by Prisma). */
function toLower<L extends string>(value: string): L {
  return value.toLowerCase() as L;
}

function clampCompletion(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/* ───────── User → MeDTO ───────── */

export function userToMeDTO(user: User): MeDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale === "en" ? "en" : "ru",
    createdAt: user.createdAt.toISOString(),
  };
}

/* ───────── BeautyProfile (DB) → SkinProfileDTO ───────── */

export function dbBeautyProfileToSkinProfile(
  profile: BeautyProfile | null,
): SkinProfileDTO | null {
  if (!profile) return null;
  return {
    skinType: toLower<SkinTypeLower>(profile.skinType),
    sensitivity: toLower<SensitivityLevelLower>(profile.sensitivity),
    concerns: profile.concerns.map((c) => toLower<SkinConcernLower>(c)),
    avoidedList: profile.avoidedList.map((a) =>
      toLower<AvoidedIngredientLower>(a),
    ),
    goal: toLower<SkincareGoalLower>(profile.goal),
    completion: profile.completion,
  };
}

/* ───────── SkinProfileDTO → BeautyProfileInput (DB) ───────── */

/**
 * Возвращает `null`, если профиль нельзя записать в БД — `BeautyProfile`
 * требует non-null `skinType`. Это и есть «минимально валидный» профиль;
 * вызывающая сторона (будущий PUT-роут) маппит null → 422.
 *
 * `sensitivity` и `goal` тоже non-null в БД, но для них есть разумные
 * дефолты (как в web onboarding-wizard): NONE / HYDRATION.
 */
export function skinProfileToDbInput(
  profile: SkinProfileDTO,
): BeautyProfileInput | null {
  const skinType = profile.skinType
    ? toDbEnum(SkinType, profile.skinType)
    : null;
  if (!skinType) return null;

  const sensitivity =
    (profile.sensitivity
      ? toDbEnum(SensitivityLevel, profile.sensitivity)
      : null) ?? SensitivityLevel.NONE;

  const goal =
    (profile.goal ? toDbEnum(SkincareGoal, profile.goal) : null) ??
    SkincareGoal.HYDRATION;

  return {
    skinType,
    sensitivity,
    concerns: toDbEnumArray(SkinConcern, profile.concerns),
    avoidedList: toDbEnumArray(AvoidedIngredient, profile.avoidedList),
    goal,
    completion: clampCompletion(profile.completion),
  };
}
