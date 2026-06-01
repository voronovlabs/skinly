import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * National-catalog category resolution for the public REST API.
 *
 * Реальная категория товара НЕ лежит в `Product.category` (там всё OTHER) —
 * она хранится в `NationalCatalogRawProduct.payload.categoryPath[1]`
 * (categoryPath[0] = корень «Косметика и парфюмерия»). Связь — по `barcode`.
 *
 * Мы НЕ меняем схему и НЕ пишем миграции: категория вычисляется на лету в SQL
 * через JSON-операторы + CASE-маппинг level-2 крошки в UI-категорию.
 *
 * Маппинг (по ТЗ + алиасы из scraper scope.ts для устойчивости):
 *   Средства и аксессуары для волос          → Волосы
 *   Декоративная и уходовая косметика         → Лицо
 *   Парфюмерия                                → Парфюм
 *   Мыло и средства для мытья                 → Очищение
 *   Косметические и туалетные средства        → Тело
 *   Средства для ухода за полостью рта         → Полость рта
 *   Средства и инструменты для бритья…        → Бритьё и депиляция
 *   Дезодоранты, антиперспиранты              → Дезодоранты
 *   остальное / нет raw-строки                 → Прочее
 */

export const UI_OTHER = "Прочее";

/** UI-категории в порядке для стабильной выдачи (если нужен фиксированный order). */
export const UI_CATEGORIES = [
  "Лицо",
  "Тело",
  "Волосы",
  "Очищение",
  "Парфюм",
  "Дезодоранты",
  "Бритьё и депиляция",
  "Полость рта",
  UI_OTHER,
] as const;

/**
 * Нормализованный (lowercase, ё→е, nbsp→space, схлопнутые пробелы) level-2
 * breadcrumb. Берём `raw.payload.categoryPath[1]`. Алиас `raw` обязан быть
 * в запросе (LEFT JOIN LATERAL).
 */
const NORM_LVL2 =
  "trim(regexp_replace(replace(translate(lower(coalesce((raw.payload->'categoryPath')->>1, '')), 'ё', 'е'), chr(160), ' '), '\\s+', ' ', 'g'))";

/**
 * Пары [нормализованный level-2, UI-категория]. Ключи — уже в нормализованной
 * форме (ё→е, нижний регистр), т.к. сравниваются с NORM_LVL2.
 */
const RAW_TO_UI: ReadonlyArray<readonly [string, string]> = [
  ["средства и аксессуары для волос", "Волосы"],
  ["косметика для волос", "Волосы"],
  ["декоративная и уходовая косметика", "Лицо"],
  ["парфюмерия", "Парфюм"],
  ["мыло и средства для мытья", "Очищение"],
  ["косметические и туалетные средства", "Тело"],
  ["средства для ухода за полостью рта", "Полость рта"],
  ["средства для гигиены полости рта", "Полость рта"],
  ["средства и инструменты для бритья и депиляции", "Бритьё и депиляция"],
  ["дезодоранты, антиперспиранты", "Дезодоранты"],
  ["дезодоранты и антиперспиранты", "Дезодоранты"],
];

/**
 * SQL-выражение CASE, отдающее UI-категорию. Полностью константно (никакого
 * пользовательского ввода) → безопасно вставлять через Prisma.raw.
 */
const CASE_SQL = (() => {
  const whens = RAW_TO_UI.map(
    ([key, ui]) => `WHEN '${key}' THEN '${ui}'`,
  ).join("\n      ");
  return `CASE ${NORM_LVL2}\n      ${whens}\n      ELSE '${UI_OTHER}'\n    END`;
})();

/** Латеральный join, выбирающий самую свежую raw-строку для товара по barcode. */
const RAW_LATERAL = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT r.payload
    FROM "NationalCatalogRawProduct" r
    WHERE r.barcode = p.barcode
    ORDER BY r."scrapedAt" DESC
    LIMIT 1
  ) raw ON true
