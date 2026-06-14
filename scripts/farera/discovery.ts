/**
 * Discovery для FARERA — через XML-sitemap, БЕЗ обхода 126 брендов.
 *
 * Пайплайн:
 *   1. GET /sitemap.xml — индекс. Берём все <loc> вида `.../products\d+.xml`.
 *   2. Для каждого products-sitemap'а GET и вытаскиваем все <loc> — это
 *      detail-URL'ы товаров.
 *   3. Возвращаем pathname'ы (как в national-catalog: храним path-only для
 *      checkpoint/дедупа), уникальные, в порядке появления.
 *
 * Почему products*.xml: один индекс даёт полный охват каталога (≈весь
 * ассортимент), не нужно ходить по брендам и пагинации. CS-Cart режет
 * sitemap по 50k URL/файл, поэтому теоретически products2.xml и далее —
 * мы поддерживаем любое их число.
 *
 * Парсинг XML — регуляркой по <loc>. Никаких xml-парсеров/SDK не тянем.
 */

import { SITEMAP_INDEX_URL } from "./config";
import { fetchHtml } from "../national-catalog/fetcher";

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const PRODUCTS_SITEMAP_RE = /\/products\d+\.xml(?:$|\?)/i;

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

function toPathname(absoluteUrl: string): string | null {
  try {
    const u = new URL(absoluteUrl);
    // Храним path-only (как national-catalog) для единообразного дедупа.
    return u.pathname;
  } catch {
    return null;
  }
}

export interface SitemapDiscoveryOptions {
  /**
   * Максимум product-URL'ов вернуть. Если `undefined` — собираем ВЕСЬ
   * каталог из products*.xml без ограничения (это поведение по умолчанию).
   * Лимит здесь — это discovery-limit, он НЕ связан со scrape-limit.
   */
  limit?: number;
  log: (msg: string) => void;
}

export interface SitemapDiscoveryStats {
  productSitemaps: number;
  totalLocs: number;
  productUrls: number;
}

/**
 * Собрать product-URL'ы (pathname) из всех products*.xml.
 *
 * Возвращает уникальные pathname'ы, обрезанные до `limit`. Если sitemap
 * недоступен — бросает (caller обрабатывает как фатал прогона).
 */
export async function discoverFromSitemap(
  opts: SitemapDiscoveryOptions,
): Promise<{ urls: string[]; stats: SitemapDiscoveryStats }> {
  const cap = opts.limit; // undefined → без ограничения (весь каталог)

  opts.log(`[discovery] fetch sitemap index ${SITEMAP_INDEX_URL}`);
  const indexXml = await fetchHtml(SITEMAP_INDEX_URL, opts.log);

  const productSitemaps = extractLocs(indexXml).filter((u) =>
    PRODUCTS_SITEMAP_RE.test(u),
  );
  opts.log(
    `[discovery] product sitemaps found: ${productSitemaps.length} → ${productSitemaps.join(", ") || "(none)"}`,
  );

  if (productSitemaps.length === 0) {
    throw new Error(
      "no products*.xml found in sitemap index — структура карты сайта изменилась",
    );
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  let totalLocs = 0;
  const reached = () => cap != null && urls.length >= cap;

  for (const sm of productSitemaps) {
    if (reached()) break;
    opts.log(`[discovery] fetch ${sm}`);
    const xml = await fetchHtml(sm, opts.log);
    const locs = extractLocs(xml);
    totalLocs += locs.length;
    let addedHere = 0;
    for (const loc of locs) {
      const path = toPathname(loc);
      if (!path) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      urls.push(path);
      addedHere++;
      if (reached()) break;
    }
    opts.log(
      `[discovery]   ${sm}: ${locs.length} locs, +${addedHere} new ` +
        `(discovered total=${urls.length}${cap != null ? `/${cap}` : ""})`,
    );
  }

  opts.log(
    `[discovery] DONE product-sitemaps=${productSitemaps.length}, ` +
      `totalLocs=${totalLocs}, discovered=${urls.length}` +
      (cap != null ? ` (capped at discovery-limit=${cap})` : " (full catalog, no cap)"),
  );

  return {
    urls,
    stats: {
      productSitemaps: productSitemaps.length,
      totalLocs,
      productUrls: urls.length,
    },
  };
}
