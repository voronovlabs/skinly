/**
 * goldapple.ru scraper — brand page: discover the listing API, paginate,
 * collect all products of a brand.
 *
 * Strategy (in priority order):
 *  1. Open the brand page in Chromium and sniff every JSON XHR/fetch response.
 *     Any response containing an array of product-like objects is treated as
 *     the listing endpoint (observed 2025: GET/POST goldapple.ru/front/api/catalog/plp).
 *  2. Replay that exact request via `context.request` (same cookies) with an
 *     incremented `pageNumber`/`page` until no new items appear.
 *  3. Fallback: infinite-scroll the DOM and harvest product links
 *     (`/<digits>-slug`), clicking "показать ещё" when present.
 */

import type { BrowserContext, Page, Response } from "playwright";
import type {
  BrandListingItem,
  BrandScrapeResult,
  DiscoveredEndpoint,
} from "./types";
import { BASE_URL, jitter, log, sleep, waitForChallenge, warn } from "./client";
import { absUrl, deepWalk, isRecord, parseNumber } from "./json";
import type { JsonRecord } from "./json";
import type { GaClient } from "./client";

const MAX_PAGES = 200;
const PRODUCT_PATH_RE = /^\/(\d{5,})[-/]?/;

// ---------------------------------------------------------------------------
// listing detection
// ---------------------------------------------------------------------------

function looksLikeProduct(v: unknown): v is JsonRecord {
  if (!isRecord(v)) return false;
  const hasId = "itemId" in v || "productId" in v || ("id" in v && ("url" in v || "productUrl" in v));
  const hasNameOrPrice = "name" in v || "productName" in v || "title" in v || "price" in v;
  return hasId && hasNameOrPrice;
}

function toListingItem(o: JsonRecord): BrandListingItem | null {
  const idRaw = o.itemId ?? o.productId ?? o.id ?? o.sku;
  if (idRaw === undefined || idRaw === null) return null;
  const itemId = String(idRaw);

  const urlRaw = o.url ?? o.productUrl ?? o.link ?? o.href;
  const url =
    typeof urlRaw === "string" && urlRaw.length > 1
      ? absUrl(urlRaw)
      : `${BASE_URL}/${itemId}`;

  const brandRaw = o.brand ?? o.brandName;
  const brand =
    typeof brandRaw === "string"
      ? brandRaw
      : isRecord(brandRaw) && typeof brandRaw.name === "string"
        ? brandRaw.name
        : null;

  const price = extractPrice(o.price ?? o.prices, "actual");
  const oldPrice = extractPrice(o.price ?? o.prices, "old");

  const inStockRaw = o.inStock ?? o.available ?? o.isAvailable;
  const inStock = typeof inStockRaw === "boolean" ? inStockRaw : null;

  const nameRaw = o.name ?? o.productName ?? o.title;

  return {
    itemId,
    url,
    name: typeof nameRaw === "string" ? nameRaw : null,
    brand,
    price,
    oldPrice,
    inStock,
    raw: o,
  };
}

/** price can be number | "1 799" | {actual:{amount}, old:{amount}} | {amount}. */
export function extractPrice(price: unknown, which: "actual" | "old"): number | null {
  if (price === undefined || price === null) return null;
  if (isRecord(price)) {
    const branch =
      which === "actual"
        ? (price.actual ?? price.current ?? price.amount ?? price.value)
        : (price.old ?? price.regular ?? price.crossed ?? price.oldPrice);
    if (branch === undefined || branch === null) return which === "actual" ? parseNumber(price) : null;
    if (isRecord(branch)) return parseNumber(branch.amount ?? branch.value ?? branch.price);
    return parseNumber(branch);
  }
  return which === "actual" ? parseNumber(price) : null;
}

/** Deep-scan arbitrary JSON for arrays of product-like objects. */
export function extractListingItems(json: unknown): {
  items: BrandListingItem[];
  totalCount: number | null;
} {
  const items: BrandListingItem[] = [];
  let totalCount: number | null = null;

  deepWalk(json, (node, key) => {
    if (Array.isArray(node) && node.length > 0) {
      const productish = node.filter(looksLikeProduct);
      if (productish.length >= Math.max(1, Math.floor(node.length / 2))) {
        for (const p of productish) {
          const item = toListingItem(p);
          if (item) items.push(item);
        }
        return false; // don't descend into already-consumed array
      }
    }
    if (
      key !== null &&
      /^(count|total|totalcount|totalitems|productscount)$/i.test(key) &&
      typeof node === "number" &&
      node > 0
    ) {
      totalCount = totalCount === null ? node : Math.max(totalCount, node);
    }
    return undefined;
  });

  return { items, totalCount };
}

