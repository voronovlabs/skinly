import { SignJWT, jwtVerify } from "jose";
import { SESSION_MAX_AGE_SECONDS, type Session } from "./session";

/**
 * Bearer-токены (access / refresh) для будущего mobile REST API.
 *
 * Подписываются ТЕМ ЖЕ `AUTH_SECRET` и алгоритмом (HS256, jose), что и
 * cookie-сессия в `session.ts`. Поэтому access-токен — это валидный
 * `Session`-JWT (web `verifySession` его примет). Разделение access ↔ refresh
 * идёт через claim `tokenType`, чтобы refresh нельзя было использовать как
 * access и наоборот.
 *
 * Этот модуль НИЧЕГО не меняет в существующем web-auth: `session.ts`,
 * cookies и middleware остаются как есть. Он только добавляет helpers.
 */

const ALG = "HS256";

/** Access — короткий (15 минут). Refresh — как cookie-сессия (30 дней). */
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15;
export const REFRESH_TOKEN_MAX_AGE_SECONDS = SESSION_MAX_AGE_SECONDS;

type TokenType = "access" | "refresh";

/* ───────── Секрет ─────────
 *
 * Зеркало `getSecret()` из `session.ts` — тот же `AUTH_SECRET`, та же логика
 * (`||` не `??`, минимум 16 символов, throw в production, dev-fallback),
 * чтобы Bearer-токены были на ОДНОМ секрете с cookie-сессией. `session.ts`
 * не трогаем (его `getSecret` приватный), поэтому повторяем здесь.
 */

const DEV_FALLBACK_SECRET =
  "dev-only-skinly-secret-change-me-please-32chars-min";

function getSecret(): Uint8Array {
  const fromEnv = process.env.AUTH_SECRET;
  const usable =
    typeof fromEnv === "string" && fromEnv.length >= 16 ? fromEnv : null;

  if (process.env.NODE_ENV === "production" && !usable) {
    throw new Error(
      "[skinly/auth] AUTH_SECRET (>= 16 chars) is required in production",
    );
  }

  return new TextEncoder().encode(usable || DEV_FALLBACK_SECRET);
}

/* ───────── Sign / Verify (приватные) ───────── */

async function signToken(
  session: Session,
  tokenType: TokenType,
  maxAgeSeconds: number,
): Promise<string> {
  return await new SignJWT({ ...session, tokenType })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecret());
}

/** Парсинг payload → Session (та же логика, что в `session.ts#verifySession`). */
function parseSession(payload: Record<string, unknown>): Session | null {
  const t = payload.type;
  if (t === "user") {
    const { userId, email, name } = payload;
    if (typeof userId !== "string" || typeof email !== "string") return null;
    return {
      type: "user",
      userId,
      email,
      name: typeof name === "string" ? name : null,
    };
  }
  if (t === "guest") {
    const { guestId } = payload;
    if (typeof guestId !== "string") return null;
    return { type: "guest", guestId };
  }
  return null;
}

async function verifyToken(
  token: string,
  expectedType: TokenType,
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    if (payload.tokenType !== expectedType) return null;
    return parseSession(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

/* ───────── Public API ───────── */

export function signAccessToken(session: Session): Promise<string> {
  return signToken(session, "access", ACCESS_TOKEN_MAX_AGE_SECONDS);
}

export function signRefreshToken(session: Session): Promise<string> {
  return signToken(session, "refresh", REFRESH_TOKEN_MAX_AGE_SECONDS);
}

export function verifyAccessToken(token: string): Promise<Session | null> {
  return verifyToken(token, "access");
}

export function verifyRefreshToken(token: string): Promise<Session | null> {
  return verifyToken(token, "refresh");
}
