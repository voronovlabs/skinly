/**
 * goldapple.ru scraper — full product card.
 *
 * Strategy:
 *  1. Bootstrap: open the FIRST product page in Chromium and sniff every
 *     JSON XHR whose url/body references the itemId (observed 2025:
 *     GET goldapple.ru/front/api/catalog/product-card[/...]?itemId=...).
 *     Each such request becomes a template with an `{itemId}` placeholder.
 *  2. All remaining products are fetched by replaying those templates via
 *     `context.request` (same cookie jar, no page navigation → fast & polite).
 *  3. Fallback (no templates / empty API result): navigate to the product
 *     page and extract JSON-LD + app state + DOM text.
 */

import type { BrowserContext, Page, Response } from "playwright";
import type {
  BrandListingItem,
  GoldAppleProduct,
  ProductEndpointTemplate,
} from "./types";
import { log, sleep, waitForChallenge, warn } from "./client";
import type { GaClient } from "./client";
import {
  deepFindNumber,
  deepFindString,
  deepWalk,
  isRecord,
  parseNumber,
  resolveImageTemplate,
  stripHtml,
} from "./json";
import type { JsonRecord } from "./json";
import { extractPrice } from "./brand";

const API_PATH_RE = /\/(front\/)?api\//i;
const IGNORE_HOSTS_RE = /yandex|google|gtm|mindbox|criteo|vk\.com|top-fwz|sentry/i;

// ---------------------------------------------------------------------------
// 1. bootstrap: discover product-card endpoints on the first product
// ---------------------------------------------------------------------------

export interface ProductBootstrap {
  templates: ProductEndpointTemplate[];
  /** API payloads already captured for the bootstrap product itself. */
  firstProductRaw: Record<string, unknown>;
}

export async function bootstrapProductEndpoints(
  client: GaClient,
  firstItem: BrandListingItem,
): Promise<ProductBootstrap> {
  const { page } = client;
  const itemId = firstItem.itemId;
  const templates: ProductEndpointTemplate[] = [];
  const firstProductRaw: Record<string, unknown> = {};
  const seen = new Set<string>();

  const onResponse = (resp: Response) => {
    void (async () => {
      try {
        const url = resp.url();
        if (IGNORE_HOSTS_RE.test(url) || !API_PATH_RE.test(url)) return;
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("json") || resp.status() >= 400) return;

        const req = resp.request();
        const postData = req.postData();
        const mentionsItem = url.includes(itemId) || (postData?.includes(itemId) ?? false);
        if (!mentionsItem) return;

        const key = `${req.method()} ${new URL(url).pathname}`;
        if (seen.has(key)) return;
        seen.add(key);

        const json: unknown = await resp.json().catch(() => null);
        if (json === null) return;

        templates.push({
          method: req.method(),
          urlTemplate: url.split(itemId).join("{itemId}"),
          postDataTemplate: postData ? postData.split(itemId).join("{itemId}") : null,
        });
        firstProductRaw[new URL(url).pathname] = json;
      } catch {
        /* ignore */
      }
    })();
  };

  page.on("response", onResponse);
  try {
    log(`bootstrap: opening first product to discover card endpoints: ${firstItem.url}`);
    await page.goto(firstItem.url, { waitUntil: "domcontentloaded" });
    await waitForChallenge(page);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await sleep(1500);
  } finally {
    page.off("response", onResponse);
  }

  log(`bootstrap: ${templates.length} product-card endpoint template(s) discovered:`);
  for (const t of templates) log(`  ${t.method} ${t.urlTemplate.slice(0, 140)}`);
  if (templates.length === 0) {
    warn("bootstrap: no card API found — every product will use DOM fallback (slower)");
  }

  return { templates, firstProductRaw };
}

// ---------------------------------------------------------------------------
// 2. API replay for a given itemId
// ---------------------------------------------------------------------------

