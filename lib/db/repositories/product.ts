import { Prisma, type ProductCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 20;

export interface ProductListItem {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  category: string;
  emoji: string | null;
  imageUrl: string | null;
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

/* ─────────────────────────────────────────────────────────────────────────
 * Cyrillic-safe case folding.
 *
 * БАГ: прод-БД — `postgres:16-alpine` (musl libc), где доступна только локаль
 * `C`/`POSIX`. В ней `ILIKE` (что генерит Prisma `mode:"insensitive"`) делает
 * только ASCII case-fold и некорректно работает с многобайтовым UTF-8 — поэтому
 * кириллические токены («Шампунь», «густоты») не находятся, а «Vichy» находит
 * только из-за ASCII-бренда.
 *
 * ФИКС: не полагаемся на локаль БД. Складываем регистр сами через
 * `lower(translate(col, <КИР_ВЕРХ>, <кир_ниж>))`:
 *   - `lower()` сворачивает ASCII (locale-independent для a–z);
 *   - `translate()` сворачивает кириллицу по явному списку букв.
 * Токен складываем в JS (`toLowerCase()` корректно для RU/EN). Сравнение —
 * `LIKE` (байтовое по уже свёрнутым строкам), не `ILIKE`.
 * ───────────────────────────────────────────────────────────────────────── */

const CYR_UP = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
const CYR_LO = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";

// ВАЖНО: константы translate — это SQL-ЛИТЕРАЛЫ (Prisma.raw), а не bind-параметры.
// Только тогда выражение в WHERE (`lower(translate("name", 'АБВ…', 'абв…'))`)
// побайтово совпадает с expression в GIN/pg_trgm индексе, и планировщик его
// использует. С bind-параметрами ($1,$2) индекс НЕ матчится → seq scan.
// Строки фиксированы и не содержат кавычек — инъекция невозможна.
const TR_FROM = Prisma.raw(`'${CYR_UP}'`);
const TR_TO = Prisma.raw(`'${CYR_LO}'`);

/** lower(translate(expr, 'КИР_ВЕРХ', 'кир_ниж')) — свёртка регистра RU+EN. */
function foldSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lower(translate(${expr}, ${TR_FROM}, ${TR_TO}))`;
}

/**
 * Один токен совпадает в folded brand/name/category. barcode ищется отдельной
 * веткой `"barcode" LIKE %q%` (см. searchProducts) — под неё свой plain-trgm
 * индекс. Так каждое условие соответствует ровно одному expression-индексу.
 */
function tokenCondSql(token: string): Prisma.Sql {
  const pat = `%${token.toLowerCase()}%`;
  return Prisma.sql`(
    ${foldSql(Prisma.sql`"brand"`)} LIKE ${pat}
    OR ${foldSql(Prisma.sql`"name"`)} LIKE ${pat}
    OR ${foldSql(Prisma.sql`"category"::text`)} LIKE ${pat}
  )`;
}

/** Догружает inciList для страницы товаров одним запросом (без N+1). */
async function attachIngredients(items: ProductListItem[]): Promise<void> {
  const ids = items.map((i) => i.id);
  if (ids.length === 0) return;
  const links = await prisma.productIngredient.findMany({
    where: { productId: { in: ids } },
    select: { productId: true, position: true, ingredient: { select: { inci: true } } },
    orderBy: { position: "asc" },
  });
  const byProduct = new Map<string, { inci: string; position: number }[]>();
  for (const l of links) {
    const arr = byProduct.get(l.productId) ?? [];
    arr.push({ inci: l.ingredient.inci, position: l.position });
    byProduct.set(l.productId, arr);
  }
  for (const it of items) it.inciList = byProduct.get(it.id) ?? [];
}

interface RawRow {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  category: string;
  emoji: string | null;
  imageUrl: string | null;
}

/**
 * Поиск (есть `q`) — raw SQL с locale-independent свёрткой регистра.
 *   - токены по пробелам, КАЖДЫЙ должен встретиться в brand/name/barcode/category;
 *   - отдельная ветка: barcode LIKE %q% (полный штрихкод);
 *   - keyset-пагинация по (createdAt desc, id desc).
 */
async function searchProducts(
  trimmed: string,
  params: ListProductsParams,
): Promise<ProductListPage> {
  const { cursor, category, withIngredients = false, limit = DEFAULT_PAGE_SIZE } = params;
  const take = limit + 1;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const allTokens = Prisma.join(tokens.map(tokenCondSql), " AND ");
  const barcodePat = `%${trimmed.toLowerCase()}%`;
  const matchSql = Prisma.sql`((${allTokens}) OR "barcode" LIKE ${barcodePat})`;

  const catSql = category
    ? Prisma.sql`"category" = ${category}::"ProductCategory" AND `
    : Prisma.empty;
  const cursorSql = cursor
    ? Prisma.sql` AND ("createdAt", "id") < (SELECT "createdAt", "id" FROM "Product" WHERE "id" = ${cursor})`
    : Prisma.empty;

  // Только сама выборка (LIMIT take). COUNT(*) НЕ считаем — см. ниже.
  const t0 = Date.now();
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT "id", "barcode", "brand", "name", "category"::text AS category,
           "emoji", "imageUrl"
    FROM "Product"
    WHERE ${catSql}${matchSql}${cursorSql}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${take}
  `);
  const searchQueryMs = Date.now() - t0;

  const hasMore = rows.length > limit;
  const rawItems = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? rawItems[rawItems.length - 1].id : null;

  const items: ProductListItem[] = rawItems.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    brand: r.brand,
    name: r.name,
    category: r.category ?? "",
    emoji: r.emoji,
    imageUrl: r.imageUrl ?? null,
  }));

  let ingredientsMs = 0;
  if (withIngredients) {
    const t1 = Date.now();
    await attachIngredients(items);
    ingredientsMs = Date.now() - t1;
  }

  if (process.env.SEARCH_TIMING === "1") {
    // eslint-disable-next-line no-console
    console.log(
      `[products] q=${JSON.stringify(trimmed)} searchQueryMs=${searchQueryMs} ` +
        `countMs=0(skipped) ingredientsMs=${ingredientsMs} rows=${items.length}`,
    );
  }

  // total для поиска НЕ считаем: COUNT(*) без LIMIT сканирует все trgm-совпадения
  // (тысячи строк) и давал секунды поверх быстрой LIMIT-выборки. Пагинация —
  // по nextCursor (limit+1). total остаётся nullable в контракте (ProductListPage).
  return { items, nextCursor, total: null };
}

export async function listProducts(
  params: ListProductsParams = {},
): Promise<ProductListPage> {
  const trimmed = params.q?.trim();

  // Поиск с запросом → raw SQL (Cyrillic-safe).
  if (trimmed) return searchProducts(trimmed, params);

  // Просмотр без поиска → Prisma (фильтр по категории + keyset).
  const { cursor, category, withIngredients = false, limit = DEFAULT_PAGE_SIZE } = params;
  const take = limit + 1;

  const where = category
    ? { category: category as ProductCategory }
    : {};

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
      imageUrl: r.imageUrl ?? null,
    };
    if (withIngredients && "ingredients" in r) {
      base.inciList = (
        r.ingredients as unknown as {
          position: number;
          ingredient: { inci: string };
        }[]
      ).map((l) => ({ inci: l.ingredient.inci, position: l.position }));
    }
    return base;
  });

  return { items, nextCursor, total };
}
