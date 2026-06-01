import { prisma } from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 20;

export interface ProductListItem {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  category: string;
  emoji: string | null;
  /** CDN-ссылка на изображение, если есть (используется mobile-каталогом). */
  imageUrl?: string | null;
  score?: number | null;
  verdict?: string | null;
  inciList?: { inci: string; position: number }[];
}

export interface ProductListPage {
  items: ProductListItem[];
  nextCursor: string | null;
  total: number | null;
}

export interface ListProductsParams {
  cursor?: string;
  q?: string;
  category?: string;
  withIngredients?: boolean;
  limit?: number;
}

export async function listProducts({
  cursor,
  q,
  category,
  withIngredients = false,
  limit = DEFAULT_PAGE_SIZE,
}: ListProductsParams = {}): Promise<ProductListPage> {
  const take = limit + 1;
  const trimmed = q?.trim();

  const categoryFilter = category
    ? { category: category as import("@prisma/client").ProductCategory }
    : {};

  // NOTE: Ingredient search (via JOIN) was removed — it caused full-table
  // scans on 40k+ products × ingredient links, making queries time out in
  // production. Name + brand ILIKE is fast enough without an index for
  // the current dataset size.
  const searchFilter = trimmed
    ? {
        OR: [
          { name: { contains: trimmed, mode: "insensitive" as const } },
          { brand: { contains: trimmed, mode: "insensitive" as const } },
          { barcode: { contains: trimmed, mode: "insensitive" as const } },
        ],
      }
    : {};

  const where = { ...categoryFilter, ...(trimmed ? searchFilter : {}) };

  const ingredientsSelect = withIngredients
    ? {
        ingredients: {
          select: {
            position: true,
            ingredient: { select: { inci: true } },
          },
          orderBy: { position: "asc" as const },
        },
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        barcode: true,
        brand: true,
        name: true,
        category: true,
        emoji: true,
        imageUrl: true,
        ...ingredientsSelect,
      },
    }),
    cursor ? Promise.resolve(null) : prisma.product.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const rawItems = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? rawItems[rawItems.length - 1].id : null;

  const items: ProductListItem[] = rawItems.map((r) => {
    const base: ProductListItem = {
      id: r.id,
      barcode: r.barcode,
      brand: r.brand,
      name: r.name,
      category: r.category ?? "",
      emoji: r.emoji,
      imageUrl: r.imageUrl,
    };
    if (withIngredients && "ingredients" in r) {
      base.inciList = (r.ingredients as unknown as { position: number; ingredient: { inci: string } }[]).map(
        (l) => ({ inci: l.ingredient.inci, position: l.position }),
      );
    }
    return base;
  });

  return { items, nextCursor, total };
}
