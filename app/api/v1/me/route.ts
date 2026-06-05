import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import { getUserById } from "@/lib/db/repositories/user";
import { userToMeDTO } from "@/lib/api/mappers";
import {
  apiJson,
  apiPreflight,
  notFound,
  serverError,
  unauthorized,
} from "@/lib/api/respond";

/**
 * GET /api/v1/me — текущий пользователь для mobile (Bearer access-токен).
 *
 * Response: MeDTO
 * Ошибки:   401 (нет/невалиден токен или не user-сессия), 404 (user удалён),
 *           500 (БД).
 *
 * Читает тот же Postgres, что и web. Cookies/server actions не трогает.
 */

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }

  try {
    const user = await getUserById(session.userId);
    if (!user) return notFound("User not found");
    return apiJson(userToMeDTO(user), { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/me] GET failed:", e);
    return serverError();
  }
}
