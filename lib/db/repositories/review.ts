import { prisma } from "@/lib/prisma";

/**
 * ProductReview repository.
 * Один отзыв на (userId, productId); повторная отправка обновляет (upsert).
 * `barcode` денормализован для удобства; ключ продукта резолвится по barcode|id.
 */

export interface ReviewSummary {
  avgRating: number; // 0 если нет отзывов; округление до 0.1
  reviewsCount: number;
  myRating: number | null;
  myComment: string | null;
}

export interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  /** Имя автора (без email). null → UI покажет «Пользователь Skinly». */
  authorName: string | null;
}

/** Резолв товара по штрихкоду, затем по id. */
export async function resolveProductByKey(
  key: string,
): Promise<{ id: string; barcode: string } | null> {
  const byBarcode = await prisma.product.findUnique({
    where: { barcode: key },
    select: { id: true, barcode: true },
  });
  if (byBarcode) return byBarcode;
  return prisma.product.findUnique({
    where: { id: key },
    select: { id: true, barcode: true },
  });
}

export async function getReviewSummary(
  productId: string,
  userId: string | null,
): Promise<ReviewSummary> {
  const agg = await prisma.productReview.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { _all: true },
  });

  let myRating: number | null = null;
  let myComment: string | null = null;
  if (userId) {
    const mine = await prisma.productReview.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { rating: true, comment: true },
    });
    if (mine) {
      myRating = mine.rating;
      myComment = mine.comment;
    }
  }

  const avg = agg._avg.rating;
  return {
    avgRating: avg ? Math.round(avg * 10) / 10 : 0,
    reviewsCount: agg._count._all,
    myRating,
    myComment,
  };
}

export async function listReviews(
  productId: string,
  limit = 50,
): Promise<ReviewItem[]> {
  const rows = await prisma.productReview.findMany({
    where: { productId },
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  type Row = {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    user: { name: string | null };
  };
  return (rows as Row[]).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    authorName: r.user.name,
  }));
}

export async function upsertReview(params: {
  userId: string;
  productId: string;
  barcode: string;
  rating: number;
  comment: string | null;
}): Promise<{ id: string }> {
  return prisma.productReview.upsert({
    where: {
      userId_productId: {
        userId: params.userId,
        productId: params.productId,
      },
    },
    create: {
      userId: params.userId,
      productId: params.productId,
      barcode: params.barcode,
      rating: params.rating,
      comment: params.comment,
    },
    update: { rating: params.rating, comment: params.comment },
    select: { id: true },
  });
}

export async function deleteReview(
  userId: string,
  productId: string,
): Promise<{ removed: boolean }> {
  const res = await prisma.productReview.deleteMany({
    where: { userId, productId },
  });
  return { removed: res.count > 0 };
}
