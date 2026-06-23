import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import { removeFavoriteByBarcode } from "@/lib/db/repositories/favorite";
import { createEvent } from "@/lib/db/repositories/user-product-event";
import {
  apiJson,
  apiPreflight,
  serverError,
  unauthorized,
  validation,
} from "@/lib/api/respond";

/**
 * DELETE /api/v1/favorites/:barcode — убрать из избранного (Bearer).
 *
 * Идемпотентно. При реальном удалении пишет UserProductEvent(unfavorite).
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ barcode: string }> },
) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }

  const { barcode: raw } = await ctx.params;
  const barcode = (raw ?? "").trim();
  if (!barcode) return validation("barcode is required");

  try {
    const res = await removeFavoriteByBarcode(session.userId, barcode);
    if (res.removed) {
      await createEvent({
        userId: session.userId,
        anonymousId: null,
        barcode,
        eventType: "unfavorite",
        weight: -2,
        source: "mobile",
        metadata: null,
      });
    }
    return apiJson({ ok: true, isFavorite: false }, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/favorites/:barcode] DELETE failed:", e);
    return serverError();
  }
}
