import type { NextRequest } from "next/server";
import { listNationalCatalog } from "@/lib/api/national-catalog";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products/search?q=...
 *
 * Тонкая обёртка над listNationalCatalog — поиск по name/brand, с категорией
 * из raw-payload. Статический сегмент `search` приоритетнее `[id]`.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const cursor = sp.get("cursor") || undefined;
  const category = sp.get("category") || undefined;

  if (!q) {
    return apiJson({ items: [], nextCursor: null, total: 0 });
  }

  try {
    const page = await listNationalCatalog({ q, cursor, category });
    return apiJson(page);
  } catch (e) {
    console.error("[api/v1/products/search] failed:", e);
    return apiError("server_error", "Search failed", 500);
  }
}
