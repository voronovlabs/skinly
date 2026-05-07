import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Input — текстовое поле. Соответствует `.input` в прототипе.
 * Поведение фокуса: lavender-deep border + soft-lavender ring.
 */

export interface InputProps extends ComponentPropsWithoutRef<"input"> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "w-full rounded-md border border-border-soft bg-warm-white p-4",
        "text-[15px] leading-snug font-[inherit] text-graphite",
        "outline-none transition",
        "placeholder:text-light-graphite",
        "focus:border-lavender-deep focus:ring-[3px] focus:ring-soft-lavender/60",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...rest}
    />
  );
});
