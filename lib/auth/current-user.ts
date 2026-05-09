import { getUserById } from "@/lib/db/repositories/user";
import { getCurrentSession } from "./server";
import type { Session } from "./session";

/**
 * Актуальный user из БД, если в куке user-session.
 * Возвращает `null` для гостя, отсутствующей сессии и DB-ошибок.
 *
 * НЕ кидает: при сломанной БД компонент должен мягко деградировать.
 */
export async function getCurrentUser() {
  const session = await getCurrentSession();
  if (!session || session.type !== "user") return null;
  try {
    return await getUserById(session.userId);
  } catch (e) {
    console.error("[auth/current-user] DB lookup failed:", e);
    return null;
  }
}

/** Compact версия: только session или null, не лезет в БД. */
export async function getCurrentSessionStrict(): Promise<Session | null> {
  return getCurrentSession();
}
