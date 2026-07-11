"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, Tag } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";
import type { SkinProfileSummaryLike } from "@/lib/compatibility";

/**
 * SimilarProducts — блок «Похожие товары» под карточкой товара.
 *
 * Клиентский компонент: берёт профиль из serverProfile (user) или demo store
 * (guest), дёргает `GET /api/v1/recommendations?barcode=...&<профиль>` и делит
 * выдачу по recommendationType:
 *   - strong   → «Похожие и подходящие»
 *   - fallback → «Другие альтернативы» (мягко, без слова «Рекомендуем»)
 *
 * Если items пуст — ничего не рендерит. Основную карточку не трогает.
 */

interface RecItem {
  barcode: string;
  brand: string;
  name: string;
  category: string;
  imageUrl: string | null;
  recommendationScore: number;
  compatibilityScore: number | null;
  confidence: "high" | "medium" | "low";
  recommendationType: "strong" | "fallback";
  reasons: string[];
}

interface LooseProfile {
  skinType?: string | null;
  sensitivity?: string | null;
  concerns?: readonly string[];
  avoidedList?: readonly string[];
  goal?: string | null;
}

export interface SimilarProductsProps {
  barcode: string;
  mode: "user" | "guest";
  serverProfile?: SkinProfileSummaryLike | null;
  className?: string;
}

const LIMIT = 10;

/**
 * Client-профилирование блока «Похожие товары» (frontend-этап пайплайна
 * рекомендаций). Включено в dev всегда; в prod — через
 * `localStorage.setItem("skinly:reco-timing", "1")`. Ничего не меняет в
 * поведении, только console.log с разбивкой:
 *   effect→headers (сеть+сервер) → json (парсинг) → render (коммит DOM).
 */
function recoTimingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "development") return true;
  try {
    return window.localStorage.getItem("skinly:reco-timing") === "1";
  } catch {
    return false;
  }
}

export function SimilarProducts({
  barcode,
  mode,
  serverProfile,
  className,
}: SimilarProductsProps) {
  const { state, hydrated } = useDemoStore();
  const [items, setItems] = useState<RecItem[] | null>(null);
  // reco-timing: t0 = старт fetch-effect'а; fetchCount ловит повторные fetch'и
  // (лишние ре-запросы из-за смены deps — сами по себе находка).
  const perfRef = useRef<{ t0: number; tJson: number; fetches: number }>({
    t0: 0,
    tJson: 0,
    fetches: 0,
  });

  const ready = mode === "user" || hydrated;

  useEffect(() => {
    if (!ready || !barcode) return;
    const timing = recoTimingEnabled();
    const t0 = performance.now();
    perfRef.current.t0 = t0;
    perfRef.current.fetches += 1;
    const fetchNo = perfRef.current.fetches;
    let tHeaders = 0;
    const profile: LooseProfile | null =
      mode === "user" ? serverProfile ?? null : state.skinProfile;
    const qs = buildQuery(barcode, profile);
    const ctrl = new AbortController();
    fetch(`/api/v1/recommendations?${qs}`, { signal: ctrl.signal })
      .then((r) => {
        tHeaders = performance.now();
        return r.ok ? r.json() : { items: [] };
      })
      .then((d: { items?: RecItem[] }) => {
        const tJson = performance.now();
        perfRef.current.tJson = tJson;
        if (timing) {
          // eslint-disable-next-line no-console
          console.log(
            `[reco-timing:web] fetch#${fetchNo} barcode=${barcode} ` +
              `headers=${(tHeaders - t0).toFixed(1)}ms ` +
              `json=${(tJson - tHeaders).toFixed(1)}ms ` +
              `items=${d.items?.length ?? 0}`,
          );
        }
        setItems(d.items ?? []);
      })
      .catch(() => setItems([]));
    return () => ctrl.abort();
  }, [ready, barcode, mode, serverProfile, state.skinProfile]);

  // reco-timing: коммит DOM после setItems (закрывает этап «рендер»).
  useEffect(() => {
    if (items == null || !recoTimingEnabled()) return;
    const { t0, tJson } = perfRef.current;
    if (t0 === 0) return;
    // eslint-disable-next-line no-console
    console.log(
      `[reco-timing:web] render=${(performance.now() - tJson).toFixed(1)}ms ` +
        `effect→visible=${(performance.now() - t0).toFixed(1)}ms items=${items.length}`,
    );
  }, [items]);

  if (!items || items.length === 0) return null;

  const strong = items.filter((i) => i.recommendationType === "strong");
  const fallback = items.filter((i) => i.recommendationType === "fallback");

  return (
    <div className={cn("space-y-8", className)}>
      {strong.length > 0 && (
        <RecSection title="Похожие и подходящие" items={strong} />
      )}
      {fallback.length > 0 && (
        <RecSection
          title="Другие альтернативы"
          subtitle="Альтернативы из той же категории"
          items={fallback}
          soft
        />
      )}
    </div>
  );
}

function RecSection({
  title,
  subtitle,
  items,
  soft = false,
}: {
  title: string;
  subtitle?: string;
  items: RecItem[];
  soft?: boolean;
}) {
  return (
    <section>
      <h3 className="text-h3 text-graphite mb-1">{title}</h3>
      {subtitle && (
        <p className="text-caption text-muted-graphite mb-3">{subtitle}</p>
      )}
      <div className="flex gap-4 overflow-x-auto pb-1 no-scrollbar">
        {items.map((it) => (
          <RecCard key={it.barcode} item={it} soft={soft} />
        ))}
      </div>
    </section>
  );
}

function RecCard({ item, soft }: { item: RecItem; soft: boolean }) {
  return (
    <Link
      href={`/product/${item.barcode}`}
      className="block w-[180px] flex-shrink-0"
    >
      <Card padding="none" interactive className="overflow-hidden">
        <div className="flex aspect-square w-full items-center justify-center bg-soft-beige">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="text-3xl" aria-hidden>
              🧴
            </span>
          )}
        </div>
        <div className="space-y-1.5 p-3">
          <p className="text-caption text-muted-graphite truncate">
            {item.brand}
          </p>
          <p className="text-body-sm font-medium text-graphite line-clamp-2 min-h-[2.5em]">
            {item.name}
          </p>
          {item.compatibilityScore != null && (
            <Tag tone={soft ? "neutral" : "success"}>
              {item.compatibilityScore}% совместимость
            </Tag>
          )}
          {item.reasons.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {item.reasons.slice(0, 3).map((r, i) => (
                <Tag key={i} tone="neutral">
                  {r}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function buildQuery(barcode: string, p: LooseProfile | null): string {
  const sp = new URLSearchParams();
  sp.set("barcode", barcode);
  sp.set("limit", String(LIMIT));
  if (p?.skinType) sp.set("skinType", p.skinType);
  if (p?.sensitivity && p.sensitivity !== "none") {
    sp.set("sensitivity", p.sensitivity);
  }
  if (p?.goal) sp.set("goal", p.goal);
  if (p?.concerns && p.concerns.length > 0) {
    sp.set("concerns", p.concerns.join(","));
  }
  if (p?.avoidedList && p.avoidedList.length > 0) {
    sp.set("avoided", p.avoidedList.join(","));
  }
  return sp.toString();
}
