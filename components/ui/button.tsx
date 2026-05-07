import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Button — главный CTA-элемент дизайн-системы.
 * Соответствует `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` из прототипа.
 *
 * Если нужна навигация — используйте Next `<Link>` с `buttonClassName({...})`,
 * чтобы не рендерить `<button>` внутри `<a>`.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "default" | "icon";

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export interface ButtonProps
  extends ComponentPropsWithoutRef<"button">,
    ButtonStyleOptions {}

const variantStyles: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-graphite text-pure-white shadow-soft-md",
    "hover:scale-[1.02] hover:shadow-soft-lg active:scale-[0.98]",
  ),
  secondary: cn(
    "bg-transparent text-graphite border border-border",
    "hover:bg-warm-white",
  ),
  ghost: cn(
    "bg-soft-lavender/40 text-lavender-deep",
    "hover:bg-soft-lavender/70",
  ),
};

const sizeStyles: Record<ButtonSize, string> = {
  default: "px-7 py-4 text-sm",
  icon: "h-12 w-12 p-0 text-base",
};

const baseStyles = cn(
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-wide",
  "transition-[transform,background-color,box-shadow,color] duration-200 ease-out",
  "disabled:pointer-events-none disabled:opacity-60",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender-deep/50 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-white",
);

/**
 * Возвращает className-строку с теми же стилями, что и `<Button />`.
 * Удобно для рендера Next `<Link className={buttonClassName({ variant: "primary" })}>...`.
 */
export function buttonClassName({
  variant = "primary",
  size = "default",
  fullWidth = true,
}: ButtonStyleOptions = {}): string {
  return cn(
    baseStyles,
    variantStyles[variant],
    sizeStyles[size],
    size !== "icon" && fullWidth && "w-full",
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "default",
    fullWidth = true,
    type = "button",
    className,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClassName({ variant, size, fullWidth }), className)}
      {...rest}
    />
  );
});
