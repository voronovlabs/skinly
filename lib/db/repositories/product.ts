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
 * LIKE-паттерн `'%token%'` как SQL-ЛИТЕРАЛ (а не bind-параметр).
 *
 * КРИТИЧНО для производительности: pg_trgm оценивает селективность LIKE только
 * по ЛИТЕРАЛЬНОМУ паттерну. С bind-параметром ($1) оценка недоступна на этапе
 * планирования → планировщик выбирает Seq Scan вместо Bitmap Index Scan.
 *
 * Экранирование (защита от инъекции и от LIKE-метасимволов в пользовательском
 * вводе): backslash → %_ → одинарная кавычка. ESCAPE по умолчанию '\'.
 */
function likePatternLiteral(raw: string): Prisma.Sql {
  const escaped = raw
    .toLowerCase()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/'/g, "''");
  return Prisma.raw(`'%${escaped}%'`);
}

/**
 * Один токен совпадает в folded brand/name/category. barcode ищется отдельной
 * веткой `"barcode" LIKE '%q%'` (см. searchProducts). Паттерны — литералы,
 * чтобы pg_trgm выбрал Bitmap Index Scan по product_*_folded_trgm.
 */
function tokenCondSql(token: string): Prisma.Sql {
  const pat = likePatternLiteral(token);
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
  // Курсор поиска — числовой OFFSET (а не keyset по id). Старый id-курсор с
  // прошлых деплоев → NaN → 0 (мягкая деградация).
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const allTokens = Prisma.join(tokens.map(tokenCondSql), " AND ");
  const matchSql = Prisma.sql`((${allTokens}) OR "barcode" LIKE ${likePatternLiteral(trimmed)})`;

  const catSql = category
    ? Prisma.sql`"category" = ${category}::"ProductCategory" AND `
    : Prisma.empty;

  // БЕЗ ORDER BY и БЕЗ CTE.
  //   - ORDER BY "createdAt" заставлял собрать ВСЕ совпадения (тысячи) +
  //     lossy-recheck + Sort → 2.2s. Для поиска порядок по дате не нужен.
  //   - MATERIALIZED-CTE с LIMIT 500 ломал план → Seq Scan (планировщик решал,
  //     что найти 500 совпадений seq-scan'ом дешевле).
  // Теперь: чистый `WHERE <match> LIMIT take OFFSET` с ЛИТЕРАЛЬНЫМИ паттернами
  // → pg_trgm оценивает селективность → Bitmap Index Scan, который
  // останавливается рано по LIMIT. Порядок — bitmap (релевантность heap),
  // пагинация — OFFSET. total и так null.
  const t0 = Date.now();
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT "id", "barcode", "brand", "name", "category"::text AS category,
           "emoji", "imageUrl"
    FROM "Product"
    WHERE ${catSql}${matchSql}
    LIMIT ${take} OFFSET ${offset}
  `);
  const searchQueryMs = Date.now() - t0;

  const hasMore = rows.length > limit;
  const rawItems = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? String(offset + limit) : null;

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
