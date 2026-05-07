import Link from "next/link";
import { useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * ScanCard — крупная CTA-карточка на дашборде ведёт в /scan.
 * Соответствует `.scan-card` из прототипа (gradient lavender → peach).
 *
 * Phase 3: тексты — из messages/*.json (`scanCard.*`).
 */

export interface ScanCardProps {
  className?: string;
}

export function ScanCard({ className }: ScanCardProps) {
  const t = useTranslations("scanCard");

  return (
    <Link
      href="/scan"
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl p-8 transition active:scale-[0.98]",
        "bg-gradient-to-br from-soft-lavender to-premium-peach",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-h2 text-graphite">{t("title")}</div>
        <div className="text-body-sm text-muted-graphite mt-1">{t("hint")}</div>
      </div>
      <div
        className="
          flex h-16 w-16 flex-shrink-0 items-center justify-center
          rounded-full bg-pure-white text-graphite shadow-soft-md
        "
      >
        <Camera className="h-7 w-7" strokeWidth={2} />
      </div>
    </Link>
  );
}
