"use server";

/**
 * Auth server actions.
 *
 * ВАЖНО: файл помечен `"use server"`, поэтому здесь должны экспортироваться
 * только async-функции. Все типы / initial-state / константы / schema —
 * в соседних модулях:
 *   - `@/lib/auth/forms`   — AuthErrorCode, AuthFormState, INITIAL_AUTH_STATE
 *   - `@/lib/auth/session` — JWT helpers и SESSION_COOKIE_*
 *   - `@/lib/auth/server`  — обёртки над `next/headers#cookies()`
 *   - `@/lib/auth/password`— bcrypt
 */

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  clearSessionCookie,
  getCurrentSession,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import type { AuthFormState } from "@/lib/auth/forms";

/* ───────── Private helpers (НЕ экспортируем) ───────── */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LEN = 8;

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value) && value.length <= 254;
}

function readField(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isPrismaConnectionError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  if (e instanceof Prisma.PrismaClientRustPanicError) return true;
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P1001" || e.code === "P1002" || e.code === "P1017")
  ) {
    return true;
  }
  return false;
}

async function ensureSession(): Promise<void> {
  const existing = await getCurrentSession();
  if (existing) return;
  const guestId = crypto.randomUUID();
  await setSessionCookie({ type: "guest", guestId });
}

/* ───────── Register ───────── */

export async function registerAction(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email").toLowerCase();
  const password = readField(formData, "password");
  const name = readField(formData, "name") || null;

  if (!isValidEmail(email) || password.length < PASSWORD_MIN_LEN) {
    return { error: "validation", email, name: name ?? "" };
  }

  let user;
  try {
    const passwordHash = await hashPassword(password);
    user = await prisma.user.create({
      data: { email, passwordHash, name },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { error: "email_taken", email, name: name ?? "" };
    }
    if (isPrismaConnectionError(e)) {
      return { error: "db_unavailable", email, name: name ?? "" };
    }
    console.error("[auth/register] unexpected error:", e);
    return { error: "unknown", email, name: name ?? "" };
  }

  await setSessionCookie({
    type: "user",
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  // Phase 11: новый user идёт на /dashboard.
  //   - если он пришёл с welcome → onboarding → gate → register, его guest
  //     state переедет в БД через GuestMigrator на (app)/layout;
  //   - если он попал на /register напрямую (без onboarding'а), на /dashboard
  //     увидит CTA "Пройти анкету" и пройдёт её отдельно.
  // Раньше тут был redirect("/onboarding") → новый user'ов гонял через
  // wizard ещё раз поверх уже заполненного гостевого профиля.
  redirect("/dashboard");
}

/* ───────── Login ───────── */

export async function loginAction(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, "email").toLowerCase();
  const password = readField(formData, "password");

  if (!isValidEmail(email) || password.length === 0) {
    return { error: "validation", email };
  }

  let user;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch (e) {
    if (isPrismaConnectionError(e)) {
      return { error: "db_unavailable", email };
    }
    console.error("[auth/login] unexpected error:", e);
    return { error: "unknown", email };
  }

  if (!user) return { error: "invalid_credentials", email };

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "invalid_credentials", email };

  await setSessionCookie({
    type: "user",
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  redirect("/dashboard");
}

/* ───────── Guest / Demo entry points ───────── */

/**
 * Welcome / Auth-страницы: «Продолжить как гость» → demo dashboard.
 * Не требует БД.
 */
export async function loginAsGuestAction(): Promise<void> {
  await ensureSession();
  redirect("/dashboard");
}

/**
 * Welcome: «Начать — бесплатно» в demo-режиме.
 * Создаёт guest session (если её ещё нет) и ведёт через onboarding.
 */
export async function startOnboardingAction(): Promise<void> {
  await ensureSession();
  redirect("/onboarding");
}

/* ───────── Logout ───────── */

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/welcome");
}
