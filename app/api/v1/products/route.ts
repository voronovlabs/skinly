import type { NextRequest } from "next/server";
import {
  listProducts,
  type ProductListItem,
} from "@/lib/db/repositories/product";
import {
  evaluateCompatibility,
  inciToFact,
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products
 *
 * Read-only каталог для mobile-клиента. Переиспользует ровно тот же
 * `listProducts` репозиторий и движок совместимости, что и web-каталог
 * (`app/actions/catalog.ts`), чтобы поведение 1:1 совпадало.
 *
 * Query:
 *   - cursor    — id последнего товара предыдущей страницы (keyset-пагинация)
 *   - q         — поиск по name/brand/inci
 *   - category  — ProductCategory enum (UPPERCASE), напр. "SERUM"
 *   - limit     — размер страницы (1..50, по умолчанию 20)
 *   - forMe=1   — включить скоринг под профиль (см. ниже)
 *
 * Профиль для forMe передаётся плоскими query-параметрами (mobile не хранит
 * сессию на web-бэкенде):
 *   - skinType, sensitivity, goal — строки (lowercase)
 *   - concerns, avoided — CSV-списки
 */
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

export function OPTIONS() {
  return apiPreflight();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const cursor = sp.get("cursor") || undefined;
  const q = sp.get("q") || undefined;
  const category = sp.get("category") || undefined;
  const forMe = sp.get("forMe") === "1" || sp.get("forMe") === "true";

  const limitRaw = Number(sp.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : 20;

  const profile: SkinProfileSummaryLike | null = forMe
    ? {
        skinType: sp.get("skinType") || null,
        sensitivity: sp.get("sensitivity") || null,
        goal: sp.get("goal") || null,
        concerns: csv(sp.get("concerns")),
        avoidedList: csv(sp.get("avoided")),
      }
    : null;

  try {
    const page = await listProducts({
      cursor,
      q,
      category,
      limit,
      withIngredients: !!profile,
    });

    if (!profile) {
      return apiJson(stripInci(page.items, page));
    }

    // Скоринг под профиль — та же логика, что в fetchCatalogPageAction.
    const engineProfile = summaryProfileToEngine(profile);
    const scored: ProductListItem[] = page.items.map((item) => {
      if (!item.inciList?.length) return { ...item, score: null, verdict: null };
      const facts = item.inciList.map((l) => inciToFact(l.inci, l.position));
      const result = evaluateCompatibility(engineProfile, facts);
      return { ...item, score: result.score, verdict: result.verdict };
    });
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return apiJson(stripInci(scored, page), { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/products] list failed:", e);
    return apiError("server_error", "Failed to load products", 500);
  }
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Не отдаём наружу внутренний inciList — клиенту достаточно score/verdict. */
function stripInci(
  items: ProductListItem[],
  page: { nextCursor: string | null; total: number | null },
) {
  return {
    items: items.map(({ inciList: _inciList, ...rest }) => rest),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
