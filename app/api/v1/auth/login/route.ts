import type { NextRequest } from "next/server";
import { authenticateUser } from "@/lib/services/auth-service";
import { getUserById } from "@/lib/db/repositories/user";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  signAccessToken,
  signRefreshToken,
} from "@/lib/auth/tokens";
import type { Session } from "@/lib/auth";
import { userToMeDTO } from "@/lib/api/mappers";
import {
  apiError,
  apiJson,
  apiPreflight,
  serverError,
  unauthorized,
  validation,
} from "@/lib/api/respond";

/**
 * POST /api/v1/auth/login — вход для mobile (Bearer-style).
 *
 * Request:  { email, password }
 * Response: { user: MeDTO, accessToken, refreshToken, expiresIn }
 *
 * Бизнес-логика — общий `auth-service` (тот же, что у web server action),
 * cookies НЕ ставятся (нативный клиент работает на Bearer-токенах).
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: NextRequest) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return validation("Invalid JSON body");
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  const result = await authenticateUser({ email, password });
  if (!result.ok) {
    switch (result.error) {
      case "validation":
        return validation("Invalid email or password");
      case "invalid_credentials":
        return unauthorized("Invalid email or password");
      case "db_unavailable":
        return apiError("server_error", "Database unavailable", 503);
      default:
        return serverError();
    }
  }

  // MeDTO требует locale/createdAt — тянем полный User.
  const fullUser = await getUserById(result.user.id);
  if (!fullUser) return serverError();

  const session: Session = {
    type: "user",
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
  };

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(session),
    signRefreshToken(session),
  ]);

  return apiJson(
    {
      user: userToMeDTO(fullUser),
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_MAX_AGE_SECONDS,
    },
    { cache: "no-store" },
  );
}
