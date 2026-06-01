import type { NextRequest } from "next/server";
import { ProductCategory } from "@prisma/client";
import { listProducts } from "@/lib/db/repositories/product";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products/search?q=...
 *
 * Тонкая обёртка над `listProducts` — поиск по name/brand/barcode + опц.
 * фильтр по UPPERCASE-категории. Статический сегмент `search` приоритетнее `[id]`.
 *
 * Раньше использовался `listNationalCatalog` (UI-категории на русском) — это
 * приводило к рассинхрону с сайтом и mobile-каталогом. Теперь единый источник —
 * `Product.category` enum.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

const VALID_CATEGORIES = new Set<string>(Object.values(ProductCategory));

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const cursor = sp.get("cursor") || undefined;
  const categoryRaw = sp.get("category");
  const category =
    categoryRaw && VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : undefined;

  if (!q) {
    return apiJson({ items: [], nextCursor: null, total: 0 });
  }

  try {
    const page = await listProducts({ q, cursor, category });
    return apiJson({
      items: page.items.map((i) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { inciList: _inciList, ...rest } = i;
        return rest;
      }),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  } catch (e) {
    console.error("[api/v1/products/search] failed:", e);
    return apiError("server_error", "Search failed", 500);
  }
}
