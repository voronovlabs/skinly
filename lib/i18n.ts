/**
 * Конфигурация локалей Skinly.
 * Импортируется и сервером (i18n/request.ts), и клиентом (LanguageSwitcher).
 */

export const SUPPORTED_LOCALES = ["ru", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "ru";

/** Имя cookie, в которой хранится выбранный язык. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/** TTL cookie — 1 год. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
