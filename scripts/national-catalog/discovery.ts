/**
 * Discovery: BFS обход категорий → набор product-URL'ов.
 *
 * Эвристика:
 *   - URL начинается с ROOT_CATEGORY_PATH ("/kosmetika-i-parfyumeriya/")
 *   - заканчивается на "/"  → category или pagination
 *   - НЕ заканчивается на "/" → product detail page
 *   - pagination детектится по `rel="next"` / `?page=N` / тексту "Следующая"
 *
 * Реальные CSS-классы сайта могут отличаться — все селекторы намеренно
 * максимально широкие (`[class*=...]`). Если конкретный класс известен —
 * можно сузить здесь.
 */

import * as cheerio from "cheerio";
import {
  BASE_URL,
  MAX_CATEGORY_PAGES_VISITED,
  ROOT_CATEGORY_PATH,
} from "./config";
import { fetchHtml } from "./fetcher";

function absolutize(href: string, base: string = BASE_URL): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function pathOnly(absoluteUrl: string): string | null {
  try {
    const u = new URL(absoluteUrl);
    return u.pathname + (u.search || "");
  } catch {
    return null;
  }
}

function isCategoryOrPagination(p: string): boolean {
  if (!p.startsWith(ROOT_CATEGORY_PATH)) return false;
  // category всегда заканчивается слешем;
  // pagination — query-параметр `?page=` на категории.
  if (p.endsWith("/")) return true;
  if (p.includes("?page=")) return true;
  return false;
}

function isProduct(p: string): boolean {
  if (!p.startsWith(ROOT_CATEGORY_PATH)) return false;
  if (p.endsWith("/")) return false;
  if (p.includes("?")) return false;
  // product — самый глубокий уровень: что-то после слеша, не категория.
  // В большинстве каталогов это либо barcode, либо slug.
  const tail = p.split("/").filter(Boolean).pop() ?? "";
  return tail.length > 0;
}

interface DiscoveryOptions {
  /** Сколько максимум product-URL'ов нужно. */
  limit: number;
  log: (msg: string) => void;
}

interface DiscoveryStats {
  pagesVisited: number;
  categoriesFound: number;
  productsFound: number;
}

/**
 * BFS-обход. Возвращает уникальные product-URL'ы (path-only) и статистику.
 */
export async function discoverProducts(
  opts: DiscoveryOptions,
): Promise<{ urls: string[]; stats: DiscoveryStats }> {
  const queue: string[] = [ROOT_CATEGORY_PATH];
  const visited = new Set<string>();
  const products = new Set<string>();
  const categories = new Set<string>();

  let pagesVisited = 0;

  while (
    queue.length > 0 &&
    products.size < opts.limit &&
    pagesVisited < MAX_CATEGORY_PAGES_VISITED
  ) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const fullUrl = absolutize(current);
    if (!fullUrl) continue;

    pagesVisited++;
    opts.log(
      `[discovery] [${pagesVisited}/${MAX_CATEGORY_PAGES_VISITED}] visit ${current} (queue=${queue.length}, products=${products.size})`,
    );

    let html: string;
    try {
      html = await fetchHtml(fullUrl, opts.log);
    } catch (e) {
      opts.log(`[discovery] FAIL ${current}: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    const $ = cheerio.load(html);

    // Все ссылки, ведущие в наш каталог
    const links = new Set<string>();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const abs = absolutize(href, fullUrl);
      if (!abs) return;
      const p = pathOnly(abs);
      if (!p) return;
      if (!p.startsWith(ROOT_CATEGORY_PATH)) return;
      links.add(p);
    });

    // Pagination: rel="next" имеет приоритет
    const nextHref =
      $('a[rel="next"]').first().attr("href") ||
      $('[class*="pagination"] a').last().attr("href");
    if (nextHref) {
      const nextAbs = absolutize(nextHref, fullUrl);
      const nextPath = nextAbs ? pathOnly(nextAbs) : null;
      if (nextPath && nextPath.startsWith(ROOT_CATEGORY_PATH)) {
        links.add(nextPath);
      }
    }

    let foundProductsHere = 0;
    let foundCategoriesHere = 0;

    for (const link of links) {
      if (isProduct(link)) {
        if (!products.has(link)) {
          products.add(link);
          foundProductsHere++;
          if (products.size >= opts.limit) break;
        }
      } else if (isCategoryOrPagination(link) && !visited.has(link)) {
        if (!categories.has(link)) {
          categories.add(link);
          foundCategoriesHere++;
          queue.push(link);
        }
      }
    }

    opts.log(
      `[discovery]   +${foundProductsHere} products, +${foundCategoriesHere} sub-pages`,
    );
  }

  return {
    urls: Array.from(products).slice(0, opts.limit),
    stats: {
      pagesVisited,
      categoriesFound: categories.size,
      productsFound: products.size,
    },
  };
}
