"use server";

import {
  listProducts,
  type ProductListItem,
  type ProductListPage,
} from "@/lib/db/repositories/product";
import {
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import { resolveCompatibilityBatch } from "@/lib/compatibility/resolve-compatibility";
import { prisma } from "@/lib/prisma";
import { dbProductToDisplay } from "@/lib/db/display";
import type { Product } from "@/lib/types";

export type { ProductListItem };

/**
 * Fetch full Product objects by IDs (for guest favorites that live in DB).
 */
export async function getProductsByIdsAction(
  ids: string[],
): Promise<Product[]> {
  if (!ids.length) return [];
  try {
    const rows = await prisma.product.findMany({
      where: { id: { in: ids } },
    });
    return rows.map(dbProductToDisplay);
  } catch {
    return [];
  }
}

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

    // Flag-gated DM-путь (batch, без N+1); при выключенном флаге — legacy.
    const resolved = await resolveCompatibilityBatch(
      engineProfile,
      page.items.map((item) => ({
        barcode: item.barcode,
        legacyIngredients: item.inciList ?? [],
      })),
    );
    const scored: ProductListItem[] = page.items.map((item, i) => {
      const r = resolved[i];
      const hasFacts = r.facts.length > 0;
      return {
        ...item,
        score: hasFacts ? r.result.score : null,
        verdict: hasFacts ? r.result.verdict : null,
      };
    });

    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return { ...page, items: scored };
  } catch (e) {
    console.error("[catalog] fetchCatalogPageAction failed:", e);
    return { items: [], nextCursor: null, total: null };
  }
}
