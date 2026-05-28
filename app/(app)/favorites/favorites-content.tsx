"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ScreenContainer } from "@/components/layout";
import { ProductCard } from "@/components/product";
import { useDemoStore } from "@/lib/demo-store";
import { findProductById } from "@/lib/mock";
import { getProductsByIdsAction } from "@/app/actions/catalog";
import type { Product } from "@/lib/types";

/**
 * FavoritesContent — dual-mode.
 *   - mode="user"  → server передал список Product'ов из Favorite × Product join.
 *   - mode="guest" → читает demo store; IDs из mock-каталога резолвятся локально,
 *                    IDs из Postgres (cuid) — через getProductsByIdsAction.
 */

export interface FavoritesContentProps {
  mode: "user" | "guest";
  serverFavorites?: Product[];
}

export function FavoritesContent({
  mode,
  serverFavorites,
}: FavoritesContentProps) {
  const t = useTranslations("favorites");
  const { state, hydrated } = useDemoStore();

  // DB products fetched for guest IDs that aren't in the mock catalog
  const [dbProducts, setDbProducts] = useState<Product[]>([]);
  const [dbLoading, setDbLoading] = useState(false);

  useEffect(() => {
    if (mode !== "guest" || !hydrated) return;
    const unknownIds = state.favoriteIds.filter((id) => !findProductById(id));
    if (!unknownIds.length) {
      setDbProducts([]);
      setDbLoading(false);
      return;
    }
    setDbLoading(true);
    getProductsByIdsAction(unknownIds).then((products) => {
      setDbProducts(products);
      setDbLoading(false);
    });
  }, [mode, hydrated, state.favoriteIds]);

  const favorites = useMemo<Product[]>(() => {
    if (mode === "user") return serverFavorites ?? [];
    const mockOnes = state.favoriteIds
      .map((id) => findProductById(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    return [...mockOnes, ...dbProducts];
  }, [mode, serverFavorites, state.favoriteIds, dbProducts]);

  // Ready = store hydrated AND no pending DB fetch for unknown IDs
  const ready = mode === "user" || (hydrated && !dbLoading);

  return (
    <ScreenContainer withBottomNav padded>
      <header className="py-6">
        <h1 className="text-h1 text-graphite mb-4">{t("title")}</h1>
      </header>

      {ready && favorites.length === 0 ? (
        <p className="text-body-sm text-muted-graphite py-12 text-center">
          {t("empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {favorites.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </ScreenContainer>
  );
}
