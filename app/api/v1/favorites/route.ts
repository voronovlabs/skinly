import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import { addFavoriteByBarcode } from "@/lib/db/repositories/favorite";
import { createEvent } from "@/lib/db/repositories/user-product-event";
import {
  apiJson,
  apiPreflight,
  notFound,
  serverError,
  unauthorized,
  validation,
} from "@/lib/api/respond";

/**
 * POST /api/v1/favorites — добавить в избранное (Bearer). Body: { barcode }.
 *
 * Идемпотентно. Пишет UserProductEvent(favorite). Гость сюда не ходит —
 * у него локальный MMKV.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validation("Invalid JSON body");
  }
  const barcode =
    typeof (body as { barcode?: unknown })?.barcode === "string"
      ? (body as { barcode: string }).barcode.trim()
      : "";
  if (!barcode) return validation("barcode is required");

  try {
    const res = await addFavoriteByBarcode(session.userId, barcode);
    if (!res) return notFound("Product not found");

    // Событие пишем только при реальном добавлении (не на повторный POST).
    if (res.created) {
      await createEvent({
        userId: session.userId,
        anonymousId: null,
        barcode,
        eventType: "favorite",
        weight: 3,
        source: "mobile",
        metadata: null,
      });
    }
    return apiJson({ ok: true, isFavorite: true }, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/favorites] POST failed:", e);
    return serverError();
  }
}
