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

/* ───────── Barcode-based (mobile API, persistent для logged-in) ───────── */

/** Список избранного user'а в виде «лёгких» товаров (для GET /me/favorites). */
export async function listFavoriteItemsByUser(userId: string): Promise<
  {
    id: string;
    barcode: string;
    brand: string;
    name: string;
    category: string;
    emoji: string | null;
    imageUrl: string | null;
  }[]
> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    include: {
      product: {
        select: {
          id: true,
          barcode: true,
          brand: true,
          name: true,
          category: true,
          emoji: true,
          imageUrl: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.product.id,
    barcode: r.product.barcode,
    brand: r.product.brand,
    name: r.product.name,
    category: r.product.category,
    emoji: r.product.emoji,
    imageUrl: r.product.imageUrl,
  }));
}

/**
 * Добавить в избранное по штрихкоду. Идемпотентно.
 * Возвращает null, если товара с таким barcode нет в каталоге.
 */
export async function addFavoriteByBarcode(
  userId: string,
  barcode: string,
): Promise<{ created: boolean } | null> {
  const product = await prisma.product.findUnique({
    where: { barcode },
    select: { id: true },
  });
  if (!product) return null;

  const existing = await prisma.favorite.findUnique({
    where: { userId_productId: { userId, productId: product.id } },
    select: { id: true },
  });
  if (existing) return { created: false };

  await prisma.favorite.create({ data: { userId, productId: product.id } });
  return { created: true };
}

/** Удалить из избранного по штрихкоду. Идемпотентно. */
export async function removeFavoriteByBarcode(
  userId: string,
  barcode: string,
): Promise<{ removed: boolean }> {
  const product = await prisma.product.findUnique({
    where: { barcode },
    select: { id: true },
  });
  if (!product) return { removed: false };

  const res = await prisma.favorite.deleteMany({
    where: { userId, productId: product.id },
  });
  return { removed: res.count > 0 };
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
