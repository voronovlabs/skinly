/**
 * Источники №2/№3 — официальные сайты брендов и крупные магазины (HTML).
 *
 * Расширяемый механизм: каждый сайт = маленький SiteAdapter (как строить URL
 * поиска и как выбрать ссылку на товар). Провайдер фабрикуется из адаптера и
 * переиспользует:
 *   • fetchHtml (вежливый клиент с rate-limit),
 *   • extractInciIfMatches (htmlToText + brand/name-gate + strict isLikelyInci).
 *
 * ВАЖНО: эти адаптеры зависят от вёрстки конкретных сайтов и часто прикрыты
 * анти-ботом, поэтому по умолчанию ВЫКЛЮЧЕНЫ (см. EXPERIMENTAL_ADAPTERS и флаг
 * --enable-html в раннере). Их селекторы нужно подтвердить живым прогоном.
 * Добавить новый источник = добавить один SiteAdapter, остальной код не меняется.
 */

import { fetchHtml } from "../../../caretobeauty/client";
import { extractInciIfMatches } from "../html-inci";
import type { EnrichProduct, IngredientProvider } from "../types";

export interface SiteAdapter {
  name: string;
  kind: "brand" | "retailer";
  /** URL для запроса: либо прямой продукт, либо страница поиска. null = пропуск. */
  buildUrl(p: EnrichProduct): string | null;
  /**
   * Если buildUrl вернул страницу ПОИСКА — выбрать из неё URL карточки товара
   * (по brand+name). Если адаптер строит прямой product-URL — не задаём.
   */
  pickProductUrl?(searchHtml: string, p: EnrichProduct): string | null;
}

/** Фабрика провайдера из адаптера сайта. */
export function htmlSiteProvider(a: SiteAdapter): IngredientProvider {
  return {
    name: a.name,
    async getIngredients(p, log) {
      const startUrl = a.buildUrl(p);
      if (!startUrl) return null;
      let html: string;
      try {
        html = await fetchHtml(startUrl, log);
      } catch {
        return null;
      }
      let productUrl = startUrl;
      if (a.pickProductUrl) {
        const u = a.pickProductUrl(html, p);
        if (!u) return null;
        productUrl = u;
        try {
          html = await fetchHtml(u, log);
        } catch {
          return null;
        }
      }
      const inci = extractInciIfMatches(html, p); // brand/name-gate внутри
      if (!inci) return null;
      return {
        inci,
        source: a.name,
        sourceUrl: productUrl,
        method: `${a.kind}-html`,
        confidence: a.kind === "brand" ? 0.8 : 0.75,
      };
    },
  };
}

function q(p: EnrichProduct): string {
  return encodeURIComponent([p.brand, p.name].filter(Boolean).join(" ").trim());
}

/**
 * ЭКСПЕРИМЕНТАЛЬНЫЕ адаптеры (по умолчанию ВЫКЛЮЧЕНЫ). Пример формы; перед
 * включением --enable-html проверьте URL/выбор ссылки живым прогоном и
 * при необходимости поправьте pickProductUrl.
 */
export const EXPERIMENTAL_ADAPTERS: SiteAdapter[] = [
  {
    // Парафармацевт: в карточке обычно есть видимая секция Composition/EAN.
    name: "cocooncenter",
    kind: "retailer",
    buildUrl: (p) =>
      p.name ? `https://www.cocooncenter.co.uk/catalogsearch/result/?q=${q(p)}` : null,
    pickProductUrl: (html, p) => firstProductLink(html, /\/[0-9]+\.html/i, p),
  },
];

/**
 * Универсальный выбор ссылки на товар из HTML поиска: берёт первый href,
 * совпадающий с pattern, чей якорный текст матчит brand+name (грубо).
 */
function firstProductLink(
  html: string,
  pattern: RegExp,
  p: EnrichProduct,
): string | null {
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const wantBrand = (p.brand ?? "").toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    if (!pattern.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").toLowerCase();
    if (wantBrand && !text.includes(wantBrand.split(" ")[0])) continue;
    return href.startsWith("http") ? href : null; // только абсолютные, без догадок о домене
  }
  return null;
}
