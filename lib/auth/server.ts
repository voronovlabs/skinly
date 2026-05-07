import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type Session,
} from "./session";

/**
 * Server-only обёртки. Используют `next/headers#cookies()` — нельзя
 * импортировать в middleware (Edge runtime).
 */

/** Получить текущую сессию (server actions / RSC). */
export async function getCurrentSession(): Promise<Session | null> {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifySession(token);
}

/** Установить cookie сессии. */
export async function setSessionCookie(session: Session): Promise<void> {
  const token = await signSession(session);
  const c = await cookies();
  c.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Удалить cookie сессии. */
export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE_NAME);
}
