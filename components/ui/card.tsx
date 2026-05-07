import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Card — базовый контейнер для контента (`.card` и `.card-glass` в прототипе).
 */

export type CardVariant = "default" | "glass";

export interface CardProps extends ComponentPropsWithoutRef<"div"> {
  variant?: CardVariant;
  /** Лёгкий hover-lift для кликабельных карточек. */
  interactive?: boolean;
  padding?: "none" | "compact" | "default";
}

const paddingStyles = {
  none: "p-0",
  compact: "p-4",
  default: "p-6",
} as const;

const variantStyles: Record<CardVariant, string> = {
  default: "bg-pure-white shadow-soft-md",
  glass: cn(
    "bg-pure-white/70 backdrop-blur-xl border border-white/50",
    "[backdrop-saturate:1.8]",
  ),
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = "default",
    interactive = false,
    padding = "default",
    className,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg transition-[transform,box-shadow] duration-200 ease-out",
        variantStyles[variant],
        paddingStyles[padding],
        interactive && "cursor-pointer hover:-translate-y-0.5 hover:shadow-soft-lg",
        className,
      )}
      {...rest}
    />
  );
});
