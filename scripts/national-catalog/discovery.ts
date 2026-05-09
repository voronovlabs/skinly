/**
 * Discovery: BFS обход категорий → набор product-URL'ов.
 *
 * Эвристика:
 *   - URL должен matches один из COSMETIC_CATEGORY_PREFIXES (не только root!).
 *     Это потому что у националкаталог.рф подкатегории живут как top-level
 *     пути (`/parfyumeriya/`, `/kosmetika/`...), а не вложены в root.
 *   - заканчивается на "/" → category
 *   - содержит "?page=" → pagination (тоже category)
 *   - содержит другой "?" (фильтр/сортировка) → reject
 *   - НЕ заканчивается на "/" → product detail page
 *
 * DEBUG MODE (`--debug`):
 *   - Дампит первую страницу как `data/debug/root.html`
 *   - Сохраняет ВСЕ ссылки в `data/debug/root-links.txt` с классификацией
 *   - В stdout: total, accepted, top reasons rejection, первые 30 accepted
 *   - Эвристически детектит CSR
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

function isPagination(p: string): boolean {
  return p.includes("?page=") || /[?&]p=\d+/.test(p);
}

function hasUnwantedQuery(p: string): boolean {
  // фильтры/сортировки/utm — игнорируем, чтобы не плодить дубликаты
  if (!p.includes("?")) return false;
  if (isPagination(p)) return false;
  return true;
}

function isCategory(p: string): boolean {
  if (!matchesCosmeticPrefix(p)) return false;
  if (hasUnwantedQuery(p)) return false;
  return p.endsWith("/") || isPagination(p);
}

function isProduct(p: string): boolean {
  if (!matchesCosmeticPrefix(p)) return false;
  if (p.endsWith("/")) return false;
  if (p.includes("?")) return false;
  const tail = p.split("/").filter(Boolean).pop() ?? "";
  return tail.length > 0;
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
  if (!p) {
    return {
      href,
      abs,
      pathOnly: null,
      classification: "rejected",
      reason: "no path",
    };
  }
  if (!matchesCosmeticPrefix(p)) {
    // первое слово пути — для красивого reason
    const head = "/" + (p.split("/").filter(Boolean)[0] ?? "");
    return {
      href,
      abs,
      pathOnly: p,
      classification: "rejected",
      reason: `not cosmetic prefix (head=${head})`,
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
  if (isProduct(p)) {
    return {
      href,
      abs,
      pathOnly: p,
      classification: "product",
      reason: "leaf URL under cosmetic prefix",
    };
  }
  if (isCategory(p)) {
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
    reason: "unmatched shape",
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

  // root-links.txt
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
    lines.push(
      `[${c.classification.padEnd(8)}] ${c.pathOnly?.slice(0, 90) ?? c.href}  ← ${c.reason}`,
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
    log(`  [${c.classification}] ${c.pathOnly?.slice(0, 90)}  ← ${c.reason}`);
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
  /** Игнорировать allowlist, акцептить вообще всё (отладочный fallback). */
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

  let pagesVisited = 0;
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
      `[discovery] [${pagesVisited}/${MAX_CATEGORY_PAGES_VISITED}] visit ${current} (queue=${queue.length}, products=${products.size})`,
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

    let foundProductsHere = 0;
    let foundCategoriesHere = 0;
    let rejectedHere = 0;
    const rejReasonsHere = new Map<string, number>();

    for (const href of anchors) {
      const c = classifyHref(href, fullUrl);

      if (opts.unsafeAcceptAll) {
        if (c.pathOnly && !c.pathOnly.endsWith("/") && !c.pathOnly.includes("?")) {
          if (!products.has(c.pathOnly)) {
            products.add(c.pathOnly);
            foundProductsHere++;
          }
          continue;
        }
      }

      if (c.classification === "product" && c.pathOnly) {
        if (!products.has(c.pathOnly)) {
          products.add(c.pathOnly);
          foundProductsHere++;
          if (products.size >= opts.limit) break;
        }
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
        if (c.classification === "rejected") {
          rejReasonsHere.set(
            c.reason,
            (rejReasonsHere.get(c.reason) ?? 0) + 1,
          );
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
      `[discovery]   total <a>=${anchors.length} | +${foundProductsHere} products, +${foundCategoriesHere} sub-pages, ${rejectedHere} rejected`,
    );

    // На root, если ни одной accepted — печатаем краткое why
    if (
      pagesVisited === 1 &&
      foundProductsHere === 0 &&
      foundCategoriesHere === 0
    ) {
      opts.log(
        `[discovery] ⚠️  на root-странице 0 accepted. Топ rejection reasons:`,
      );
      const top = [...rejReasonsHere.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [r, n] of top) opts.log(`           ${n} × ${r}`);
      opts.log(
        `           см. data/debug/root-links.txt — там полный список ссылок`,
      );
    }
  }

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
