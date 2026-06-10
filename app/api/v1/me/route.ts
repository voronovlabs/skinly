import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import { deleteUserById, getUserById } from "@/lib/db/repositories/user";
import { userToMeDTO } from "@/lib/api/mappers";
import {
  apiJson,
  apiPreflight,
  notFound,
  serverError,
  unauthorized,
} from "@/lib/api/respond";

/**
 * /api/v1/me — текущий пользователь для mobile (Bearer access-токен).
 *
 * GET    → MeDTO            (текущий пользователь)
 * DELETE → { ok: true }     (удаление аккаунта, App Store Guideline 5.1.1)
 *
 * Ошибки:   401 (нет/невалиден токен или не user-сессия), 404 (user удалён —
 *           только GET), 500 (БД).
 *
 * Читает/пишет тот же Postgres, что и web. Cookies/server actions не трогает.
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

/**
 * DELETE /api/v1/me — удаление аккаунта текущего пользователя.
 *
 * Auth: `Authorization: Bearer <accessToken>` (user-сессия).
 * Каскад БД удаляет BeautyProfile / HairProfile / Favorite / ScanHistory.
 *
 * Идемпотентно: если пользователя уже нет — всё равно `{ ok: true }` (safest
 * для mobile flow: клиент после ответа чистит локальную сессию и уходит на
 * welcome; повторный DELETE не должен ломать этот сценарий).
 */
export async function DELETE(req: NextRequest) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }

  try {
    await deleteUserById(session.userId);
    return apiJson({ ok: true }, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/me] DELETE failed:", e);
    return serverError();
  }
}
