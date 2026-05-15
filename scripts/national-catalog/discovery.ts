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

/**
 * Phase 13.4 · «island discovery».
 *
 * Когда BFS стартует с произвольной подкатегории (`--start-path /X/`),
 * мы НЕ хотим, чтобы он уезжал в:
 *   - / (homepage)
 *   - /kosmetika-i-parfyumeriya/ (root)
 *   - другие top-level косметические разделы (`/parfyumeriya/`, `/myla/`, ...)
 *
 * Поэтому передаём в `classifyHref` контекст:
 *   - `islandMode: true` отключает старый allowlist `matchesCosmeticPrefix`
 *     (он не покрывает «плоские» внуки вроде `/pincety/`).
 *   - вместо этого: blacklist глобальных «навигационных» путей. Категория
 *     принимается, если она НЕ в blacklist'е и path-выглядит как категория.
 *
 * Graph-based traversal достигается естественно: BFS-очередь стартует с
 * `startPath`, ссылки на блэклист отбрасываются, и в очередь попадают только
 * категории, найденные через цепочку уже акцептированных страниц.
 */
export interface ClassifyContext {
  islandMode: boolean;
  /** Set путей в формате pathname (без query/hash). */
  islandBlacklist?: Set<string>;
  /**
   * Phase 13.6: жёсткий режим — крауль ходит ТОЛЬКО по `strictStartPath` и
   * по его pagination-страницам. Любые другие category-ссылки отвергаются.
   * Product-ссылки классифицируются как раньше — они придут только со
   * страниц, прошедших strict-проверку, потому что в queue ничего другого
   * не попадает.
   */
  strictCategory?: boolean;
  /** Нормализованный startPath, против которого матчится strict-pagination. */
  strictStartPath?: string;
}

const DEFAULT_CTX: ClassifyContext = { islandMode: false };

/**
 * Phase 13.6: strict-category pagination matcher.
 *
 * Принимает:
 *   - точное совпадение со `startPath` (с опц. `?page=N` / `?p=N`)
 *   - `startPath + "pageN/"` или `startPath + "page-N/"` (slash-style pagination,
 *     основная форма на национальном каталоге)
 *
 * Всё остальное — НЕ ходим.
 */
function isStrictAllowedCategory(rawPath: string, startPath: string): boolean {
  const idx = rawPath.indexOf("?");
  const pn = idx >= 0 ? rawPath.slice(0, idx) : rawPath;
  const qs = idx >= 0 ? rawPath.slice(idx) : "";

  if (pn === startPath) {
    if (!qs) return true;
    return /^\?(page|p)=\d+$/i.test(qs);
  }

  if (pn.startsWith(startPath)) {
    const tail = pn.slice(startPath.length);
    if (/^page-?\d+\/?$/i.test(tail)) {
      return !qs || /^\?(page|p)=\d+$/i.test(qs);
    }
  }

  return false;
}

function classifyHref(
  href: string,
  baseUrl: string,
  ctx: ClassifyContext = DEFAULT_CTX,
): ClassifiedLink {
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

  // 1.5) Strict-category mode — перебивает island. Категория принимается
  //      ТОЛЬКО если path == strictStartPath или это его pageN-пагинация.
  if (ctx.strictCategory && ctx.strictStartPath) {
    if (isStrictAllowedCategory(p, ctx.strictStartPath)) {
      return {
        href,
        abs,
        pathOnly: p,
        classification: "category",
        reason: p === ctx.strictStartPath
          ? "strict category (self)"
          : "strict category (pagination)",
      };
    }
    return {
      href,
      abs,
      pathOnly: p,
      classification: "rejected",
      reason: "outside strict category",
    };
  }

  // 2a) Island mode — graph-based, без allowlist'а.
  if (ctx.islandMode && ctx.islandBlacklist) {
    // homepage отдельно (pn === "/")
    if (pn === "/") {
      return {
        href,
        abs,
        pathOnly: p,
        classification: "rejected",
        reason: "homepage (island mode)",
      };
    }
    // Для blacklist'а сравниваем по pathname (без query) — иначе
    // `/myla/?page=2` проскочит мимо записи `/myla/`.
    if (ctx.islandBlacklist.has(pn)) {
      return {
        href,
        abs,
        pathOnly: p,
        classification: "rejected",
        reason: "global-nav blacklist (island mode)",
      };
    }
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
        reason: isPagination(p)
          ? "island pagination"
          : "island category (trailing slash)",
      };
    }
    return {
      href,
      abs,
      pathOnly: p,
      classification: "rejected",
      reason: "non-category path in island mode",
    };
  }

  // 2b) Legacy mode — категория только из allowlist'а.
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

