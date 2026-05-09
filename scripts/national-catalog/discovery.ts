/**
 * Discovery: BFS обход категорий → набор product-URL'ов.
 *
 * Архитектура matching'а:
 *   - PRODUCT URLs живут на хостовом prefix'е `/product/<barcode>-<slug>`
 *     и НЕ находятся под path'ом косметической категории.
 *   - CATEGORY URLs — топ-левел пути из allowlist'а COSMETIC_CATEGORY_PREFIXES
 *     (`/parfyumeriya/`, `/kosmetika/` и т.п.).
 *   - Поэтому /product/... принимаем по своему регулярному правилу,
 *     а cosmetic-prefix используем ТОЛЬКО для category/subcategory обхода.
 *
 * BFS «доверяет» странице по категории:
 *   queue стартует с ROOT_CATEGORY_PATH, в queue добавляются только URL'ы из
 *   cosmetic-allowlist'а — значит мы посещаем только cosmetic-страницы.
 *   На каждой такой странице любые /product/<barcode>-... → safe-to-accept.
 *
 * DEBUG MODE (`--debug`):
 *   - root.html и root-links.txt в data/debug/
 *   - в stdout: top rejection reasons, первые 20 product-ссылок с barcode
 *   - CSR detection
 */

import * as cheerio from "cheerio";
import {
  BASE_URL,
  COSMETIC_CATEGORY_PREFIXES,
  MAX_CATEGORY_PAGES_VISITED,
  ROOT_CATEGORY_PATH,
  matchesCosmeticPrefix,
} from "./config";
import { fetchHtml } from "./fetcher";
import { writeDebug } from "./storage";

/* ───────── URL helpers ───────── */

/**
 * Регулярка product-URL.
 *   /product/6294021903684-ru-genius-hayati-parfyumernaya-voda-25-ml
 *   ───────  ─────────────
 *    prefix   barcode (8..14 digits)
 */
const PRODUCT_PATH_REGEX = /^\/product\/(\d{8,14})(?:[-/]|$)/;

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

function pathnameOnly(absoluteUrl: string): string | null {
  try {
    return new URL(absoluteUrl).pathname;
  } catch {
    return null;
  }
}

function isPagination(p: string): boolean {
  return p.includes("?page=") || /[?&]p=\d+\b/.test(p);
}

function hasUnwantedQuery(p: string): boolean {
  if (!p.includes("?")) return false;
  if (isPagination(p)) return false;
  return true;
}

function isProductPath(p: string): boolean {
  // Проверяем по pathname без query/fragment
  const idx = p.indexOf("?");
  const pathname = idx >= 0 ? p.slice(0, idx) : p;
  return PRODUCT_PATH_REGEX.test(pathname);
}

function extractBarcode(p: string): string | null {
  const idx = p.indexOf("?");
  const pathname = idx >= 0 ? p.slice(0, idx) : p;
  const m = pathname.match(PRODUCT_PATH_REGEX);
  return m ? m[1] : null;
}

function isCategoryPath(p: string): boolean {
  if (!matchesCosmeticPrefix(p)) return false;
  if (hasUnwantedQuery(p)) return false;
  return p.endsWith("/") || isPagination(p);
}

/* ───────── CSR detection ───────── */

function detectCsr(html: string, $: cheerio.CheerioAPI): {
  likelyCsr: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const sizeKb = Math.round(html.length / 1024);

  if (sizeKb < 5) reasons.push(`html very small (${sizeKb}kb)`);

  const noscript = $("noscript").text().toLowerCase();
  if (
    noscript.includes("javascript") ||
    noscript.includes("включите") ||
    noscript.includes("enable")
  ) {
    reasons.push(`<noscript> has JS-required hint`);
  }

  const rootDiv = $("#root, #app, [data-reactroot]").first();
  if (rootDiv.length > 0 && rootDiv.children().length === 0) {
    reasons.push(
      `empty SPA root container (${rootDiv.attr("id") || rootDiv.prop("tagName")})`,
    );
  }

  const aCount = $("a[href]").length;
  if (aCount < 5) reasons.push(`only ${aCount} <a href> on page`);

  return { likelyCsr: reasons.length > 0, reasons };
}

/* ───────── Classification ───────── */

interface ClassifiedLink {
  href: string;
  abs: string | null;
  pathOnly: string | null;
  classification: "category" | "product" | "rejected";
  reason: string;
  /** Только для product. */
  barcode?: string | null;
}

