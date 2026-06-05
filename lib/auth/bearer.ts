import { verifyAccessToken } from "./tokens";
import type { Session } from "./session";

/**
 * Bearer-хелперы для будущего mobile REST API.
 *
 * Читают токен из заголовка `Authorization: Bearer <jwt>` и валидируют его
 * как access-токен (`tokens.ts`). Cookie-сессия (web) этим путём не
 * затрагивается — это отдельный механизм для нативного клиента.
 *
 * Типизированы через минимальный `RequestLike`, чтобы работать и со
 * стандартным `Request`/`Headers`, и с `NextRequest` в route-handler'ах,
 * не таща сюда зависимость от `next/server`.
 */

interface HeadersLike {
  get(name: string): string | null;
}

interface RequestLike {
  headers: HeadersLike;
}

/** Достаёт сырой Bearer-токен из заголовка Authorization, либо null. */
export function getBearerTokenFromRequest(req: RequestLike): string | null {
  // Headers.get кейс-независим по спецификации; fallback на случай
  // нестандартного HeadersLike.
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** Достаёт Bearer-токен и верифицирует его как access-токен → Session | null. */
export async function getSessionFromAuthorizationHeader(
  req: RequestLike,
): Promise<Session | null> {
  const token = getBearerTokenFromRequest(req);
  if (!token) return null;
  return verifyAccessToken(token);
}
