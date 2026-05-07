"use server";

import { cookies } from "next/headers";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  isAppLocale,
  type AppLocale,
} from "@/lib/i18n";

/**
 * Сохраняет выбранный язык в cookie. Клиент после вызова делает
 * `router.refresh()` — RSC пересобирается, NextIntlClientProvider
 * получает новые messages, UI обновляется без полной перезагрузки.
 */
export async function setLocaleAction(locale: AppLocale): Promise<void> {
  if (!isAppLocale(locale)) {
    throw new Error(`Unsupported locale: ${String(locale)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: false, // читаемо из клиента, безопасно для не-секретных данных
  });
}