function classifyHref(href: string, baseUrl: string): ClassifiedLink {
  const abs = absolutize(href, baseUrl);
  if (!abs) {
    return {
      href,
      abs: null,
      pathOnly: null,
      classification: "rejected",
      reason: "invalid URL",
    };
  }
  const p = pathOnly(abs);
  const pn = pathnameOnly(abs);
  if (!p || !pn) {
    return {
      href,
      abs,
      pathOnly: null,
      classification: "rejected",
      reason: "no path",
    };
  }

  // 1) Product — самый специфичный матч, проверяем первым.
  if (isProductPath(pn)) {
    return {
      href,
      abs,
      pathOnly: pn, // для продуктов всегда сохраняем pathname без query
      classification: "product",
      reason: "matches /product/<barcode>",
      barcode: extractBarcode(pn),
    };
  }

  // 2) Category — только из allowlist'а, чтобы не уходить в /produkty/, /odezhda/ и т.п.
  if (matchesCosmeticPrefix(p)) {
    if (hasUnwantedQuery(p)) {
      return {
        href,
        abs,
        pathOnly: p,
        classification: "rejected",
        reason: "filter/sort query string",
      };
    }
    if (p.endsWith("/") || isPagination(p)) {
      return {
        href,
        abs,
        pathOnly: p,
        classification: "category",
        reason: isPagination(p) ? "pagination" : "trailing slash",
      };
    }
    return {
      href,
      abs,
      pathOnly: p,
      classification: "rejected",
      reason: "cosmetic-prefix without trailing slash (likely deprecated link)",
    };
  }

  // 3) Прочее — отбрасываем с причиной.
  const head = "/" + (pn.split("/").filter(Boolean)[0] ?? "");
  return {
    href,
    abs,
    pathOnly: p,
    classification: "rejected",
    reason: `not /product/<barcode>; outside cosmetic allowlist (head=${head})`,
  };
}

/* ───────── Debug dump ───────── */

async function dumpRootDebug(
  html: string,
  pageUrl: string,
  $: cheerio.CheerioAPI,
  log: (msg: string) => void,
): Promise<void> {
  await writeDebug("root.html", html);
  log(`[debug] saved data/debug/root.html (${html.length} bytes)`);

  const anchors = $("a[href]")
    .map((_, el) => $(el).attr("href") || "")
    .get()
    .filter(Boolean);

  const classified = anchors.map((href) => classifyHref(href, pageUrl));

  const counts = { category: 0, product: 0, rejected: 0 };
  const rejReasons = new Map<string, number>();
  const acceptedSamples: ClassifiedLink[] = [];

  for (const c of classified) {
    counts[c.classification]++;
    if (c.classification === "rejected") {
      rejReasons.set(c.reason, (rejReasons.get(c.reason) ?? 0) + 1);
    } else if (acceptedSamples.length < 30) {
      acceptedSamples.push(c);
    }
  }

  const topReasons = [...rejReasons.entries()].sort((a, b) => b[1] - a[1]);

  const lines: string[] = [];
  lines.push(`# Skinly · National Catalog discovery debug`);
  lines.push(`# pageUrl: ${pageUrl}`);
  lines.push(`# scraped: ${new Date().toISOString()}`);
  lines.push(`# total <a href>: ${anchors.length}`);
  lines.push("");

  lines.push("## Counts");
  for (const [k, v] of Object.entries(counts)) lines.push(`  ${k}: ${v}`);
  lines.push("");

  lines.push("## Cosmetic prefixes (allowlist)");
  for (const p of COSMETIC_CATEGORY_PREFIXES) lines.push(`  ${p}`);
  lines.push("");

  const csr = detectCsr(html, $);
  lines.push("## CSR detection");
  lines.push(`  likelyCsr: ${csr.likelyCsr}`);
  for (const r of csr.reasons) lines.push(`  - ${r}`);
  lines.push("");

  lines.push("## Top rejection reasons");
  for (const [reason, n] of topReasons.slice(0, 20)) {
    lines.push(`  ${String(n).padStart(4)} × ${reason}`);
  }
  lines.push("");

  lines.push("## First 30 accepted (product/category)");
  for (const c of acceptedSamples) {
    const tag = c.barcode ? ` [barcode=${c.barcode}]` : "";
    lines.push(
      `[${c.classification.padEnd(8)}]${tag} ${c.pathOnly?.slice(0, 90) ?? c.href}  ← ${c.reason}`,
    );
  }
  lines.push("");

  lines.push("## All anchors (raw href, classification)");
  for (const c of classified) {
    lines.push(`${c.classification}\t${c.href}`);
  }

  await writeDebug("root-links.txt", lines.join("\n"));
  log(
    `[debug] saved data/debug/root-links.txt — total=${anchors.length} category=${counts.category} product=${counts.product} rejected=${counts.rejected}`,
  );

  log("[debug] top rejection reasons:");
  for (const [reason, n] of topReasons.slice(0, 8)) {
    log(`         ${String(n).padStart(4)} × ${reason}`);
  }

  log(`[debug] first ${acceptedSamples.length} accepted links:`);
  for (const c of acceptedSamples) {
    const tag = c.barcode ? ` [barcode=${c.barcode}]` : "";
    log(
      `  [${c.classification}]${tag} ${c.pathOnly?.slice(0, 90)}  ← ${c.reason}`,
    );
  }

  if (csr.likelyCsr) {
    log("[debug] ⚠️  ВЕРОЯТНО CSR — нужен Playwright. Причины:");
    for (const r of csr.reasons) log(`         - ${r}`);
  }
}

