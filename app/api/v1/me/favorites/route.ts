import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import { listFavoriteItemsByUser } from "@/lib/db/repositories/favorite";
import { apiJson, apiPreflight, serverError, unauthorized } from "@/lib/api/respond";

/**
 * GET /api/v1/me/favorites — избранное текущего пользователя (Bearer).
 *
 * Постоянное хранилище (Prisma Favorite) → восстанавливается после
 * переустановки приложения. Гость использует локальный MMKV (не сюда).
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
    const items = await listFavoriteItemsByUser(session.userId);
    return apiJson(items, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/me/favorites] GET failed:", e);
    return serverError();
  }
}
