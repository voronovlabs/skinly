import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FavoritesContent } from "./favorites-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("favorites");
  return { title: t("metaTitle") };
}

export default function FavoritesPage() {
  return <FavoritesContent />;
}