`;

export interface RawCatalogItem {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  emoji: string | null;
  imageUrl: string | null;
  /** UI-категория (напр. «Волосы», «Лицо», «Прочее»). */
  category: string;
}

export interface ListParams {
  cursor?: string;
  q?: string;
  /** UI-категория (то, что вернул /categories). */
  category?: string;
  limit?: number;
}

export interface ListResult {
  items: RawCatalogItem[];
  nextCursor: string | null;
  total: number | null;
}

const MAX_LIMIT = 50;

interface RawRow {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  emoji: string | null;
  imageUrl: string | null;
  category: string;
  createdAt: Date;
}

/**
 * Постраничный каталог с категорией из raw-payload, keyset-пагинация
 * (createdAt desc, id desc). Поиск по name/brand. Фильтр — по UI-категории.
 */
export async function listNationalCatalog(
  params: ListParams,
): Promise<ListResult> {
  const limit = clamp(params.limit ?? 20, 1, MAX_LIMIT);
  const take = limit + 1;
  const q = params.q?.trim() || null;
  const like = q ? `%${q}%` : null;
  const category = params.category || null;

  let cursorCreatedAt: Date | null = null;
  if (params.cursor) {
    const row = await prisma.product.findUnique({
      where: { id: params.cursor },
      select: { createdAt: true },
    });
    cursorCreatedAt = row?.createdAt ?? null;
  }
  const cursorId = params.cursor ?? null;

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT * FROM (
      SELECT
        p.id, p.barcode, p.brand, p.name, p.emoji,
        p."imageUrl" AS "imageUrl", p."createdAt" AS "createdAt",
        ${Prisma.raw(CASE_SQL)} AS category
      FROM "Product" p
      ${RAW_LATERAL}
      WHERE
        (${like}::text IS NULL OR p.name ILIKE ${like} OR p.brand ILIKE ${like})
        AND (
          ${cursorCreatedAt}::timestamp IS NULL
          OR (p."createdAt", p.id) < (${cursorCreatedAt}::timestamp, ${cursorId}::text)
        )
    ) t
    WHERE (${category}::text IS NULL OR t.category = ${category})
    ORDER BY t."createdAt" DESC, t.id DESC
    LIMIT ${take}
  `);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const items: RawCatalogItem[] = sliced.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    brand: r.brand,
    name: r.name,
    emoji: r.emoji,
    imageUrl: r.imageUrl,
    category: r.category,
  }));
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  let total: number | null = null;
  if (!params.cursor) {
    if (!q && !category) {
      total = await prisma.product.count();
    } else {
      const res = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT ${Prisma.raw(CASE_SQL)} AS category
          FROM "Product" p
          ${RAW_LATERAL}
          WHERE (${like}::text IS NULL OR p.name ILIKE ${like} OR p.brand ILIKE ${like})
        ) t
        WHERE (${category}::text IS NULL OR t.category = ${category})
      `);
      total = Number(res[0]?.count ?? 0);
    }
  }

  return { items, nextCursor, total };
}

/** Категории с количеством (UI-категория → count), отсортировано по убыванию. */
export async function countNationalCategories(): Promise<
  { value: string; count: number }[]
> {
  const res = await prisma.$queryRaw<{ value: string; count: number }[]>(
    Prisma.sql`
      SELECT t.category AS value, COUNT(*)::int AS count FROM (
        SELECT ${Prisma.raw(CASE_SQL)} AS category
        FROM "Product" p
        ${RAW_LATERAL}
      ) t
      GROUP BY t.category
    `,
  );
  return res
    .map((r) => ({ value: r.value, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);
}

/** UI-категория одного товара по barcode (для карточки товара). */
export async function resolveCategoryForBarcode(
  barcode: string,
): Promise<string> {
  const res = await prisma.$queryRaw<{ category: string }[]>(Prisma.sql`
    SELECT ${Prisma.raw(CASE_SQL)} AS category
    FROM (SELECT ${barcode}::text AS barcode) p
    ${RAW_LATERAL}
    LIMIT 1
  `);
  return res[0]?.category ?? UI_OTHER;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}
