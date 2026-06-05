import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

/**
 * Auth service — переиспользуемая бизнес-логика register / login.
 *
 * Источник правды для:
 *   - валидации (email-формат, длина пароля),
 *   - bcrypt (hash / verify),
 *   - доступа к БД (prisma.user),
 *   - классификации ошибок (email занят, БД недоступна, прочее).
 *
 * Намеренно НЕ знает про транспорт: ни FormData, ни cookies, ни redirect,
 * ни HTTP-коды. Возвращает дискриминированный результат, который вызывающая
 * сторона маппит сама:
 *   - web Server Action (`app/actions/auth.ts`) → AuthFormState + cookie + redirect,
 *   - (в будущем) REST-роут для mobile → JSON + Bearer-токены.
 *
 * Это файл сервис-слоя (НЕ "use server"), поэтому может экспортировать
 * типы/константы наряду с функциями.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LEN = 8;
const EMAIL_MAX_LEN = 254;

/** Минимум, который нужен вызывающей стороне для сессии. */
export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
}

export type RegisterError =
  | "validation"
  | "email_taken"
  | "db_unavailable"
  | "unknown";

export type LoginError =
  | "validation"
  | "invalid_credentials"
  | "db_unavailable"
  | "unknown";

export type RegisterResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; error: RegisterError };

export type LoginResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; error: LoginError };

/* ───────── helpers (приватные) ───────── */

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value) && value.length <= EMAIL_MAX_LEN;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
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

/* ───────── Register ───────── */

export async function registerUser(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const password = input.password;
  const name = normalizeName(input.name);

  if (!isValidEmail(email) || password.length < PASSWORD_MIN_LEN) {
    return { ok: false, error: "validation" };
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    });
    return {
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
    };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { ok: false, error: "email_taken" };
    }
    if (isPrismaConnectionError(e)) {
      return { ok: false, error: "db_unavailable" };
    }
    console.error("[auth-service/register] unexpected error:", e);
    return { ok: false, error: "unknown" };
  }
}

/* ───────── Login ───────── */

export async function authenticateUser(input: {
  email: string;
  password: string;
}): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (!isValidEmail(email) || password.length === 0) {
    return { ok: false, error: "validation" };
  }

  let user;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch (e) {
    if (isPrismaConnectionError(e)) {
      return { ok: false, error: "db_unavailable" };
    }
    console.error("[auth-service/login] unexpected error:", e);
    return { ok: false, error: "unknown" };
  }

  if (!user) return { ok: false, error: "invalid_credentials" };

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) return { ok: false, error: "invalid_credentials" };

  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
  };
}