export async function fetchProductViaApi(
  context: BrowserContext,
  templates: ProductEndpointTemplate[],
  itemId: string,
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (const t of templates) {
    const url = t.urlTemplate.split("{itemId}").join(itemId);
    try {
      const resp =
        t.method.toUpperCase() === "GET"
          ? await context.request.get(url, { headers: { accept: "application/json" } })
          : await context.request.post(url, {
              headers: { accept: "application/json", "content-type": "application/json" },
              data: t.postDataTemplate
                ? t.postDataTemplate.split("{itemId}").join(itemId)
                : undefined,
            });
      if (!resp.ok()) continue;
      merged[new URL(url).pathname] = await resp.json();
    } catch {
      /* individual endpoint failure is non-fatal */
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// 3. DOM fallback
// ---------------------------------------------------------------------------

export interface DomExtract {
  ldjson: unknown[];
  appState: unknown;
  h1: string | null;
  bodyText: string;
}

export async function fetchProductViaDom(page: Page, url: string): Promise<DomExtract> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForChallenge(page);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await sleep(800);

  return page.evaluate(() => {
    const ldjson: unknown[] = [];
    for (const s of Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )) {
      try {
        ldjson.push(JSON.parse(s.textContent ?? "null"));
      } catch {
        /* ignore */
      }
    }
    let appState: unknown = null;
    try {
      const w = window as unknown as Record<string, unknown>;
      const raw = w.__NUXT__ ?? w.__NUXT_DATA__ ?? w.__INITIAL_STATE__ ?? null;
      appState = raw ? JSON.parse(JSON.stringify(raw)) : null;
    } catch {
      appState = null;
    }
    return {
      ldjson,
      appState,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      bodyText: document.body?.innerText?.slice(0, 20_000) ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// 4. normalization
// ---------------------------------------------------------------------------

const ATTR_MAP: Array<{ re: RegExp; field: keyof AttrFields }> = [
  { re: /объ[её]м|volume|вес|масса|weight|размер|size/i, field: "volume" },
  { re: /страна|country|производств/i, field: "country" },
  { re: /тип кожи|skin ?type/i, field: "skin_type" },
  { re: /тип продукта|тип средства|категория|product ?type/i, field: "product_type" },
  { re: /действие|эффект|назначение|effect|action/i, field: "effect" },
  { re: /возраст|age/i, field: "age" },
  { re: /лини(я|и)|линейка|коллекция|collection|line/i, field: "line" },
  { re: /^пол$|gender|для кого/i, field: "gender" },
];

interface AttrFields {
  volume: string | null;
  country: string | null;
  skin_type: string | null;
  product_type: string | null;
  effect: string | null;
  age: string | null;
  line: string | null;
  gender: string | null;
}

function classifySection(title: string): "ingredients" | "usage" | "description" | null {
  if (/состав|ingredient|inci/i.test(title)) return "ingredients";
  if (/примен|использ|способ|apply|usage|how to/i.test(title)) return "usage";
  if (/описан|о продукте|description|about/i.test(title)) return "description";
  return null;
}

/** Collect {title, content} section pairs anywhere in the payload. */
function collectSections(root: unknown): Array<{ title: string; content: string }> {
  const out: Array<{ title: string; content: string }> = [];
  deepWalk(root, (node) => {
    if (!isRecord(node)) return undefined;
    const title = [node.title, node.name, node.heading, node.subtitle].find(
      (v): v is string => typeof v === "string" && v.length > 1 && v.length < 120,
    );
    const content = [node.text, node.content, node.value, node.description, node.html].find(
      (v): v is string => typeof v === "string" && v.trim().length > 20,
    );
    if (title && content) out.push({ title, content: stripHtml(content) });
    return undefined;
  });
  return out;
}

/** Collect flat key→value attributes from typical shapes. */
function collectAttributes(root: unknown): Record<string, string> {
  const attrs: Record<string, string> = {};
  deepWalk(root, (node, key) => {
    // shape A: [{name/key/title, value/text}]
    if (isRecord(node)) {
      const k = [node.name, node.key, node.title, node.label].find(
        (v): v is string => typeof v === "string" && v.length > 0 && v.length < 80,
      );
      const vRaw = node.value ?? node.text ?? node.val;
      const v =
        typeof vRaw === "string"
          ? vRaw
          : typeof vRaw === "number" || typeof vRaw === "boolean"
            ? String(vRaw)
            : Array.isArray(vRaw) && vRaw.every((x) => typeof x === "string")
              ? vRaw.join(", ")
              : null;
      if (k && v !== null && v.length < 600) attrs[stripHtml(k)] = stripHtml(v);
    }
    // shape B: {attributes|properties|parameters: {k: v}}
    if (
      key !== null &&
      /attribute|propert|parameter|characterist|спецификац/i.test(key) &&
      isRecord(node)
    ) {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string" && v.length < 600) attrs[k] = stripHtml(v);
        else if (typeof v === "number" || typeof v === "boolean") attrs[k] = String(v);
      }
    }
    return undefined;
  });
  return attrs;
}

function collectImages(root: unknown): string[] {
  const urls = new Set<string>();
  deepWalk(root, (node, key) => {
    if (typeof node !== "string") return undefined;
    const keyish = key !== null && /image|picture|photo|img/i.test(key);
    const valish = /pcdn\.goldapple|\.(jpe?g|png|webp)(\?|$)/i.test(node);
    if ((keyish || valish) && /^(https?:)?\/\//.test(node)) {
      urls.add(resolveImageTemplate(node.startsWith("//") ? `https:${node}` : node));
    }
    return undefined;
  });
  return Array.from(urls).slice(0, 25);
}

function collectTags(root: unknown): string[] {
  const tags = new Set<string>();
  deepWalk(root, (node, key) => {
    if (key !== null && /^(labels?|badges?|tags?|stickers?)$/i.test(key)) {
      if (typeof node === "string" && node.length < 60) tags.add(node);
      if (Array.isArray(node)) {
        for (const t of node) {
          if (typeof t === "string" && t.length < 60) tags.add(t);
          else if (isRecord(t) && typeof t.text === "string") tags.add(t.text);
          else if (isRecord(t) && typeof t.name === "string") tags.add(t.name);
        }
      }
      return false;
    }
    return undefined;
  });
  return Array.from(tags).slice(0, 20);
}

function ldjsonProduct(ldjson: unknown[]): JsonRecord | null {
  for (const entry of ldjson) {
    const list = Array.isArray(entry) ? entry : [entry];
    for (const e of list) {
      if (isRecord(e) && e["@type"] === "Product") return e;
    }
  }
  return null;
}

function ldjsonBreadcrumbs(ldjson: unknown[]): string[] {
  for (const entry of ldjson) {
    const list = Array.isArray(entry) ? entry : [entry];
    for (const e of list) {
      if (isRecord(e) && e["@type"] === "BreadcrumbList" && Array.isArray(e.itemListElement)) {
        return e.itemListElement
          .map((el) => (isRecord(el) && typeof el.name === "string" ? el.name : null))
          .filter((n): n is string => n !== null);
      }
    }
  }
  return [];
}

/** Find the first node stored under a `price`-ish key. */
function findPriceNode(root: unknown): unknown {
  let found: unknown = null;
  deepWalk(root, (node, key) => {
    if (found !== null) return false;
    if (key !== null && /^prices?$/i.test(key) && node !== null && node !== undefined) {
      found = node;
      return false;
    }
    return undefined;
  });
  return found;
}

export function buildProduct(args: {
  item: BrandListingItem;
  brandFallback: string | null;
  apiRaw: Record<string, unknown>;
  dom: DomExtract | null;
}): GoldAppleProduct {
  const { item, brandFallback, apiRaw, dom } = args;
  const api: unknown = Object.keys(apiRaw).length > 0 ? apiRaw : null;
  const ld = dom ? ldjsonProduct(dom.ldjson) : null;
  const sources: unknown[] = [api, ld, dom?.appState ?? null, item.raw].filter(
    (s) => s !== null,
  );

  const pick = (fn: (src: unknown) => string | null): string | null => {
    for (const s of sources) {
      const v = fn(s);
      if (v) return v;
    }
    return null;
  };
  const pickNum = (fn: (src: unknown) => number | null): number | null => {
    for (const s of sources) {
      const v = fn(s);
      if (v !== null) return v;
    }
    return null;
  };

  // --- name / brand / ids ---
  const product_name =
    pick((s) => deepFindString(s, ["productName", "productTitle"], 2)) ??
    (typeof ld?.name === "string" ? ld.name : null) ??
    item.name ??
    dom?.h1 ??
    pick((s) => deepFindString(s, ["name", "title"], 2));

  const brand =
    pick((s) => deepFindString(s, ["brandName"], 2)) ??
    pick((s) => {
      let b: string | null = null;
      deepWalk(s, (node, key) => {
        if (b) return false;
        if (key === "brand") {
          if (typeof node === "string") b = node;
          else if (isRecord(node) && typeof node.name === "string") b = node.name;
        }
        return undefined;
      });
      return b;
    }) ??
    item.brand ??
    brandFallback;

  const sku = pick((s) => deepFindString(s, ["sku", "article", "vendorCode", "articleNumber"]));
  const offer_id = pick((s) => deepFindString(s, ["offerId", "offer_id"]));

  // --- price ---
  const priceNode = api !== null ? findPriceNode(api) : null;
  const price =
    extractPrice(priceNode, "actual") ??
    extractPrice(item.raw !== null ? findPriceNode(item.raw) : null, "actual") ??
    item.price ??
    (ld ? deepFindNumber(ld, ["price", "lowPrice"]) : null);
  const old_price =
    extractPrice(priceNode, "old") ??
    extractPrice(item.raw !== null ? findPriceNode(item.raw) : null, "old") ??
    item.oldPrice;
  const discount =
    price !== null && old_price !== null && old_price > price
      ? Math.round((1 - price / old_price) * 100)
      : null;
  const currency =
    pick((s) => deepFindString(s, ["currency", "priceCurrency", "currencyCode"])) ?? "RUB";

  // --- rating / reviews / availability ---
  const rating = pickNum((s) =>
    deepFindNumber(s, ["ratingValue", "averageRating", "rating", "averageScore"]),
  );
  const reviews_count = pickNum((s) =>
    deepFindNumber(s, ["reviewsCount", "reviewCount", "ratingCount", "reviewsQuantity", "votes"]),
  );

  let availability: boolean | null = item.inStock;
  deepWalk(api, (node, key) => {
    if (availability !== null) return false;
    if (key !== null && /^(instock|available|isavailable)$/i.test(key) && typeof node === "boolean") {
      availability = node;
      return false;
    }
    return undefined;
  });
  if (availability === null && ld) {
    const av = deepFindString(ld, ["availability"]);
    if (av) availability = /InStock/i.test(av);
  }

  // --- sections: description / usage / ingredients ---
  let description: string | null = null;
  let usage: string | null = null;
  let ingredients: string | null = null;

  for (const src of sources) {
    for (const sec of collectSections(src)) {
      const kind = classifySection(sec.title);
      if (kind === "ingredients" && !ingredients) ingredients = sec.content;
      else if (kind === "usage" && !usage) usage = sec.content;
      else if (kind === "description" && !description) description = sec.content;
    }
    if (description && usage && ingredients) break;
  }

  // direct keys as backup
  ingredients =
    ingredients ??
    pick((s) => deepFindString(s, ["ingredients", "composition", "inci", "sostav"], 20));
  usage = usage ?? pick((s) => deepFindString(s, ["applying", "application", "usage", "howToUse"], 20));
  description =
    description ?? pick((s) => deepFindString(s, ["description", "productDescription"], 20));
  if (description) description = stripHtml(description);
  if (usage) usage = stripHtml(usage);
  if (ingredients) ingredients = stripHtml(ingredients);

  // heuristic: a long string that looks like an INCI list
  if (!ingredients) {
    deepWalk(api, (node) => {
      if (ingredients) return false;
      if (
        typeof node === "string" &&
        node.length > 80 &&
        /aqua|water\s*[/,]|parfum|glycerin|состав:/i.test(node) &&
        (node.match(/,/g)?.length ?? 0) >= 5
      ) {
        ingredients = stripHtml(node);
        return false;
      }
      return undefined;
    });
  }

  // --- attributes + mapped fields ---
  const attributes: Record<string, string> = {};
  for (const src of sources) Object.assign(attributes, collectAttributes(src));

  const mapped: AttrFields = {
    volume: null,
    country: null,
    skin_type: null,
    product_type: null,
    effect: null,
    age: null,
    line: null,
    gender: null,
  };
  for (const [k, v] of Object.entries(attributes)) {
    for (const { re, field } of ATTR_MAP) {
      if (re.test(k) && !mapped[field]) mapped[field] = v;
    }
  }
  // volume fallback from the product name: "… 50 мл"
  if (!mapped.volume && product_name) {
    const m = /(\d+(?:[.,]\d+)?)\s*(мл|ml|г|g|шт|л)\b/i.exec(product_name);
    if (m) mapped.volume = `${m[1]} ${m[2]}`;
  }

  // --- breadcrumbs / category ---
  let breadcrumbs = dom ? ldjsonBreadcrumbs(dom.ldjson) : [];
  if (breadcrumbs.length === 0) {
    deepWalk(api, (node, key) => {
      if (breadcrumbs.length > 0) return false;
      if (key !== null && /breadcrumb/i.test(key) && Array.isArray(node)) {
        breadcrumbs = node
          .map((b) => (isRecord(b) && typeof b.name === "string" ? b.name : null))
          .filter((n): n is string => n !== null);
        return false;
      }
      return undefined;
    });
  }
  const category =
    breadcrumbs.filter((b) => b !== product_name).pop() ??
    pick((s) => deepFindString(s, ["categoryName", "category"])) ??
    mapped.product_type;

  // --- images / tags ---
  const imageSources: unknown[] = [api, ld, item.raw].filter((s) => s !== null);
  const images = imageSources.flatMap((s) => collectImages(s));
  const tags = [...collectTags(api), ...collectTags(item.raw)];

  return {
    source_url: item.url,
    product_id: item.itemId,
    sku,
    offer_id,
    brand,
    product_name,
    category,
    breadcrumbs,
    price,
    old_price,
    discount,
    currency,
    availability,
    rating,
    reviews_count,
    images: Array.from(new Set(images)).slice(0, 25),
    description,
    usage,
    ingredients,
    volume: mapped.volume,
    country: mapped.country,
    skin_type: mapped.skin_type,
    product_type: mapped.product_type,
    effect: mapped.effect,
    age: mapped.age,
    line: mapped.line,
    gender: mapped.gender,
    tags: Array.from(new Set(tags)),
    attributes,
    raw_json: {
      listing: item.raw,
      api: Object.keys(apiRaw).length > 0 ? apiRaw : null,
      ldjson: dom?.ldjson ?? null,
    },
    scraped_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 5. orchestration for a single product
// ---------------------------------------------------------------------------

export async function scrapeProduct(args: {
  client: GaClient;
  item: BrandListingItem;
  templates: ProductEndpointTemplate[];
  brandFallback: string | null;
  /** Pre-captured API payloads (bootstrap product). */
  precapturedApi?: Record<string, unknown>;
}): Promise<GoldAppleProduct> {
  const { client, item, templates, brandFallback, precapturedApi } = args;

  let apiRaw: Record<string, unknown> = precapturedApi ?? {};
  if (Object.keys(apiRaw).length === 0 && templates.length > 0) {
    apiRaw = await fetchProductViaApi(client.context, templates, item.itemId);
  }

  let dom: DomExtract | null = null;
  const apiUseful =
    Object.keys(apiRaw).length > 0 &&
    deepFindString(apiRaw, ["name", "productName", "title"], 2) !== null;

  if (!apiUseful) {
    dom = await fetchProductViaDom(client.page, item.url);
  }

  const product = buildProduct({ item, brandFallback, apiRaw, dom });
  if (!product.product_name) {
    throw new Error("empty product card (no name extracted via API or DOM)");
  }
  return product;
}
