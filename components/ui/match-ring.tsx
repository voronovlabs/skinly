"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * MatchRing — круговой индикатор совместимости из прототипа (`.match-ring`).
 *
 * При монтировании анимируется от пустого кольца до целевого процента
 * (transition на stroke-dashoffset). Серверная версия рендерит финальное
 * состояние без анимации.
 */

export interface MatchRingProps {
  /** Значение в процентах: 0..100 */
  value: number;
  /** Размер квадрата SVG в px (по умолчанию 80). */
  size?: number;
  /** Толщина обводки (по умолчанию 6). */
  strokeWidth?: number;
  /** Включить mount-анимацию. По умолчанию true. */
  animated?: boolean;
  className?: string;
}

export function MatchRing({
  value,
  size = 80,
  strokeWidth = 6,
  animated = true,
  className,
}: MatchRingProps) {
  const safeValue = Math.min(Math.max(value, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (circumference * safeValue) / 100;

  const [offset, setOffset] = useState<number>(animated ? circumference : targetOffset);

  useEffect(() => {
    if (!animated) {
      setOffset(targetOffset);
      return;
    }
    const raf = requestAnimationFrame(() => setOffset(targetOffset));
    return () => cancelAnimationFrame(raf);
  }, [animated, targetOffset]);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Совместимость ${Math.round(safeValue)}%`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-soft-beige"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-lavender-deep transition-[stroke-dashoffset] duration-[1500ms] ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold text-lavender-deep">
        {Math.round(safeValue)}%
      </span>
    </div>
  );
}
