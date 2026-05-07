"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Input, Tag } from "@/components/ui";
import { ScreenContainer } from "@/components/layout";
import { HistoryItem } from "@/components/product";
import { demoScansToScanRecords, useDemoStore } from "@/lib/demo-store";
import type { HistoryBucket } from "@/lib/types";

/**
 * History — список всех сканов с поиском и фильтрами.
 *
 * Phase 5: данные из demo store (localStorage). Если истории ещё нет —
 * показываем empty state. Фильтр «Избранное» теперь использует реальные
 * favoriteIds, а не эвристику matchScore ≥ 90.
 */

type FilterId = "all" | "favorites" | "good" | "caution";

const FILTERS: ReadonlyArray<FilterId> = [
  "all",
  "favorites",
  "good",
  "caution",
];

const BUCKETS_ORDER: HistoryBucket[] = ["today", "yesterday", "week", "older"];

export default function HistoryPage() {
  const t = useTranslations("history");
  const { state, hydrated } = useDemoStore();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");

  const records = useMemo(
    () => demoScansToScanRecords(state.history),
    [state.history],
  );

  const favoriteIds = state.favoriteIds;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((s) => {
      if (q) {
        const haystack = `${s.product.brand} ${s.product.name}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === "good" && s.product.matchScore < 85) return false;
      if (filter === "caution" && s.product.matchScore >= 85) return false;
      if (filter === "favorites" && !favoriteIds.includes(s.product.id)) {
        return false;
      }
      return true;
    });
  }, [records, query, filter, favoriteIds]);

  const grouped = useMemo(() => {
    const map = new Map<HistoryBucket, typeof filtered>();
    for (const s of filtered) {
      const list = map.get(s.bucket) ?? [];
      list.push(s);
      map.set(s.bucket, list);
    }
    return map;
  }, [filtered]);

  return (
    <ScreenContainer withBottomNav>
      <header className="flex items-center gap-4 px-6 py-6">
        <Link
          href="/dashboard"
          aria-label={t("title")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </Link>
        <h1 className="text-h1 text-graphite">{t("title")}</h1>
      </header>

      <div className="px-6 pb-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="mb-3"
        />
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {FILTERS.map((id) => (
            <Tag
              key={id}
              interactive
              selected={id === filter}
              onClick={() => setFilter(id)}
            >
              {t(`filters.${id}`)}
            </Tag>
          ))}
        </div>
      </div>

      <div>
        {hydrated && filtered.length === 0 && (
          <p className="text-body-sm text-muted-graphite px-6 py-12 text-center">
            {t("empty")}
          </p>
        )}

        {BUCKETS_ORDER.map((bucket) => {
          const items = grouped.get(bucket);
          if (!items || items.length === 0) return null;
          return (
            <section key={bucket}>
              <h2 className="text-caption text-muted-graphite px-6 py-4">
                {t(`buckets.${bucket}`)}
              </h2>
              <ul>
                {items.map((scan, idx) => (
                  <li key={scan.id}>
                    <HistoryItem
                      scan={scan}
                      divider={idx < items.length - 1}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </ScreenContainer>
  );
}
