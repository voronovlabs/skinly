import { cn } from "@/lib/cn";
import { Card } from "@/components/ui";

/**
 * StatCard — компактная карточка-метрика (используется в `Статистика`).
 */

export interface StatCardProps {
  value: string | number;
  label: string;
  tone?: "lavender" | "gold";
  className?: string;
}

export function StatCard({
  value,
  label,
  tone = "lavender",
  className,
}: StatCardProps) {
  const valueClass =
    tone === "gold" ? "text-soft-gold" : "text-lavender-deep";

  return (
    <Card padding="default" className={cn("flex-1 text-center", className)}>
      <div className={cn("text-h2", valueClass)}>{value}</div>
      <div className="text-caption text-muted-graphite mt-1">{label}</div>
    </Card>
  );
}
