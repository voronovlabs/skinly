import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listProducts } from "@/lib/db/repositories/product";
import { getCurrentUser } from "@/lib/auth";
import { getBeautyProfileByUserId } from "@/lib/db/repositories/beauty-profile";
import type { SkinProfileSummaryLike } from "@/lib/compatibility";
import { CatalogContent } from "./catalog-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("catalog");
  return { title: t("metaTitle") };
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initialQ = typeof sp.q === "string" ? sp.q : "";
  const initialCategory = typeof sp.category === "string" ? sp.category : "";

  let initialItems: Awaited<ReturnType<typeof listProducts>>["items"] = [];
  let initialCursor: string | null = null;
  let initialTotal: number | null = null;

  // Load server profile for "fits me" mode (authenticated users only)
  let serverProfile: SkinProfileSummaryLike | null = null;
  try {
    const user = await getCurrentUser();
    if (user) {
      const p = await getBeautyProfileByUserId(user.id);
      if (p) {
        serverProfile = {
          skinType: p.skinType.toLowerCase(),
          sensitivity: p.sensitivity.toLowerCase(),
          concerns: p.concerns.map((c) => c.toLowerCase()),
          avoidedList: p.avoidedList.map((a) => a.toLowerCase()),
          goal: p.goal.toLowerCase(),
        };
      }
    }
  } catch {
    // guest or DB error — serverProfile stays null
  }

  try {
    const page = await listProducts({ q: initialQ, category: initialCategory });
    initialItems = page.items;
    initialCursor = page.nextCursor;
    initialTotal = page.total;
  } catch (e) {
    console.error("[catalog/page] DB load failed:", e);
  }

  return (
    <CatalogContent
      initialItems={initialItems}
      initialCursor={initialCursor}
      initialTotal={initialTotal}
      initialQ={initialQ}
      initialCategory={initialCategory}
      serverProfile={serverProfile}
    />
  );
}
