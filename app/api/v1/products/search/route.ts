import type { NextRequest } from "next/server";
import { listProducts } from "@/lib/db/repositories/product";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products/search?q=...
 *
 * Тонкая обёртка над списком — поиск по name/brand/inci. Возвращает тот же
 * page-shape, что и /api/v1/products. Статический сегмент `search` имеет
 * приоритет над динамическим `[id]`, поэтому конфликта нет.
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
    const page = await listProducts({ q, cursor, category });
    return apiJson(page);
  } catch (e) {
    console.error("[api/v1/products/search] failed:", e);
    return apiError("server_error", "Search failed", 500);
  }
}