/**
 * Глобальные «навигационные» пути сайта, которые могут торчать в шапке/футере
 * любой категории. Заносим их в blacklist в island mode, чтобы BFS не утёк
 * через cross-сайтовое меню. Этот список безопасно расширять — все его
 * элементы заведомо не-категория-продуктов.
 */
const GLOBAL_NAV_PATHS: ReadonlyArray<string> = [
  "/about/",
  "/help/",
  "/faq/",
  "/contacts/",
  "/contact/",
  "/login/",
  "/register/",
  "/search/",
  "/cart/",
  "/checkout/",
  "/profile/",
  "/news/",
  "/blog/",
  "/sitemap/",
  // top-level «не косметика» разделы национального каталога —
  // явно блочим, на случай если есть перекрёстные ссылки:
  "/produkty/",
  "/eda/",
  "/odezhda/",
  "/elektronika/",
  "/b2b/",
];

/**
 * Построить blacklist глобальных навигационных путей для island mode.
 * Сам `startPath` НЕ в blacklist'е — это и есть seed обхода.
 *
 * Содержимое:
 *   - все top-level cosmetic prefixes из `COSMETIC_CATEGORY_PREFIXES`, кроме `startPath`
 *   - root cosmetic-каталог
 *   - "/" (homepage)
 *   - набор `GLOBAL_NAV_PATHS` (about, help, search, cart, b2b и т.п.)
 */
function buildIslandBlacklist(startPath: string): Set<string> {
  const set = new Set<string>();
  for (const p of COSMETIC_CATEGORY_PREFIXES) {
    if (p !== startPath) set.add(p);
  }
  set.add(ROOT_CATEGORY_PATH);
  set.add("/");
  for (const g of GLOBAL_NAV_PATHS) {
    if (g !== startPath) set.add(g);
  }
  return set;
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
  /**
   * Phase 13 / 13.4: стартовый path для BFS. Если не задан или равен
   * `ROOT_CATEGORY_PATH` — используется legacy «full catalog» режим
   * (allowlist `COSMETIC_CATEGORY_PREFIXES`).
   *
   * Любой другой `startPath` активирует **island discovery** (Phase 13.4):
   *   - BFS начинается с `startPath` и расширяется ТОЛЬКО через граф ссылок,
   *     встреченных на уже посещённых страницах;
   *   - глобальные навигационные ссылки (`/`, root cosmetic-каталог,
   *     остальные top-level cosmetic prefixes) занесены в blacklist и
   *     не приводят к уезжанию BFS в соседние разделы.
   */
  startPath?: string;
  /**
   * Phase 13.6: жёсткий режим. Активируется CLI флагом `--strict-category` +
   * `--start-path`. В этом режиме:
   *   - queue/категории = { startPath, startPath + pageN/, ... };
   *   - любые другие category-ссылки (соседние / sub / sibling / breadcrumb)
   *     отвергаются с reason "outside strict category";
   *   - product-ссылки на принятых страницах собираются как обычно.
   *
   * Без `--start-path` флаг игнорируется (no-op).
   */
  strictCategory?: boolean;
}

interface DiscoveryStats {
  pagesVisited: number;
  categoriesFound: number;
  productsFound: number;
  csrAnalysis?: { likelyCsr: boolean; reasons: string[] };
  /** Phase 13.4: сколько category-ссылок прошли через classifier как accepted. */
  categoryLinksAccepted?: number;
  /** Phase 13.4: сколько category-ссылок отвергнуты (всего, любая причина). */
  categoryLinksRejected?: number;
  /** Phase 13.4: подмножество rejected — отбито global-nav blacklist'ом. */
  categoryLinksRejectedByBlacklist?: number;
}

