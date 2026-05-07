import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isAppLocale,
} from "@/lib/i18n";

/**
 * next-intl зовёт этот хелпер на каждый запрос RSC, чтобы определить:
 *   - текущую локаль (из cookie NEXT_LOCALE, fallback — DEFAULT_LOCALE = ru)
 *   - какой JSON-словарь подгрузить
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = isAppLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;

  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
