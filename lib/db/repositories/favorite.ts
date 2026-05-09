import { prisma } from "@/lib/prisma";

/**
 * Favorite repository.
 * Уникальный ключ (userId, productId) — toggle идемпотентен.
 */

export async function listFavoritesByUser(userId: string) {
  return prisma.favorite.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function listFavoriteProductIdsByUser(
  userId: string,
): Promise<string[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}

export async function isFavorite(
  userId: string,
  productId: string,
): Promise<boolean> {
  const row = await prisma.favorite.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  return Boolean(row);
}

/** Возвращает результат toggle: новое состояние избранности. */
export async function toggleFavorite(
  userId: string,
  productId: string,
): Promise<{ isFavorite: boolean }> {
  const existing = await prisma.favorite.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return { isFavorite: false };
  }
  await prisma.favorite.create({ data: { userId, productId } });
  return { isFavorite: true };
}
