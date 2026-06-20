import type { NextRequest } from "next/server";
import type { SkinProfileSummaryLike } from "@/lib/compatibility";
import { getRecommendations } from "@/lib/recommendations/service";
import { apiJson, apiPreflight, serverError } from "@/lib/api/respond";

/**
 * GET /api/v1/recommendations
 *
 * MVP-рекомендации поверх DM-слоя (dm.dm_products + product_ingredient_features
 * + ingredient_properties). Без ML/embeddings.
 *
 * Query:
 *   - barcode    — seed-товар (optional). Если задан и найден → «похожие».
 *                  Иначе → персональная лента по профилю.
 *   - limit      — 1..30 (default 10)
 *   - skinType, sensitivity, goal — строки профиля
 *   - concerns, avoided — CSV
 *
 * НЕ затрагивает /api/v1/products — отдельный handler.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const barcode = sp.get("barcode")?.trim() || null;

  const limitRaw = Number(sp.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  const hasProfile =
    sp.get("skinType") ||
    sp.get("sensitivity") ||
    sp.get("goal") ||
    sp.get("concerns") ||
    sp.get("avoided");

  const profile: SkinProfileSummaryLike | null = hasProfile
    ? {
        skinType: sp.get("skinType") || null,
        sensitivity: sp.get("sensitivity") || null,
        goal: sp.get("goal") || null,
        concerns: csv(sp.get("concerns")),
        avoidedList: csv(sp.get("avoided")),
      }
    : null;

  try {
    const items = await getRecommendations({ barcode, limit, profile });
    // Персонализировано → не кэшируем на edge.
    return apiJson({ items }, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/recommendations] failed:", e);
    return serverError("Failed to build recommendations");
  }
}
