import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  evaluateCompatibility,
  inciToFact,
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import {
  listNationalCatalog,
  type RawCatalogItem,
} from "@/lib/api/national-catalog";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products
 *
 * Read-only каталог для mobile-клиента. Категория берётся НЕ из
 * `Product.category` (там всё OTHER), а из
 * `NationalCatalogRawProduct.payload.categoryPath[1]` по barcode и маппится
 * в UI-категорию (см. lib/api/national-catalog). Схема/миграции не трогаются.
 *
 * Query:
 *   - cursor    — id последнего товара предыдущей страницы (keyset)
 *   - q         — поиск по name/brand
 *   - category  — UI-категория (как из /api/v1/categories), напр. "Волосы"
 *   - limit     — размер страницы (1..50, по умолчанию 20)
 *   - forMe=1   — скоринг под профиль (см. ниже)
 *
 * Профиль для forMe — плоскими query-параметрами:
 *   skinType, sensitivity, goal (строки), concerns, avoided (CSV).
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

interface ScoredItem extends RawCatalogItem {
  score?: number | null;
  verdict?: string | null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const cursor = sp.get("cursor") || undefined;
  const q = sp.get("q") || undefined;
  const category = sp.get("category") || undefined;
  const forMe = sp.get("forMe") === "1" || sp.get("forMe") === "true";
  const limit = Number(sp.get("limit")) || undefined;

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
    const page = await listNationalCatalog({ cursor, q, category, limit });

    if (!profile) {
      return apiJson(page);
    }

    // Скоринг под профиль — та же логика, что в web fetchCatalogPageAction:
    // тянем состав для товаров страницы и сортируем внутри страницы по score.
    const ids = page.items.map((i) => i.id);
    const links = ids.length
      ? await prisma.productIngredient.findMany({
          where: { productId: { in: ids } },
          select: {
            productId: true,
            position: true,
            ingredient: { select: { inci: true } },
          },
          orderBy: { position: "asc" },
        })
      : [];

    const byProduct = new Map<string, { inci: string; position: number }[]>();
    for (const l of links) {
      const arr = byProduct.get(l.productId) ?? [];
      arr.push({ inci: l.ingredient.inci, position: l.position });
      byProduct.set(l.productId, arr);
    }

    const engineProfile = summaryProfileToEngine(profile);
    const scored: ScoredItem[] = page.items.map((item) => {
      const inci = byProduct.get(item.id);
      if (!inci?.length) return { ...item, score: null, verdict: null };
      const facts = inci.map((l) => inciToFact(l.inci, l.position));
      const result = evaluateCompatibility(engineProfile, facts);
      return { ...item, score: result.score, verdict: result.verdict };
    });
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return apiJson(
      { items: scored, nextCursor: page.nextCursor, total: page.total },
      { cache: "no-store" },
    );
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
