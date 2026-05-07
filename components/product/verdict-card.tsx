import { Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { MatchRing } from "@/components/ui";
import type { VerdictTone } from "@/lib/types";

/**
 * VerdictCard — итоговая карточка вердикта в Product Analysis.
 * Соответствует `.verdict-card` / `.verdict-card.caution` из прототипа.
 */

export interface VerdictCardProps {
  tone: VerdictTone;
  title: string;
  subtitle: string;
  matchScore: number;
  className?: string;
}

const toneConfig = {
  good: {
    bg: "bg-gradient-to-br from-success-mint to-pure-white",
    border: "border-l-success-deep",
    iconBg: "bg-success-mint text-success-deep",
    Icon: Check,
  },
  caution: {
    bg: "bg-gradient-to-br from-warning-cream to-pure-white",
    border: "border-l-warning-deep",
    iconBg: "bg-warning-cream text-warning-deep",
    Icon: AlertTriangle,
  },
} as const;

export function VerdictCard({
  tone,
  title,
  subtitle,
  matchScore,
  className,
}: VerdictCardProps) {
  const cfg = toneConfig[tone];
  const Icon = cfg.Icon;

  return (
    <div
      className={cn(
        "rounded-xl border-l-[4px] p-6",
        cfg.bg,
        cfg.border,
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full",
            cfg.iconBg,
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-h3 text-graphite">{title}</div>
          <div className="text-body-sm text-muted-graphite">{subtitle}</div>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <MatchRing value={matchScore} />
      </div>
    </div>
  );
}
