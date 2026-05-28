"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Package, Sparkles, ChevronLeft } from "lucide-react";
import { ScreenContainer } from "@/components/layout";
import { BottomNav } from "@/components/layout/bottom-nav";
import { cn } from "@/lib/cn";
import {
  fetchCatalogPageAction,
  type ProductListItem,
} from "@/app/actions/catalog";
import { useDemoStore } from "@/lib/demo-store";
import { demoProfileToEngine, type SkinProfileSummaryLike } from "@/lib/compatibility";

const EMOJI_FALLBACK = "🧴";

const CATEGORIES = [
  "CLEANSER","TONER","ESSENCE","SERUM","MOISTURIZER",
  "EYE_CREAM","SUNSCREEN","EXFOLIANT","MASK","MIST",
  "OIL","LIP_CARE","TREATMENT","OTHER",
] as const;

type Category = typeof CATEGORIES[number];

interface CatalogContentProps {
  initialItems: ProductListItem[];
  initialCursor: string | null;
  initialTotal: number | null;
  initialQ?: string;
  initialCategory?: string;
  serverProfile?: SkinProfileSummaryLike | null;
}

export function CatalogContent({
  initialItems,
  initialCursor,
  initialTotal,
  initialQ = "",
  initialCategory = "",
  serverProfile = null,
}: CatalogContentProps) {
  const t = useTranslations("catalog");
  const { state: demoState } = useDemoStore();

  const [items, setItems] = useState<ProductListItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [total, setTotal] = useState<number | null>(initialTotal);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [category, setCategory] = useState<Category | "">(
    (initialCategory as Category) || ""
  );
  const [forMe, setForMe] = useState(false);

  // Resolve profile: server (user) > demo store (guest)
  const activeProfile: SkinProfileSummaryLike | null = (() => {
    if (serverProfile) return serverProfile;
    if (demoState.skinProfile) {
      const ep = demoProfileToEngine(demoState.skinProfile);
      return {
        skinType: ep.skinType,
        sensitivity: ep.sensitivity,
        concerns: ep.concerns,
        avoidedList: ep.avoidedList,
        goal: ep.goal,
      };
    }
    return null;
  })();

  const hasProfile = !!activeProfile;
  const router = useRouter();

  const didMount = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 400);
    return () => clearTimeout(timer);
  }, [q]);

  const forMeProfile = forMe && hasProfile ? activeProfile : null;

  // Re-fetch when query, category or forMe changes (skip initial mount)
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCatalogPageAction({ q: debouncedQ, category, forMe: forMeProfile }).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setTotal(page.total);
      setLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, category, forMe]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const page = await fetchCatalogPageAction({ cursor, q: debouncedQ, category, forMe: forMeProfile });
    setItems((prev) => [...prev, ...page.items]);
    setCursor(page.nextCursor);
    loadingRef.current = false;
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, debouncedQ, category, forMe]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // Build back-ref URL preserving active filters
  const buildBackHref = () => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (category) params.set("category", category);
    const qs = params.toString();
    return qs ? `/catalog?${qs}` : "/catalog";
  };

  const isEmpty = !loading && items.length === 0;

  return (
    <>
      <ScreenContainer withBottomNav>
        {/* Header */}
        <header className="sticky top-0 z-10 bg-warm-white/95 backdrop-blur-sm px-6 pt-4 pb-4 border-b border-black/5">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Назад"
              className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige -ml-2 shrink-0"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            </button>
            <h1 className="text-heading-sm text-graphite">{t("title")}</h1>
          </div>
          <div className="flex items-center justify-between mb-3">
            {total !== null && (
              <p className="text-caption text-muted-graphite">
                {t("totalProducts", { count: total.toLocaleString("ru-RU") })}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (!hasProfile) {
                  router.push("/onboarding");
                  return;
                }
                setForMe((v) => !v);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption transition-colors ml-auto",
                forMe && hasProfile
                  ? "bg-lavender-deep text-warm-white"
                  : "bg-soft-beige text-graphite hover:bg-soft-lavender",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              {t("forMe")}
            </button>
          </div>
          {/* Search */}
          <div className="relative mb-3">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-graphite pointer-events-none"
              strokeWidth={2}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className={cn(
                "w-full rounded-xl bg-soft-beige pl-9 pr-4 py-3",
                "text-body-sm text-graphite placeholder:text-muted-graphite",
                "border border-transparent focus:border-lavender-deep/40 focus:outline-none",
                "transition-colors",
              )}
            />
          </div>
          {/* Category chips */}
          <CategoryFilter
            t={t}
            category={category}
            onSelect={(cat) => setCategory(category === cat ? "" : cat)}
            onReset={() => setCategory("")}
          />
        </header>

        {/* Grid */}
        <div className="px-4 pt-4">
          {isEmpty ? (
            <EmptyState
              message={q || category ? t("noResults") : t("empty")}
              hint={q || category ? t("noResultsHint") : undefined}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {items.map((item) => (
                <CatalogCard
                  key={item.id}
                  item={item}
                  backHref={buildBackHref()}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-8" />

          {loading && (
            <div className="flex justify-center py-4">
              <div className="h-5 w-5 rounded-full border-2 border-lavender-deep border-t-transparent animate-spin" />
            </div>
          )}
        </div>
      </ScreenContainer>

      <BottomNav active="dashboard" />
    </>
  );
}

function CategoryFilter({
  t,
  category,
  onSelect,
  onReset,
}: {
  t: ReturnType<typeof useTranslations<"catalog">>;
  category: Category | "";
  onSelect: (cat: Category) => void;
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        className={cn(
          "flex flex-wrap gap-2 overflow-hidden transition-all",
          expanded ? "max-h-none" : "max-h-9",
        )}
      >
        <Chip
          label={t("allCategories")}
          active={category === ""}
          onClick={onReset}
        />
        {CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            label={t(`categories.${cat}`)}
            active={category === cat}
            onClick={() => onSelect(cat)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-caption text-lavender-deep hover:underline"
      >
        {expanded ? t("showLess") : t("showAll")}
      </button>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-caption transition-colors whitespace-nowrap",
        active
          ? "bg-graphite text-warm-white"
          : "bg-soft-beige text-graphite hover:bg-soft-lavender",
      )}
    >
      {label}
    </button>
  );
}

function CatalogCard({ item, backHref }: { item: ProductListItem; backHref: string }) {
  const verdictColor =
    item.verdict === "excellent"
      ? "bg-emerald-100 text-emerald-700"
      : item.verdict === "good"
        ? "bg-green-100 text-green-700"
        : item.verdict === "mixed"
          ? "bg-amber-100 text-amber-700"
          : "bg-red-100 text-red-700";

  return (
    <Link
      href={`/product/${item.barcode}?ref=${encodeURIComponent(backHref)}`}
      className={cn(
        "flex flex-col rounded-xl bg-pure-white p-3 shadow-soft-sm",
        "transition hover:-translate-y-0.5 hover:shadow-soft-md active:scale-[0.98]",
      )}
    >
      <div
        className="relative mb-2 flex h-[100px] w-full items-center justify-center rounded-lg bg-soft-beige text-[36px]"
        aria-hidden
      >
        {item.emoji ?? EMOJI_FALLBACK}
        {item.score != null && (
          <span
            className={cn(
              "absolute top-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
              verdictColor,
            )}
          >
            {item.score}%
          </span>
        )}
      </div>
      <p className="text-caption text-muted-graphite truncate">{item.brand}</p>
      <p className="text-body-sm text-graphite mt-0.5 line-clamp-2 min-h-[2.6em]">
        {item.name}
      </p>
    </Link>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-soft-lavender text-lavender-deep">
        <Package className="h-6 w-6" strokeWidth={2} />
      </div>
      <p className="text-body-sm text-graphite">{message}</p>
      {hint && <p className="text-caption text-muted-graphite mt-1">{hint}</p>}
    </div>
  );
}
