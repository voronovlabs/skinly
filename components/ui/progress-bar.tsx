import { cn } from "@/lib/cn";

/**
 * ProgressBar — тонкая полоса прогресса (3px), как `.progress-bar` в прототипе.
 * Используется в onboarding и для индикатора заполнения профиля.
 */

export interface ProgressBarProps {
  /** Текущее значение (по шкале 0..max). */
  value: number;
  /** Максимум, по умолчанию 100. */
  max?: number;
  className?: string;
  "aria-label"?: string;
}

export function ProgressBar({
  value,
  max = 100,
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const safeMax = max <= 0 ? 100 : max;
  const pct = Math.min(Math.max((value / safeMax) * 100, 0), 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn(
        "h-[3px] w-full overflow-hidden rounded-full bg-soft-beige",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-lavender-deep transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
