import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { listFavoritesByUser } from "@/lib/db/repositories/favorite";
import { dbProductToDisplay } from "@/lib/db/display";
import type { Product } from "@/lib/types";
import { FavoritesContent } from "./favorites-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("favorites");
  return { title: t("metaTitle") };
}

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <FavoritesContent mode="guest" />;
  }

  let favorites: Product[] = [];
  try {
    const rows = await listFavoritesByUser(user.id);
    favorites = rows.map((r) => dbProductToDisplay(r.product));
  } catch (e) {
    console.error("[favorites/page] DB load failed:", e);
    return <FavoritesContent mode="guest" />;
  }

  return <FavoritesContent mode="user" serverFavorites={favorites} />;
}
