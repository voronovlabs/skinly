import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui";
import type { Product } from "@/lib/types";
import { LiveMatchBadge } from "./live-match-badge";
import type { SkinProfileSummaryLike } from "@/lib/compatibility";

/**
 * ProductCard — компактная карточка продукта.
 * Используется на Dashboard (горизонтальная карусель) и на /favorites (сетка 2x).
 *
 * Phase 10.1: если переданы `inciList` + `mode`, бейдж совместимости считается
 * на лету через compatibility engine; иначе — fallback на `product.matchScore`
 * (mock-каталог Phase 5 / БД-snapshot из ScanHistory).
 */

export interface ProductCardProps {
  product: Product;
  layout?: "fixed" | "fluid";
  className?: string;
  /** Если передан — бейдж совместимости считается через engine, не из mock. */
  liveScoring?: {
    mode: "user" | "guest";
    inciList: ReadonlyArray<{ inci: string; position?: number }>;
    serverProfile?: SkinProfileSummaryLike | null;
  };
}

export function ProductCard({
  product,
  layout = "fluid",
  className,
  liveScoring,
}: ProductCardProps) {
  const t = useTranslations("product");

  return (
    <Link
      href={`/product/${product.barcode}`}
      className={cn(
        "block rounded-lg bg-pure-white p-3 shadow-soft-sm transition",
        "hover:-translate-y-0.5 hover:shadow-soft-md",
        layout === "fixed" && "w-[160px] flex-shrink-0",
        className,
      )}
    >
      <div
        className="
          mb-3 flex h-[120px] w-full items-center justify-center
          rounded-md bg-soft-beige text-[40px]
        "
        aria-hidden
      >
        {product.emoji}
      </div>
      <div className="text-caption text-muted-graphite mb-1 truncate">
        {product.brand}
      </div>
      <div className="text-body-sm text-graphite mb-2 line-clamp-2 min-h-[2.6em]">
        {product.name}
      </div>
      {liveScoring ? (
        <LiveMatchBadge
          mode={liveScoring.mode}
          inciList={liveScoring.inciList}
          serverProfile={liveScoring.serverProfile}
        />
      ) : (
        product.matchScore > 0 && (
          <Tag tone="success">
            {product.matchScore}% {t("match")}
          </Tag>
        )
      )}
    </Link>
  );
}
