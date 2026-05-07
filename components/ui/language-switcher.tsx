"use client";

import { cn } from "@/lib/cn";
import { SUPPORTED_LOCALES, type AppLocale } from "@/lib/i18n";

/**
 * LanguageSwitcher — segmented-control RU / EN.
 * Соответствует `.lang-switch` / `.lang-btn` в прототипе.
 *
 * Controlled: текущая локаль приходит сверху, переключатель уведомляет
 * родителя через onChange. Реальное переключение языка живёт в
 * `PreferencesSection` (вызывает server action `setLocaleAction` + router.refresh).
 */

// Реэкспортируем единый source-of-truth из lib/i18n.
export type { AppLocale };

export interface LanguageSwitcherProps {
  value: AppLocale;
  onChange: (next: AppLocale) => void;
  className?: string;
  /** Использовать только пробелы или префиксы — для нестандартных мест. */
  size?: "sm" | "md";
}

const LABELS: Record<AppLocale, string> = {
  ru: "RU",
  en: "EN",
};

export function LanguageSwitcher({
  value,
  onChange,
  className,
  size = "md",
}: LanguageSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-soft-beige p-1",
        className,
      )}
    >
      {SUPPORTED_LOCALES.map((code) => {
        const isActive = code === value;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(code)}
            className={cn(
              "rounded-full font-semibold transition-colors duration-150 ease-out",
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
              isActive
                ? "bg-pure-white text-graphite shadow-soft-sm"
                : "bg-transparent text-muted-graphite hover:text-graphite",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender-deep/40",
            )}
          >
            {LABELS[code]}
          </button>
        );
      })}
    </div>
  );
}
