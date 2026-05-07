"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ScreenContainer } from "@/components/layout";
import { ProductCard } from "@/components/product";
import { useDemoStore } from "@/lib/demo-store";
import { findProductById } from "@/lib/mock";

export function FavoritesContent() {
  const t = useTranslations("favorites");
  const { state, hydrated } = useDemoStore();

  const favorites = useMemo(() => {
    return state.favoriteIds
      .map((id) => findProductById(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [state.favoriteIds]);

  return (
    <ScreenContainer withBottomNav padded>
      <header className="py-6">
        <h1 className="text-h1 text-graphite mb-4">{t("title")}</h1>
      </header>

      {hydrated && favorites.length === 0 ? (
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
