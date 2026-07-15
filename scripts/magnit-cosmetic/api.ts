/**
 * ЭКСПЕРИМЕНТАЛЬНО: внутренний JSON API Магнита (web-gateway).
 *
 * Endpoint листинга (документирован сообществом для magnit.ru,
 * см. qna.habr.com/q/1299720):
 *
 *   POST https://web-gateway.middle-api.magnit.ru/v3/goods
 *   headers: x-client-name: magnit, x-device-platform: Web,
 *            x-device-id: <любой>, x-device-tag: disabled,
 *            x-app-version: 0.1.0, content-type: application/json
 *   body: { categoryIDs, pagination: {number, size}, shopType, storeCodes, ... }
 *
 * Для М.Косметик shopType предположительно "6" (у «Магнит у дома» — "1").
 * Контракт не подтверждён для cosmetic — поэтому API включается только
 * флагом `--use-api` и при любой ошибке скрейпер откатывается на sitemap.
 * Карточки в любом случае берутся из SSR HTML (состав/описание там полнее).
 */

import { DEFAULT_SHOP_CODE, WEB_GATEWAY_URL } from "./config";
import { canonicalProductUrl, type DiscoveredProduct } from "./discovery";
import { fetchText } from "./fetcher";
import { ts } from "./logger";

const API_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "*/*",
  "x-app-version": "0.1.0",
  "x-client-name": "magnit",
  "x-device-id": "skinly-scraper",
  "x-device-platform": "Web",
  "x-device-tag": "disabled",
  "x-platform-version": "window.navigator.userAgent",
};

interface ApiGood {
  id?: number | string;
  code?: string;
  name?: string;
  seoCode?: string;
  url?: string;
}

/**
 * Пробует получить страницу листинга через web-gateway.
 * Возвращает null при любой ошибке (fallback на sitemap/HTML).
 */
export async function tryApiListing(opts: {
  shopCode?: string;
  shopType?: string;
  page: number;
  pageSize?: number;
  categoryIDs?: number[];
}): Promise<DiscoveredProduct[] | null> {
  const body = JSON.stringify({
    ...(opts.categoryIDs?.length ? { categoryIDs: opts.categoryIDs } : {}),
    includeForAdults: true,
    onlyDiscount: false,
    order: "desc",
    pagination: { number: opts.page, size: opts.pageSize ?? 36 },
    shopType: opts.shopType ?? "6",
    sortBy: "popularity",
    storeCodes: [opts.shopCode ?? DEFAULT_SHOP_CODE],
  });

  try {
    const text = await fetchText(`${WEB_GATEWAY_URL}/v3/goods`, {
      method: "POST",
      headers: API_HEADERS,
      body,
    });
    const json = JSON.parse(text) as { goods?: ApiGood[] };
    if (!Array.isArray(json.goods)) return null;

    const out: DiscoveredProduct[] = [];
    for (const g of json.goods) {
      const id = String(g.id ?? g.code ?? "");
      const slug = g.seoCode ?? g.url ?? "";
      const fromUrl = slug ? canonicalProductUrl(String(slug)) : null;
      if (fromUrl) out.push(fromUrl);
      else if (/^\d+$/.test(id) && g.seoCode) {
        out.push({
          externalId: id,
          slug: String(g.seoCode),
          url: `https://cosmetic.magnit.ru/product/${id}-${g.seoCode}`,
        });
      }
    }
    ts(`api: page ${opts.page} → ${out.length} goods`);
    return out;
  } catch (e) {
    ts(`api: unavailable (${(e as Error).message}) — falling back to sitemap`);
    return null;
  }
}
