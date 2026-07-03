/**
 * goldapple.ru brand scraper — shared types.
 */

/** Normalized product card (final output row). */
export interface GoldAppleProduct {
  source_url: string;
  product_id: string | null;
  sku: string | null;
  offer_id: string | null;
  brand: string | null;
  product_name: string | null;
  category: string | null;
  breadcrumbs: string[];
  price: number | null;
  old_price: number | null;
  /** Percent, e.g. 25 means −25%. */
  discount: number | null;
  currency: string | null;
  availability: boolean | null;
  rating: number | null;
  reviews_count: number | null;
  images: string[];
  description: string | null;
  usage: string | null;
  ingredients: string | null;
  volume: string | null;
  country: string | null;
  skin_type: string | null;
  product_type: string | null;
  effect: string | null;
  age: string | null;
  line: string | null;
  gender: string | null;
  tags: string[];
  /** All raw attributes as flat key → value. */
  attributes: Record<string, string>;
  /** Raw API payloads (keyed by endpoint path) or DOM-extracted state. */
  raw_json: unknown;
  scraped_at: string;
}

/** Item found on the brand listing (page 1..N of PLP). */
export interface BrandListingItem {
  itemId: string;
  /** Absolute product URL. */
  url: string;
  name: string | null;
  brand: string | null;
  price: number | null;
  oldPrice: number | null;
  inStock: boolean | null;
  /** Raw listing object as returned by the API / DOM. */
  raw: unknown;
}

/** A network endpoint discovered at runtime via response interception. */
export interface DiscoveredEndpoint {
  method: string;
  url: string;
  postData: string | null;
  /** Response classification. */
  kind: "listing" | "product" | "other";
}

/** Product-card endpoint template: `{itemId}` placeholder inside url/postData. */
export interface ProductEndpointTemplate {
  method: string;
  urlTemplate: string;
  postDataTemplate: string | null;
}

export interface BrandScrapeResult {
  brandSlug: string;
  brandName: string;
  items: BrandListingItem[];
  /** The listing endpoint that was replayed for pagination (if any). */
  listingEndpoint: DiscoveredEndpoint | null;
  /** All API endpoints observed while loading the brand page. */
  observedEndpoints: DiscoveredEndpoint[];
}

export interface FailedUrl {
  url: string;
  itemId: string | null;
  error: string;
  at: string;
}

export interface CliOptions {
  url: string;
  limit: number | null;
  headful: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  retries: number;
  outDir: string;
  /** Only print discovered endpoints + first listing page, then exit. */
  discoverOnly: boolean;
}
