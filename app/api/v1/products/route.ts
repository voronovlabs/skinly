import type { NextRequest } from "next/server";
import { ProductCategory } from "@prisma/client";
import {
  listProducts,
  type ProductListItem,
} from "@/lib/db/repositories/product";
import {
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import { resolveCompatibilityBatch } from "@/lib/compatibility/resolve-compatibility";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products
 *
 * Read-only каталог для mobile-клиента. Единый источник правды с сайтом
 * (`app/(app)/catalog`): тот же `listProducts` из `lib/db/repositories/product`,
 * та же фильтрация по `Product.category` (UPPERCASE enum), та же
 * keyset-пагинация.
 *
 * Раньше использовался отдельный `listNationalCatalog` с UI-категориями
 * на русском («Лицо», «Волосы», …) — это давало рассинхрон с сайтом и
 * ломало фильтрацию в mobile. Теперь категория — строго одна из
 * `ProductCategory` enum'ов (CLEANSER / TONER / SERUM / … / OTHER).
 *
 * Query:
 *   - cursor    — id последнего товара предыдущей страницы (keyset)
 *   - q         — поиск по name/brand/barcode
 *   - category  — UPPERCASE enum (CLEANSER, TONER, …, OTHER). Невалидное
 *                  значение игнорируется, как будто фильтр не задан.
 *   - limit     — размер страницы (1..50, по умолчанию 20)
 *   - forMe=1   — режим «Подходит мне» (см. ниже)
 *
 * Профиль для forMe — плоскими query-параметрами:
 *   skinType, sensitivity, goal (строки), concerns, avoided (CSV).
 *
 * При forMe тянем ингредиенты товаров страницы и сортируем внутри страницы
 * по score (та же логика, что в `fetchCatalogPageAction` сайта).
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

const VALID_CATEGORIES = new Set<string>(Object.values(ProductCategory));
const MAX_LIMIT = 50;

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Убираем `inciList` из ответа — это внутреннее поле репозитория. */
function strip(item: ProductListItem): ProductListItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { inciList: _inciList, ...rest } = item;
  return rest;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const cursor = sp.get("cursor") || undefined;
  const q = sp.get("q") || undefined;

  const categoryRaw = sp.get("category");
  const category =
    categoryRaw && VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : undefined;

  const forMe = sp.get("forMe") === "1" || sp.get("forMe") === "true";

  const limitParam = Number(sp.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), MAX_LIMIT)
      : undefined;

  const profile: SkinProfileSummaryLike | null = forMe
    ? {
        skinType: sp.get("skinType") || null,
        sensitivity: sp.get("sensitivity") || null,
        goal: sp.get("goal") || null,
        concerns: csv(sp.get("concerns")),
        avoidedList: csv(sp.get("avoided")),
      }
    : null;

  const timing = process.env.SEARCH_TIMING === "1";
  const tList = Date.now();

  try {
    const page = await listProducts({
      cursor,
      q,
      category,
      // Ингредиенты нужны только для forMe-скоринга. Для обычного поиска — нет.
      withIngredients: Boolean(profile),
      limit,
    });
    const listMs = Date.now() - tList;

    if (!profile) {
      const tSer = Date.now();
      const body = {
        items: page.items.map(strip),
        nextCursor: page.nextCursor,
        total: page.total,
      };
      const serializeMs = Date.now() - tSer;
      if (timing) {
        // eslint-disable-next-line no-console
        console.log(
          `[products] q=${q ?? "—"} forMe=no listMs=${listMs} ` +
            `compatibilityMs=0(n/a) serializeMs=${serializeMs} items=${body.items.length}`,
        );
      }
      return apiJson(body);
    }

    // Локальный scoring для forMe — та же логика, что и в
    // app/actions/catalog.ts#fetchCatalogPageAction.
    const engineProfile = summaryProfileToEngine(profile);
    // Flag-gated: DM-путь при USE_DM_COMPATIBILITY=true, иначе legacy. Batch —
    // один запрос на страницу (без N+1). DTO ответа не меняется.
    const tCompat = Date.now();
    const resolved = await resolveCompatibilityBatch(
      engineProfile,
      page.items.map((item) => ({
        barcode: item.barcode,
        legacyIngredients: item.inciList ?? [],
      })),
    );
    const compatibilityMs = Date.now() - tCompat;

    const tSer = Date.now();
    const scored: ProductListItem[] = page.items.map((item, i) => {
      const r = resolved[i];
      const hasFacts = r.facts.length > 0;
      return {
        ...strip(item),
        score: hasFacts ? r.result.score : null,
        verdict: hasFacts ? r.result.verdict : null,
      };
    });
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const serializeMs = Date.now() - tSer;

    if (timing) {
      // eslint-disable-next-line no-console
      console.log(
        `[products] q=${q ?? "—"} forMe=yes listMs=${listMs} ` +
          `compatibilityMs=${compatibilityMs} serializeMs=${serializeMs} items=${scored.length}`,
      );
    }

    return apiJson(
      { items: scored, nextCursor: page.nextCursor, total: page.total },
      { cache: "no-store" },
    );
  } catch (e) {
    console.error("[api/v1/products] list failed:", e);
    return apiError("server_error", "Failed to load products", 500);
  }
}
