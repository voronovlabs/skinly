import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCompatTimer } from "@/lib/compatibility/timing";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products/:id
 *
 * `:id` — cuid (Product.id) ИЛИ EAN-barcode. Возвращает «глубокий» товар с
 * составом для mobile-карточки.
 *
 * Изменения относительно предыдущей версии:
 *   - `category` берётся из `Product.category` напрямую (UPPERCASE enum:
 *     CLEANSER / TONER / SERUM / … / OTHER). Раньше тут вычислялась RU UI-
 *     категория из raw-payload (`resolveCategoryForBarcode`) — это давало
 *     рассинхрон с сайтом и каталогом mobile.
 *   - `ingredients[].safety` / `flagsAvoided` / `benefitsFor` приводятся к
 *     lowercase, чтобы совпадать с compatibility-engine'ом и mobile DTO.
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

  // COMPAT_TIMING=1: этап productLoad мобильного пайплайна «подходимости»
  // (карточка сначала грузит товар, потом считает совместимость).
  const timer = createCompatTimer();

  try {
    // Для barcode-URL первый findUnique(id) — гарантированный промах:
    // меряем оба лукапа раздельно.
    const byId = await timer.time("productLoad.byId", () =>
      prisma.product.findUnique({ where: { id: idOrBarcode }, include }),
    );
    const product =
      byId ??
      (await timer.time("productLoad.byBarcode", () =>
        prisma.product.findUnique({ where: { barcode: idOrBarcode }, include }),
      ));

    if (!product) {
      return apiError("not_found", "Product not found", 404);
    }

    // Агрегат рейтинга для карточки (не падаем, если что-то пойдёт не так).
    let avgRating = 0;
    let reviewsCount = 0;
    try {
      const agg = await timer.time("reviewAggregate", () =>
        prisma.productReview.aggregate({
          where: { productId: product.id },
          _avg: { rating: true },
          _count: { _all: true },
        }),
      );
      avgRating = agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0;
      reviewsCount = agg._count._all;
    } catch (e) {
      console.error("[api/v1/products/:id] rating aggregate failed:", e);
    }

    const dto = {
      id: product.id,
      barcode: product.barcode,
      brand: product.brand,
      name: product.name,
      avgRating,
      reviewsCount,
      // UPPERCASE enum значение из БД — тот же формат, что отдаёт
      // /api/v1/products и использует сайт.
      category: product.category,
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

    const res = timer.timeSync("serialization", () => apiJson(dto));
    if (timer.enabled) {
      timer.count("ingredients", dto.ingredients.length);
      timer.count("bytes", JSON.stringify(dto).length);
      timer.note(`id=${idOrBarcode} hit=${byId ? "byId" : "byBarcode"}`);
      timer.flush("products/:id");
    }
    return res;
  } catch (e) {
    console.error("[api/v1/products/:id] lookup failed:", e);
    return apiError("server_error", "Failed to load product", 500);
  }
}
