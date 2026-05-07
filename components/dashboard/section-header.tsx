import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * SectionHeader — заголовок секции на дашборде / истории / избранном.
 * Слева: title (h3). Справа: опциональная ссылка.
 */

export interface SectionHeaderProps {
  title: string;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

export function SectionHeader({
  title,
  actionHref,
  actionLabel,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "mb-4 flex items-center justify-between px-6",
        className,
      )}
    >
      <h3 className="text-h3 text-graphite">{title}</h3>

      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="text-body-sm font-medium text-lavender-deep hover:underline"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
