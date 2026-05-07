import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CompatibilityRow, CompatibilityStatus } from "@/lib/types";

/**
 * CompatibilityTable — таблица "Совместимость с кожей" в Product Analysis.
 * Соответствует блоку `.ingredient-section > .card` из прототипа.
 */

export interface CompatibilityTableProps {
  rows: CompatibilityRow[];
  className?: string;
}

const statusConfig: Record<
  CompatibilityStatus,
  { icon: string; colorClass: string }
> = {
  compatible: { icon: "✓", colorClass: "text-success-deep" },
  supports: { icon: "✓", colorClass: "text-success-deep" },
  treats: { icon: "✓", colorClass: "text-success-deep" },
  patch_test: { icon: "⚠", colorClass: "text-warning-deep" },
  warning: { icon: "⚠", colorClass: "text-warning-deep" },
  incompatible: { icon: "✕", colorClass: "text-error-deep" },
};

export function CompatibilityTable({ rows, className }: CompatibilityTableProps) {
  return (
    <Card className={className}>
      <ul className="divide-y divide-soft-beige">
        {rows.map((row) => {
          const cfg = statusConfig[row.status];
          return (
            <li
              key={row.label}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="text-body-sm text-graphite">{row.label}</span>
              <span className={cn("text-body-sm font-semibold", cfg.colorClass)}>
                {cfg.icon} {row.caption}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
