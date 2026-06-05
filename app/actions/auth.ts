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
import {
  clearSessionCookie,
  getCurrentSession,
  setSessionCookie,
} from "@/lib/auth";
import { authenticateUser, registerUser } from "@/lib/services/auth-service";
import type { AuthFormState } from "@/lib/auth/forms";

/* ───────── Private helpers (НЕ экспортируем) ───────── */

function readField(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
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

  const result = await registerUser({ email, password, name });
  if (!result.ok) {
    return { error: result.error, email, name: name ?? "" };
  }
  const user = result.user;

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

  const result = await authenticateUser({ email, password });
  if (!result.ok) {
    return { error: result.error, email };
  }
  const user = result.user;

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
