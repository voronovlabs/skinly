import { countNationalCategories } from "@/lib/api/national-catalog";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/categories
 *
 * Категории считаются из `NationalCatalogRawProduct.payload.categoryPath[1]`
 * (связь по barcode) и маппятся в UI-категории (см. lib/api/national-catalog).
 * `value` — UI-категория, которую клиент передаёт обратно как `category`-фильтр
 * в /api/v1/products.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  try {
    const categories = await countNationalCategories();
    return apiJson({ categories });
  } catch (e) {
    console.error("[api/v1/categories] failed:", e);
    return apiError("server_error", "Failed to load categories", 500);
  }
}
