"use server";

import { Prisma } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { toggleFavorite } from "@/lib/db/repositories/favorite";

/**
 * Toggle favorite. Контракт идентичен demo store'у — клиент уже сделал
 * optimistic update; этот action синхронизирует с БД для user'ов.
 *
 * @param productId — Product.id (cuid).
 */
export async function toggleFavoriteAction(productId: string): Promise<
  | { ok: true; persisted: true; isFavorite: boolean }
  | { ok: true; persisted: false; reason: "guest" | "anonymous" }
  | { ok: false; reason: "db_unavailable" | "validation" }
> {
  if (!productId || typeof productId !== "string") {
    return { ok: false, reason: "validation" };
  }
  const session = await getCurrentSession();
  if (!session) return { ok: true, persisted: false, reason: "anonymous" };
  if (session.type !== "user") {
    return { ok: true, persisted: false, reason: "guest" };
  }
  try {
    const result = await toggleFavorite(session.userId, productId);
    return { ok: true, persisted: true, isFavorite: result.isFavorite };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      // FK к несуществующему product — не ломаем UI.
      return { ok: false, reason: "validation" };
    }
    console.error("[favorites] toggle failed:", e);
    return { ok: false, reason: "db_unavailable" };
  }
}
