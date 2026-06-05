import type { NextRequest } from "next/server";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/lib/auth/tokens";
import { getUserById } from "@/lib/db/repositories/user";
import {
  apiJson,
  apiPreflight,
  serverError,
  unauthorized,
  validation,
} from "@/lib/api/respond";

/**
 * POST /api/v1/auth/refresh — ротация токенов для mobile (Bearer-style).
 *
 * Request:  { refreshToken }
 * Response: { accessToken, refreshToken, expiresIn }
 *
 * Refresh-токен проверяется (`verifyRefreshToken`), пользователь — что он
 * всё ещё существует (`getUserById`); затем выпускается новая пара токенов.
 * Cookies / server actions / middleware не трогает.
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

interface RefreshBody {
  refreshToken?: unknown;
}

export async function POST(req: NextRequest) {
  let body: RefreshBody;
  try {
    body = (await req.json()) as RefreshBody;
  } catch {
    return validation("Invalid JSON body");
  }

  const refreshToken =
    typeof body.refreshToken === "string" ? body.refreshToken : null;
  if (!refreshToken) {
    return unauthorized("Missing refresh token");
  }

  const session = await verifyRefreshToken(refreshToken);
  if (!session || session.type !== "user") {
    return unauthorized("Invalid refresh token");
  }

  try {
    const user = await getUserById(session.userId);
    if (!user) return unauthorized("Invalid refresh token");

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken(session),
      signRefreshToken(session),
    ]);

    return apiJson(
      {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: ACCESS_TOKEN_MAX_AGE_SECONDS,
      },
      { cache: "no-store" },
    );
  } catch (e) {
    console.error("[api/v1/auth/refresh] failed:", e);
    return serverError();
  }
}
