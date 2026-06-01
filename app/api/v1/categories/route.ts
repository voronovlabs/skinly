import { ProductCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/categories
 *
 * Возвращает 14 категорий `ProductCategory` в каноническом порядке (тот же
 * массив, что в `app/(app)/catalog/catalog-content.tsx#CATEGORIES`) + count
 * по каждой через `prisma.product.groupBy`.
 *
 * Лейблы на стороне клиента — берутся из `messages/ru.json#catalog.categories`.
 * Backend отдаёт только UPPERCASE-значение enum'а — это и фильтр, и ключ
 * лейбла одновременно.
 *
 * Раньше использовался `countNationalCategories` (UI-категории на русском из
 * raw-payload). Это не совпадало с тем, как сайт фильтрует каталог, и
 * приводило к пустому результату при выборе чипа в mobile.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

/** Канонический порядок — 1:1 с сайтом (`catalog-content.tsx#CATEGORIES`). */
const CATEGORY_ORDER: readonly ProductCategory[] = [
  "CLEANSER",
  "TONER",
  "ESSENCE",
  "SERUM",
  "MOISTURIZER",
  "EYE_CREAM",
  "SUNSCREEN",
  "EXFOLIANT",
  "MASK",
  "MIST",
  "OIL",
  "LIP_CARE",
  "TREATMENT",
  "OTHER",
] as const;

interface CategoryCount {
  value: ProductCategory;
  count: number;
}

export async function GET() {
  try {
    const rows = await prisma.product.groupBy({
      by: ["category"],
      _count: { _all: true },
    });

    const counts = new Map<ProductCategory, number>(
      rows.map((r) => [r.category, r._count._all]),
    );

    const categories: CategoryCount[] = CATEGORY_ORDER.map((value) => ({
      value,
      count: counts.get(value) ?? 0,
    }));

    return apiJson({ categories });
  } catch (e) {
    console.error("[api/v1/categories] failed:", e);
    return apiError("server_error", "Failed to load categories", 500);
  }
}
