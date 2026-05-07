import { SignJWT, jwtVerify } from "jose";

/**
 * Skinly session JWT.
 *
 * Используется в трёх средах:
 *   - server actions (Node runtime)
 *   - middleware (Edge runtime)
 *   - server components (Node runtime)
 *
 * Поэтому здесь не должно быть импортов `next/headers` или Node-only API —
 * только jose (Web Crypto под капотом).
 */

export const SESSION_COOKIE_NAME = "skinly_session";

/** 30 дней. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const ALG = "HS256";

const DEV_FALLBACK_SECRET =
  "dev-only-skinly-secret-change-me-please-32chars-min";

/* ───────── Типы ───────── */

export interface UserSession {
  type: "user";
  userId: string;
  email: string;
  name: string | null;
}

export interface GuestSession {
  type: "guest";
  guestId: string;
}

export type Session = UserSession | GuestSession;

/* ───────── Секрет ─────────
 *
 * ВАЖНО: `||` (а не `??`). Иначе `AUTH_SECRET=""` (пустая строка из .env)
 * считалась бы валидным секретом — Node подписал бы пустой строкой,
 * Edge упал бы в fallback, ключи разъехались, cookie бы не верифицировалась
 * и middleware кидал бы guest обратно на /welcome.
 *
 * Минимальная длина 16 символов — защита от случайного `AUTH_SECRET=x`.
 */

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

/* ───────── Sign / Verify ───────── */

export async function signSession(session: Session): Promise<string> {
  return await new SignJWT({ ...session })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });

    const t = payload.type;
    if (t === "user") {
      const { userId, email, name } = payload as Record<string, unknown>;
      if (typeof userId !== "string" || typeof email !== "string") return null;
      return {
        type: "user",
        userId,
        email,
        name: typeof name === "string" ? name : null,
      };
    }
    if (t === "guest") {
      const { guestId } = payload as Record<string, unknown>;
      if (typeof guestId !== "string") return null;
      return { type: "guest", guestId };
    }
    return null;
  } catch {
    return null;
  }
}

/** Удобная type-guard. */
export function isUserSession(s: Session | null): s is UserSession {
  return !!s && s.type === "user";
}

export function isGuestSession(s: Session | null): s is GuestSession {
  return !!s && s.type === "guest";
}
