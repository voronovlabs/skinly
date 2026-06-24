import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import {
  deleteReview,
  getReviewSummary,
  listReviews,
  resolveProductByKey,
  upsertReview,
  type ReviewItem,
} from "@/lib/db/repositories/review";
import { createEvent } from "@/lib/db/repositories/user-product-event";
import {
  apiJson,
  apiPreflight,
  notFound,
  serverError,
  unauthorized,
  validation,
} from "@/lib/api/respond";

/**
 * /api/v1/products/:id/reviews — отзывы и рейтинг товара.
 * `:id` — barcode ИЛИ Product.id (как в /api/v1/products/:id).
 *
 * GET    — публично. summary (+ my*, если Bearer) + список отзывов.
 * POST   — Bearer. upsert моего отзыва (rating 1..5, comment≤1000). Пишет event.
 * DELETE — Bearer. удаляет мой отзыв.
 *
 * Приватность: email авторов не отдаём; имя → «Пользователь Skinly», если пусто.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

const MAX_COMMENT = 1000;
const DEFAULT_AUTHOR = "Пользователь Skinly";

function toReviewDTO(r: ReviewItem) {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    user: { name: r.authorName?.trim() || DEFAULT_AUTHOR },
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const key = (id ?? "").trim();
  if (!key) return validation("Missing product id");

  const session = await getSessionFromAuthorizationHeader(req);
  const userId = session?.type === "user" ? session.userId : null;

  try {
    const product = await resolveProductByKey(key);
    if (!product) return notFound("Product not found");

    const [summary, reviews] = await Promise.all([
      getReviewSummary(product.id, userId),
      listReviews(product.id),
    ]);
    return apiJson(
      { summary, reviews: reviews.map(toReviewDTO) },
      { cache: "no-store" },
    );
  } catch (e) {
    console.error("[api/v1/products/:id/reviews] GET failed:", e);
    return serverError();
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized("Sign in to leave a review");
  }
  const { id } = await ctx.params;
  const key = (id ?? "").trim();
  if (!key) return validation("Missing product id");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validation("Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const rating = b.rating;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return validation("rating must be an integer 1..5");
  }

  let comment: string | null = null;
  if (b.comment != null) {
    if (typeof b.comment !== "string") {
      return validation("comment must be a string");
    }
    const trimmed = b.comment.trim();
    if (trimmed.length > MAX_COMMENT) {
      return validation(`comment must be ≤ ${MAX_COMMENT} chars`);
    }
    comment = trimmed.length > 0 ? trimmed : null;
  }

  try {
    const product = await resolveProductByKey(key);
    if (!product) return notFound("Product not found");

    const review = await upsertReview({
      userId: session.userId,
      productId: product.id,
      barcode: product.barcode,
      rating,
      comment,
    });

    // Поведенческое событие (не блокирует ответ при ошибке).
    try {
      await createEvent({
        userId: session.userId,
        anonymousId: null,
        barcode: product.barcode,
        eventType: "review",
        weight: 2,
        source: "mobile",
        metadata: { rating },
      });
    } catch (e) {
      console.error("[reviews] event write failed:", e);
    }

    const summary = await getReviewSummary(product.id, session.userId);
    return apiJson(
      { summary, review: { id: review.id, rating, comment } },
      { cache: "no-store" },
    );
  } catch (e) {
    console.error("[api/v1/products/:id/reviews] POST failed:", e);
    return serverError();
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }
  const { id } = await ctx.params;
  const key = (id ?? "").trim();
  if (!key) return validation("Missing product id");

  try {
    const product = await resolveProductByKey(key);
    if (!product) return notFound("Product not found");

    await deleteReview(session.userId, product.id);
    const summary = await getReviewSummary(product.id, session.userId);
    return apiJson({ ok: true, summary }, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/products/:id/reviews] DELETE failed:", e);
    return serverError();
  }
}
