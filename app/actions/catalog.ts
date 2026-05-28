"use server";

import {
  listProducts,
  type ProductListItem,
  type ProductListPage,
} from "@/lib/db/repositories/product";
import {
  evaluateCompatibility,
  inciToFact,
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";

export type { ProductListItem };

export async function fetchCatalogPageAction(params: {
  cursor?: string;
  q?: string;
  category?: string;
  forMe?: SkinProfileSummaryLike | null;
}): Promise<ProductListPage> {
  try {
    const withIngredients = !!params.forMe;
    const page = await listProducts({
      cursor: params.cursor,
      q: params.q,
      category: params.category,
      withIngredients,
    });

    if (!params.forMe || !withIngredients) return page;

    const engineProfile = summaryProfileToEngine(params.forMe);

    const scored: ProductListItem[] = page.items.map((item) => {
      if (!item.inciList?.length) return { ...item, score: null, verdict: null };
      const facts = item.inciList.map((l) => inciToFact(l.inci, l.position));
      const result = evaluateCompatibility(engineProfile, facts);
      return { ...item, score: result.score, verdict: result.verdict };
    });

    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return { ...page, items: scored };
  } catch (e) {
    console.error("[catalog] fetchCatalogPageAction failed:", e);
    return { items: [], nextCursor: null, total: null };
  }
}
