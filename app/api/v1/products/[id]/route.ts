import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products/:id
 *
 * `:id` — cuid (Product.id) ИЛИ EAN-barcode. Возвращает «глубокий» товар с
 * составом — shape согласован с mobile `ProductDeepDTO` (lowercase category,
 * lowercase safety, локализованные поля по Accept-Language).
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

const include = {
  ingredients: {
    include: { ingredient: true },
    orderBy: { position: "asc" as const },
  },
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const idOrBarcode = (id ?? "").trim();
  if (!idOrBarcode) {
    return apiError("validation", "Missing product id", 400);
  }

  const isEn = (req.headers.get("accept-language") ?? "ru")
    .toLowerCase()
    .startsWith("en");

  try {
    const product =
      (await prisma.product.findUnique({ where: { id: idOrBarcode }, include })) ??
      (await prisma.product.findUnique({
        where: { barcode: idOrBarcode },
        include,
      }));

    if (!product) {
      return apiError("not_found", "Product not found", 404);
    }

    const dto = {
      id: product.id,
      barcode: product.barcode,
      brand: product.brand,
      name: product.name,
      category: (product.category ?? "OTHER").toLowerCase(),
      emoji: product.emoji ?? undefined,
      imageUrl: product.imageUrl ?? undefined,
      description:
        (isEn ? product.descriptionEn : product.descriptionRu) ??
        product.descriptionRu ??
        product.descriptionEn ??
        undefined,
      ingredients: product.ingredients.map((l) => ({
        id: `${product.id}_${l.ingredientId}`,
        inci: l.ingredient.inci,
        displayName: isEn
          ? l.ingredient.displayNameEn
          : l.ingredient.displayNameRu,
        description:
          (isEn ? l.ingredient.descriptionEn : l.ingredient.descriptionRu) ??
          undefined,
        safety: l.ingredient.safety.toLowerCase(),
        position: l.position,
        concentration: l.concentration ? Number(l.concentration) : null,
        flagsAvoided: l.ingredient.flagsAvoided.map((f) => f.toLowerCase()),
        benefitsFor: l.ingredient.benefitsFor.map((b) => b.toLowerCase()),
      })),
    };

    return apiJson(dto);
  } catch (e) {
    console.error("[api/v1/products/:id] lookup failed:", e);
    return apiError("server_error", "Failed to load product", 500);
  }
}