/* ───────── Main BFS ───────── */

interface DiscoveryOptions {
  limit: number;
  log: (msg: string) => void;
  debug?: boolean;
  /** Игнорировать allowlist категорий, акцептить вообще всё (отладочный fallback). */
  unsafeAcceptAll?: boolean;
}

interface DiscoveryStats {
  pagesVisited: number;
  categoriesFound: number;
  productsFound: number;
  csrAnalysis?: { likelyCsr: boolean; reasons: string[] };
}

export async function discoverProducts(
  opts: DiscoveryOptions,
): Promise<{ urls: string[]; stats: DiscoveryStats }> {
  const queue: string[] = [ROOT_CATEGORY_PATH];
  const visited = new Set<string>();
  const products = new Set<string>();
  const categories = new Set<string>();

  /** Лог первых N продуктов глобально (по всему BFS). */
  const productsSampleForLog: { path: string; barcode: string | null }[] = [];

  let pagesVisited = 0;
  let totalProductDuplicatesSkipped = 0;
  let csrAnalysis: DiscoveryStats["csrAnalysis"];
  let rootDumped = false;

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
      `[discovery] [${pagesVisited}/${MAX_CATEGORY_PAGES_VISITED}] visit ${current} (queue=${queue.length}, products=${products.size}/${opts.limit})`,
    );

    let html: string;
    try {
      html = await fetchHtml(fullUrl, opts.log);
    } catch (e) {
      opts.log(
        `[discovery] FAIL ${current}: ${e instanceof Error ? e.message : e}`,
      );
      continue;
    }

    const $ = cheerio.load(html);

    if (opts.debug && !rootDumped) {
      await dumpRootDebug(html, fullUrl, $, opts.log);
      csrAnalysis = detectCsr(html, $);
      rootDumped = true;
    }

    const anchors = $("a[href]")
      .map((_, el) => $(el).attr("href") || "")
      .get()
      .filter(Boolean);

    let rawProductLinksHere = 0;
    let newProductsHere = 0;
    let duplicateProductsHere = 0;
    let foundCategoriesHere = 0;
    let rejectedHere = 0;

    for (const href of anchors) {
      const c = classifyHref(href, fullUrl);

      if (opts.unsafeAcceptAll && c.pathOnly && c.classification !== "category") {
        if (!products.has(c.pathOnly)) {
          products.add(c.pathOnly);
          newProductsHere++;
        }
        continue;
      }

      if (c.classification === "product" && c.pathOnly) {
        rawProductLinksHere++;
        if (products.has(c.pathOnly)) {
          duplicateProductsHere++;
          totalProductDuplicatesSkipped++;
          continue;
        }
        products.add(c.pathOnly);
        newProductsHere++;
        if (productsSampleForLog.length < 20) {
          productsSampleForLog.push({ path: c.pathOnly, barcode: c.barcode ?? null });
        }
        if (products.size >= opts.limit) break;
      } else if (
        c.classification === "category" &&
        c.pathOnly &&
        !visited.has(c.pathOnly) &&
        !categories.has(c.pathOnly)
      ) {
        categories.add(c.pathOnly);
        foundCategoriesHere++;
        queue.push(c.pathOnly);
      } else {
        rejectedHere++;
      }
    }

    // pagination через rel="next" (доп. сигнал)
    const nextHref =
      $('a[rel="next"]').first().attr("href") ||
      $('[class*="pagination"] a').last().attr("href");
    if (nextHref) {
      const nextAbs = absolutize(nextHref, fullUrl);
      const nextPath = nextAbs ? pathOnly(nextAbs) : null;
      if (
        nextPath &&
        matchesCosmeticPrefix(nextPath) &&
        !visited.has(nextPath) &&
        !categories.has(nextPath)
      ) {
        categories.add(nextPath);
        queue.push(nextPath);
        foundCategoriesHere++;
      }
    }

    opts.log(
      `[discovery]   total <a>=${anchors.length} | /product/ raw=${rawProductLinksHere}, +${newProductsHere} new, ${duplicateProductsHere} dup | +${foundCategoriesHere} sub-pages | ${rejectedHere} rejected`,
    );
  }

  // Итоговый лог: показываем первые до 20 product-ссылок (полезно для глаз)
  if (productsSampleForLog.length > 0) {
    opts.log(
      `[discovery] first ${productsSampleForLog.length} discovered products:`,
    );
    for (const p of productsSampleForLog) {
      opts.log(`           barcode=${p.barcode ?? "—"}  ${p.path}`);
    }
  }

  opts.log(
    `[discovery] DONE pages=${pagesVisited}, categories=${categories.size}, products=${products.size}, dupSkipped=${totalProductDuplicatesSkipped}`,
  );

  return {
    urls: Array.from(products).slice(0, opts.limit),
    stats: {
      pagesVisited,
      categoriesFound: categories.size,
      productsFound: products.size,
      csrAnalysis,
    },
  };
}
