import type { NextRequest } from "next/server";
import { registerUser } from "@/lib/services/auth-service";
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
  conflict,
  serverError,
  validation,
} from "@/lib/api/respond";

/**
 * POST /api/v1/auth/register — регистрация для mobile (Bearer-style).
 *
 * Request:  { email, password, name? }
 * Response: { user: MeDTO, accessToken, refreshToken, expiresIn }
 *
 * Бизнес-логика — общий `auth-service` (тот же, что у web server action),
 * cookies НЕ ставятся (нативный клиент работает на Bearer-токенах).
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

interface RegisterBody {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

export async function POST(req: NextRequest) {
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return validation("Invalid JSON body");
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name : null;

  const result = await registerUser({ email, password, name });
  if (!result.ok) {
    switch (result.error) {
      case "validation":
        return validation("Invalid email or password");
      case "email_taken":
        return conflict("Email already registered");
      case "db_unavailable":
        return apiError("server_error", "Database unavailable", 503);
      default:
        return serverError();
    }
  }

  // MeDTO требует locale/createdAt — тянем полный User (только что создан).
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
