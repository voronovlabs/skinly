/**
 * goldapple.ru scraper — tolerant JSON helpers.
 *
 * The internal API shape is not guaranteed, so all extraction is done with
 * deep, key-name-based scans instead of hardcoded response paths.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Depth-first walk over any JSON value. Return `false` from visit to stop descending. */
export function deepWalk(
  value: unknown,
  visit: (node: unknown, key: string | null) => boolean | void,
  key: string | null = null,
  depth = 0,
): void {
  if (depth > 20) return;
  if (visit(value, key) === false) return;
  if (Array.isArray(value)) {
    for (const item of value) deepWalk(item, visit, key, depth + 1);
  } else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) deepWalk(v, visit, k, depth + 1);
  }
}

/** "1 799 ₽" / "1799.00" / 1799 → 1799. Returns null for non-numbers. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", ".");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First string value found under one of `keys` (case-insensitive), searched deep. */
export function deepFindString(obj: unknown, keys: string[], minLen = 1): string | null {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  let found: string | null = null;
  deepWalk(obj, (node, key) => {
    if (found) return false;
    if (
      key !== null &&
      wanted.has(key.toLowerCase()) &&
      typeof node === "string" &&
      node.trim().length >= minLen
    ) {
      found = node.trim();
      return false;
    }
    return undefined;
  });
  return found;
}

/** First numeric value found under one of `keys` (case-insensitive), searched deep. */
export function deepFindNumber(obj: unknown, keys: string[]): number | null {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  let found: number | null = null;
  deepWalk(obj, (node, key) => {
    if (found !== null) return false;
    if (key !== null && wanted.has(key.toLowerCase())) {
      const n = parseNumber(node);
      if (n !== null) {
        found = n;
        return false;
      }
    }
    return undefined;
  });
  return found;
}

export function absUrl(url: string, base = "https://goldapple.ru"): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * GA image URLs may be templates like ".../${screen}/${format}".
 * Substitute sensible defaults so the URL is directly usable.
 */
export function resolveImageTemplate(url: string): string {
  return url
    .replace(/\$\{?screen\}?/gi, "fullhd")
    .replace(/\$\{?format\}?/gi, "webp")
    .replace(/\$screen/gi, "fullhd")
    .replace(/\$format/gi, "webp");
}
