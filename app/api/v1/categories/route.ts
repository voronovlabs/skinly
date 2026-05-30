import { prisma } from "@/lib/prisma";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/categories
 *
 * Список категорий товаров с количеством. `value` — ProductCategory enum
 * (UPPERCASE), который клиент передаёт обратно как `category`-фильтр в
 * /api/v1/products. Локализация лейблов — на стороне клиента.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  try {
    const grouped = await prisma.product.groupBy({
      by: ["category"],
      _count: { _all: true },
    });

    const categories = grouped
      .map((g) => ({ value: g.category as string, count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    return apiJson({ categories });
  } catch (e) {
    console.error("[api/v1/categories] failed:", e);
    return apiError("server_error", "Failed to load categories", 500);
  }
}