// ---------------------------------------------------------------------------
// response sniffer
// ---------------------------------------------------------------------------

interface SnifferState {
  observed: Map<string, DiscoveredEndpoint>;
  itemsById: Map<string, BrandListingItem>;
  listingEndpoint: DiscoveredEndpoint | null;
  listingBestCount: number;
  totalCount: number | null;
}

export function createSnifferState(): SnifferState {
  return {
    observed: new Map(),
    itemsById: new Map(),
    listingEndpoint: null,
    listingBestCount: 0,
    totalCount: null,
  };
}

function mergeItems(state: SnifferState, items: BrandListingItem[]): number {
  let added = 0;
  for (const item of items) {
    const existing = state.itemsById.get(item.itemId);
    // API-sourced entries (raw is a rich object) win over DOM stubs.
    if (!existing || (existing.name === null && item.name !== null)) {
      if (!existing) added++;
      state.itemsById.set(item.itemId, item);
    }
  }
  return added;
}

export function attachListingSniffer(page: Page, state: SnifferState): void {
  page.on("response", (resp: Response) => {
    void (async () => {
      try {
        const url = resp.url();
        if (!url.includes("goldapple.ru")) return;
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("json") || resp.status() >= 400) return;

        const json: unknown = await resp.json().catch(() => null);
        if (json === null) return;

        const req = resp.request();
        const { items, totalCount } = extractListingItems(json);
        const kind: DiscoveredEndpoint["kind"] = items.length >= 3 ? "listing" : "other";

        const endpointKey = `${req.method()} ${new URL(url).pathname}`;
        if (!state.observed.has(endpointKey)) {
          state.observed.set(endpointKey, {
            method: req.method(),
            url,
            postData: req.postData(),
            kind,
          });
        }

        if (items.length > 0) {
          mergeItems(state, items);
          if (totalCount !== null) state.totalCount = totalCount;
          if (items.length > state.listingBestCount) {
            state.listingBestCount = items.length;
            state.listingEndpoint = {
              method: req.method(),
              url,
              postData: req.postData(),
              kind: "listing",
            };
          }
        }
      } catch {
        /* sniffing must never break navigation */
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// pagination replay
// ---------------------------------------------------------------------------

function setPageInUrl(url: string, pageNumber: number): string {
  const u = new URL(url);
  const keys = ["pageNumber", "page", "p"];
  for (const k of keys) {
    if (u.searchParams.has(k)) {
      u.searchParams.set(k, String(pageNumber));
      return u.toString();
    }
  }
  u.searchParams.set("pageNumber", String(pageNumber));
  return u.toString();
}

function setPageInBody(postData: string, pageNumber: number): string {
  try {
    const body: unknown = JSON.parse(postData);
    let mutated = false;
    deepWalk(body, (node) => {
      if (mutated) return false;
      if (isRecord(node)) {
        for (const k of Object.keys(node)) {
          if (/^(pagenumber|page)$/i.test(k) && typeof node[k] === "number") {
            node[k] = pageNumber;
            mutated = true;
            return false;
          }
        }
      }
      return undefined;
    });
    if (!mutated && isRecord(body)) (body as JsonRecord).pageNumber = pageNumber;
    return JSON.stringify(body);
  } catch {
    return postData;
  }
}

async function replayListingPage(
  context: BrowserContext,
  endpoint: DiscoveredEndpoint,
  pageNumber: number,
): Promise<{ items: BrandListingItem[]; totalCount: number | null }> {
  const headers = { accept: "application/json" };
  let json: unknown;

  if (endpoint.method.toUpperCase() === "GET") {
    const resp = await context.request.get(setPageInUrl(endpoint.url, pageNumber), { headers });
    if (!resp.ok()) throw new Error(`listing page ${pageNumber}: HTTP ${resp.status()}`);
    json = await resp.json();
  } else {
    const data = endpoint.postData ? setPageInBody(endpoint.postData, pageNumber) : undefined;
    const resp = await context.request.post(endpoint.url, {
      headers: { ...headers, "content-type": "application/json" },
      data,
    });
    if (!resp.ok()) throw new Error(`listing page ${pageNumber}: HTTP ${resp.status()}`);
    json = await resp.json();
  }

  return extractListingItems(json);
}

// ---------------------------------------------------------------------------
// DOM fallback
// ---------------------------------------------------------------------------

async function harvestDomLinks(page: Page): Promise<BrandListingItem[]> {
  const anchors = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim().slice(0, 200),
      })),
    )
    .catch(() => [] as Array<{ href: string; text: string }>);

  const items: BrandListingItem[] = [];
  for (const a of anchors) {
    const m = PRODUCT_PATH_RE.exec(a.href);
    if (!m) continue;
    items.push({
      itemId: m[1],
      url: absUrl(a.href.split("?")[0]),
      name: a.text || null,
      brand: null,
      price: null,
      oldPrice: null,
      inStock: null,
      raw: { source: "dom", href: a.href },
    });
  }
  return items;
}

async function domInfiniteScroll(page: Page, state: SnifferState): Promise<void> {
  let stagnantRounds = 0;
  for (let round = 0; round < 80 && stagnantRounds < 3; round++) {
    const before = state.itemsById.size;
    mergeItems(state, await harvestDomLinks(page));

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);

    // "показать ещё" / "show more" button, if the page uses one
    const more = page
      .locator("button, a")
      .filter({ hasText: /показать ещ[её]|show more|ещ[её] товар/i })
      .first();
    if (await more.isVisible().catch(() => false)) {
      await more.click({ timeout: 3000 }).catch(() => undefined);
    }

    await sleep(jitter(1000, 1800));
    mergeItems(state, await harvestDomLinks(page));

    const grew = state.itemsById.size > before;
    stagnantRounds = grew ? 0 : stagnantRounds + 1;
    if (grew) log(`  scroll: ${state.itemsById.size} products so far`);
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function parseBrandSlug(brandUrl: string): string {
  const path = new URL(brandUrl).pathname.replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean).pop() ?? "brand";
  return seg.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

export async function collectBrandProducts(
  client: GaClient,
  brandUrl: string,
): Promise<BrandScrapeResult> {
  const { page, context } = client;
  const brandSlug = parseBrandSlug(brandUrl);
  const state = createSnifferState();

  attachListingSniffer(page, state);

  log(`opening brand page: ${brandUrl}`);
  await page.goto(brandUrl, { waitUntil: "domcontentloaded" });
  await waitForChallenge(page);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await sleep(1500);

  const brandName =
    (await page.locator("h1").first().innerText({ timeout: 5000 }).catch(() => null))?.trim() ||
    brandSlug;

  // Report what we discovered — this is the "investigation" output.
  log(`discovered ${state.observed.size} API endpoints on the brand page:`);
  for (const ep of state.observed.values()) {
    log(`  [${ep.kind}] ${ep.method} ${new URL(ep.url).pathname}`);
  }

  if (state.listingEndpoint) {
    log(
      `listing endpoint: ${state.listingEndpoint.method} ${state.listingEndpoint.url.slice(0, 140)}`,
    );
    log(
      `page 1: ${state.itemsById.size} products` +
        (state.totalCount !== null ? ` (total reported: ${state.totalCount})` : ""),
    );

    for (let pageN = 2; pageN <= MAX_PAGES; pageN++) {
      const before = state.itemsById.size;
      try {
        const { items, totalCount } = await replayListingPage(context, state.listingEndpoint, pageN);
        if (totalCount !== null) state.totalCount = totalCount;
        mergeItems(state, items);
      } catch (e) {
        warn(`pagination stopped at page ${pageN}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      const added = state.itemsById.size - before;
      log(`page ${pageN}: +${added} (total ${state.itemsById.size}${state.totalCount !== null ? `/${state.totalCount}` : ""})`);
      if (added === 0) break;
      if (state.totalCount !== null && state.itemsById.size >= state.totalCount) break;
      await sleep(jitter(600, 1200));
    }
  } else {
    warn("no listing API detected — falling back to DOM infinite scroll");
    await domInfiniteScroll(page, state);
  }

  // Union with DOM links in any case (cheap; dedup by itemId).
  mergeItems(state, await harvestDomLinks(page));

  return {
    brandSlug,
    brandName,
    items: Array.from(state.itemsById.values()),
    listingEndpoint: state.listingEndpoint,
    observedEndpoints: Array.from(state.observed.values()),
  };
}
