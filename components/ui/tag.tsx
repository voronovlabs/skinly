import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Tag — чип/бейдж. Используется для:
 *   - категорий продукта
 *   - фильтров истории
 *   - статусов ингредиентов (Полезен / С осторожностью / ...)
 *   - совместимости (% match badge)
 */

export type TagTone =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "danger"
  | "premium";

export interface TagProps extends ComponentPropsWithoutRef<"span"> {
  tone?: TagTone;
  /** Активный фильтр / выбранный чип. */
  selected?: boolean;
  /** Включает курсор-pointer и лёгкий hover. */
  interactive?: boolean;
}

const toneStyles: Record<TagTone, string> = {
  neutral: "bg-soft-beige text-muted-graphite",
  active: "bg-soft-lavender text-lavender-deep",
  success: "bg-success-mint text-success-deep",
  warning: "bg-warning-cream text-warning-deep",
  danger: "bg-error-blush text-error-deep",
  premium: "bg-premium-peach text-graphite",
};

export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { tone = "neutral", selected = false, interactive = false, className, ...rest },
  ref,
) {
  // selected = принудительно показать "active" tone
  const effectiveTone: TagTone = selected ? "active" : tone;

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5",
        "text-[11px] font-medium leading-none tracking-[0.02em]",
        "transition-colors duration-150 ease-out",
        toneStyles[effectiveTone],
        interactive && "cursor-pointer hover:brightness-95",
        className,
      )}
      {...rest}
    />
  );
});
