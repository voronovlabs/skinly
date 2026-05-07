"use client";

import { cn } from "@/lib/cn";

/**
 * Toggle — переключатель ON/OFF (controlled).
 * Размеры и анимация портированы из `.toggle` / `.toggle-knob` прототипа.
 */

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Toggle({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full",
        "transition-colors duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender-deep/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-lavender-deep" : "bg-soft-beige",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-soft-sm",
          "transition-transform duration-200 ease-out",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
