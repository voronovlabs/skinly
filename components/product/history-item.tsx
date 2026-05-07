"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { ScanRecord } from "@/lib/types";

/**
 * HistoryItem — строка из истории сканирований.
 * Phase 3: относительная метка времени строится через ICU plural из i18n.
 */

export interface HistoryItemProps {
  scan: ScanRecord;
  /** Включить нижний разделитель (для списка). */
  divider?: boolean;
  className?: string;
}

export function HistoryItem({ scan, divider = false, className }: HistoryItemProps) {
  const t = useTranslations("history");
  const matchColorClass = matchToneClass(scan.product.matchScore);

  let relativeLabel: string;
  if (scan.bucket === "today") {
    const hours = Math.max(
      1,
      Math.floor((Date.now() - scan.scannedAt.getTime()) / 3_600_000),
    );
    relativeLabel = t("relativeHoursAgo", { hours });
  } else if (scan.bucket === "yesterday") {
    relativeLabel = t("yesterdayLabel");
  } else if (scan.bucket === "week") {
    relativeLabel = t("buckets.week");
  } else {
    relativeLabel = t("buckets.older");
  }

  return (
    <Link
      href={`/product/${scan.product.barcode}`}
      className={cn(
        "flex cursor-pointer items-center gap-4 px-6 py-4 transition",
        "hover:bg-soft-beige/50",
        divider && "border-b border-soft-beige",
        className,
      )}
    >
      <div className="flex h-[60px] w-[60px] flex-shrink-0 items-center justify-center rounded-md bg-soft-beige text-[30px]">
        {scan.product.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-body truncate text-graphite">
          {scan.product.name}
        </div>
        <div className="text-body-sm truncate text-muted-graphite">
          {scan.product.brand} · {relativeLabel}
        </div>
      </div>
      <div className={cn("text-base font-semibold", matchColorClass)}>
        {scan.product.matchScore}%
      </div>
    </Link>
  );
}

function matchToneClass(score: number): string {
  if (score >= 85) return "text-lavender-deep";
  if (score >= 70) return "text-warning-deep";
  return "text-error-deep";
}