export async function discoverProducts(
  opts: DiscoveryOptions,
): Promise<{ urls: string[]; stats: DiscoveryStats }> {
  const startPath = opts.startPath ?? ROOT_CATEGORY_PATH;

  // Phase 13.4: island mode = startPath отличается от root cosmetic-каталога.
  const islandMode = startPath !== ROOT_CATEGORY_PATH;
  // Phase 13.6: strict-category — имеет смысл только при non-root startPath.
  const strictCategory = Boolean(opts.strictCategory) && islandMode;

  const islandBlacklist =
    islandMode && !strictCategory ? buildIslandBlacklist(startPath) : undefined;

  let ctx: ClassifyContext;
  if (strictCategory) {
    ctx = {
      islandMode: true,
      strictCategory: true,
      strictStartPath: startPath,
    };
  } else if (islandBlacklist) {
    ctx = { islandMode: true, islandBlacklist };
  } else {
    ctx = { islandMode: false };
  }

  opts.log(
    `[discovery] BFS startPath=${startPath} islandMode=${islandMode}` +
      (strictCategory ? " strictCategory=true" : "") +
      (islandBlacklist ? ` blacklistSize=${islandBlacklist.size}` : ""),
  );

  const queue: string[] = [startPath];
  const visited = new Set<string>();
  const products = new Set<string>();
  const categories = new Set<string>();

  /** Лог первых N продуктов глобально (по всему BFS). */
  const productsSampleForLog: { path: string; barcode: string | null }[] = [];

  let pagesVisited = 0;
  let totalProductDuplicatesSkipped = 0;
  let categoryLinksAccepted = 0;
  let categoryLinksRejected = 0;
  let categoryLinksRejectedByBlacklist = 0;
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
      const c = classifyHref(href, fullUrl, ctx);

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
        categoryLinksAccepted++;
        if (islandMode && opts.debug) {
          opts.log(`[discovery]   ✓ island accept-category ${c.pathOnly}`);
        }
        queue.push(c.pathOnly);
      } else {
        rejectedHere++;
        if (c.classification === "rejected") {
          categoryLinksRejected++;
          if (
            c.reason.startsWith("global-nav blacklist") ||
            c.reason.startsWith("homepage")
          ) {
            categoryLinksRejectedByBlacklist++;
            if (islandMode && opts.debug) {
              opts.log(
                `[discovery]   ✗ island reject ${c.pathOnly ?? c.href} (${c.reason})`,
              );
            }
          }
        }
      }
    }

    // pagination через rel="next" (доп. сигнал)
    const nextHref =
      $('a[rel="next"]').first().attr("href") ||
      $('[class*="pagination"] a').last().attr("href");
    if (nextHref) {
      const nextAbs = absolutize(nextHref, fullUrl);
      const nextPath = nextAbs ? pathOnly(nextAbs) : null;
      const nextPathname = nextAbs ? pathnameOnly(nextAbs) : null;
      // Strict: только если pageN/ форма от startPath.
      // Island: pathname НЕ в blacklist'е и не root.
      // Legacy: проверка через allowlist.
      let acceptNext: boolean;
      if (!nextPath || !nextPathname) {
        acceptNext = false;
      } else if (strictCategory) {
        acceptNext = isStrictAllowedCategory(nextPath, startPath);
      } else if (islandMode && islandBlacklist) {
        acceptNext = !islandBlacklist.has(nextPathname) && nextPathname !== "/";
      } else {
        acceptNext = matchesCosmeticPrefix(nextPath);
      }
      if (
        acceptNext &&
        nextPath &&
        !visited.has(nextPath) &&
        !categories.has(nextPath)
      ) {
        categories.add(nextPath);
        queue.push(nextPath);
        foundCategoriesHere++;
        categoryLinksAccepted++;
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
    `[discovery] DONE pages=${pagesVisited}, categories=${categories.size}, ` +
      `products=${products.size}, dupSkipped=${totalProductDuplicatesSkipped}` +
      (islandMode
        ? `, cat-accepted=${categoryLinksAccepted}, cat-rejected=${categoryLinksRejected}` +
          ` (blacklist=${categoryLinksRejectedByBlacklist})`
        : ""),
  );

  return {
    urls: Array.from(products).slice(0, opts.limit),
    stats: {
      pagesVisited,
      categoriesFound: categories.size,
      productsFound: products.size,
      csrAnalysis,
      categoryLinksAccepted,
      categoryLinksRejected,
      categoryLinksRejectedByBlacklist,
    },
  };
}
