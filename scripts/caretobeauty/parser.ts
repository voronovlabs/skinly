/**
 * Care to Beauty · извлечение данных товара.
 *
 * DOM (по факту, SSR): после краткого интро идут секции-заголовки:
 *   Product Description → Characteristics → Main Ingredients → How to use →
 *   [Ingredients / Full Ingredients List] → Safety Warning →
 *   Manufacturer Information → Videos → …
 *
 * Важно про две РАЗНЫЕ секции «ингредиентов»:
 *   • «Main Ingredients» — МАРКЕТИНГ (буллеты «Glycerin draws moisture…»),
 *     это НЕ INCI и в ingredients_raw попадать НЕ должно;
 *   • «Ingredients» / «Full Ingredients List» — реальный INCI-список
 *     (Aqua, Glycerin, …). Часто его на странице вообще нет.
 *
 * Поэтому:
 *   description     = ТОЛЬКО секция «Product Description» (до следующего
 *                     заголовка). Не вся страница.
 *   ingredients_raw = ТОЛЬКО реальный INCI из секции «Ingredients»/«Full
 *                     Ingredients List». Нет такой секции / не похоже на INCI
 *                     → NULL (никакого пояснительного текста).
 *
 * Порядок извлечения: meta/OG → JSON-LD → структурный HTML по заголовкам →
 * fallback regex. Без хрупких CSS-селекторов.
 */

export interface C2BProduct {
  ean: string | null;
  brand: string | null;
  name: string | null;
  imageUrl: string | null;
  description: string | null;
  category: string | null;
  volume: string | null;
  ingredientsRaw: string | null;
  url: string | null;
  itemGroupId: string | null;
  retailerItemId: string | null;
}

/* ───────── entities ───────── */

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
}

/**
 * Блок-ориентированное превращение HTML в текст: границы блоков (p/div/li/
 * h1-6/br/section) → перевод строки. Так заголовки секций оказываются на
 * отдельных строках, и описание можно резать строго по ним. Внутри-строчные
 * пробелы схлопываются, пустые строки сжимаются до одной.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    // только БЛОЧНЫЕ границы → перевод строки (inline strong/span НЕ ломаем,
    // иначе предложение рвётся посередине).
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|section|tr|table)>/gi, "\n")
    .replace(/<(?:h[1-6]|p|div|li|section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  const out: string[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.replace(/[ \t ]+/g, " ").trim();
    if (line === "") {
      if (out.length && out[out.length - 1] !== "") out.push("");
    } else out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ───────── meta ───────── */

export function metaContent(html: string, prop: string): string | null {
  const propEsc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<meta\\b[^>]*\\bproperty=["']${propEsc}["'][^>]*>`, "i").exec(html)?.[0];
  if (!tag) return null;
  const c = /\bcontent=["']([^"']*)["']/i.exec(tag);
  const v = c ? decodeEntities(c[1]).trim() : "";
  return v || null;
}

/* ───────── JSON-LD ───────── */

type JsonLdNode = Record<string, unknown>;
function parseJsonLdProduct(html: string): JsonLdNode | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes: JsonLdNode[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const o of arr) {
        if (o && typeof o === "object") {
          const g = (o as JsonLdNode)["@graph"];
          if (Array.isArray(g)) nodes.push(...(g as JsonLdNode[]));
          else nodes.push(o as JsonLdNode);
        }
      }
    } catch {
      /* битый JSON-LD */
    }
  }
  const isProduct = (t: unknown): boolean =>
    t === "Product" || (Array.isArray(t) && t.includes("Product"));
  return nodes.find((nd) => isProduct(nd["@type"])) ?? null;
}
function jsonLdString(v: unknown): string | null {
  if (typeof v === "string") return decodeEntities(v).trim() || null;
  if (Array.isArray(v) && v.length) return jsonLdString(v[0]);
  if (v && typeof v === "object") {
    const o = v as JsonLdNode;
    if (typeof o.name === "string") return decodeEntities(o.name).trim() || null;
    if (typeof o.url === "string") return o.url;
  }
  return null;
}

/* ───────── секции ───────── */

// Любой из этих заголовков завершает секцию «Product Description».
const STOP_HEADINGS = [
  "Characteristics",
  "Main Ingredients",
  "Full Ingredients List",
  "Ingredients",
  "How to use",
  "How to Use",
  "Directions",
  "Safety Warning",
  "Safety Information",
  "Manufacturer Information",
  "Additional Information",
  "Videos",
  "Articles about",
  "Reviews",
  "Why shop",
  "Subscribe our",
  "Download Care to Beauty",
];

function indexOfCI(haystackLower: string, needle: string, from: number): number {
  return haystackLower.indexOf(needle.toLowerCase(), from);
}

/** Дедуп одинаковых абзацев, тримминг, склейка через пустую строку. */
function cleanParagraphs(s: string): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of s.split(/\n+/)) {
    const t = p.replace(/\s+/g, " ").trim().replace(/^[•*\-\s]+/, "").trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  const res = out.join("\n\n").trim();
  return res.length >= 10 ? res : null;
}

/** Описание = ТОЛЬКО секция «Product Description» до следующего заголовка. */
function extractDescription(text: string): string | null {
  const lower = text.toLowerCase();
  const h = lower.indexOf("product description");
  if (h < 0) return null;
  const start = h + "product description".length;
  let end = text.length;
  for (const stop of STOP_HEADINGS) {
    const i = indexOfCI(lower, stop, start);
    if (i >= 0 && i < end) end = i;
  }
  return cleanParagraphs(text.slice(start, end));
}

const DISCLAIMER_RE =
  /Care to Beauty updates the product ingredient listings periodically[\s\S]*?before using\.?/gi;
const DISCLAIMER_RE2 =
  /the ingredients list might be changed[\s\S]*?packaging[\s\S]*?using\.?/gi;

const INCI_MARKER =
  /\b(aqua|water|eau|glycerin|glycerine|parfum|fragrance|alcohol|sodium|cetearyl|cetyl|dimethicone|butylene|propylene|glycol|tocopher|citric acid|niacinamide|phenoxyethanol|caprylic|stearyl|panthenol|xanthan|squalane|paraffinum|butyrospermum|ci \d|carbomer)\b/i;

/** Очистка кандидата INCI: убрать дисклеймер, проверить, что это реально INCI. */
function cleanInciCandidate(s: string): string | null {
  let t = s.replace(DISCLAIMER_RE, " ").replace(DISCLAIMER_RE2, " ");
  t = t.replace(/\s+/g, " ").trim().replace(/^[\s.,;:*•\-]+/, "").replace(/\s*\.\s*$/, "").trim();
  if (t.length < 12) return null;
  const commas = (t.match(/,/g) ?? []).length;
  const looksInci = INCI_MARKER.test(t) || /^(aqua|water|eau)\b/i.test(t);
  // INCI = список с запятыми + типичные токены. Иначе это маркетинг/дисклеймер.
  return commas >= 2 && looksInci ? t : null;
}

/**
 * INCI = ТОЛЬКО реальная секция «Ingredients» / «Full Ingredients List»
 * (НЕ «Main Ingredients», НЕ навигация). Берём после заголовка, режем
 * дисклеймер, валидируем как INCI. Нет такой секции / не INCI → NULL.
 */
function extractIngredients(text: string): string | null {
  const lower = text.toLowerCase();
  // ищем строго ПОСЛЕ начала описания, чтобы не цеплять верхнюю навигацию
  const from = Math.max(0, lower.indexOf("product description"));
  const re = /\bingredients\b/gi;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    const pre = lower.slice(Math.max(0, idx - 6), idx);
    if (/(main|top)\s*$/.test(pre)) continue; // «Main/Top Ingredients» — не INCI
    let end = text.length;
    for (const stop of [
      "Safety Warning", "Safety Information", "Manufacturer Information",
      "Additional Information", "How to use", "Directions", "Videos",
      "Reviews", "Why shop", "Subscribe our", "Download Care to Beauty",
      "Characteristics", "Main Ingredients",
    ]) {
      const i = indexOfCI(lower, stop, idx + m[0].length);
      if (i >= 0 && i < end) end = i;
    }
    const inci = cleanInciCandidate(text.slice(idx + m[0].length, end));
    if (inci) return inci;
  }
  return null;
}

/* ───────── volume / image ───────── */

function extractVolume(name: string | null): string | null {
  if (!name) return null;
  const ml = name.match(/(\d+(?:[.,]\d+)?)\s?ml\b/i);
  if (ml) return ml[0].replace(/\s+/g, "");
  const g = name.match(/(\d+(?:[.,]\d+)?)\s?g(?:r)?\b/i);
  if (g) return g[0].replace(/\s+/g, "");
  const oz = name.match(/(\d+(?:[.,]\d+)?)\s?(?:fl\.?\s?oz|oz)\b/i);
  if (oz) return oz[0].replace(/\s+/g, "");
  return null;
}
function extractBodyImage(html: string): string | null {
  const m = /<img[^>]+src=["']([^"']*media\/catalog\/product[^"']+)["']/i.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

/* ───────── main ───────── */

export function parseProduct(html: string, fallbackUrl: string): C2BProduct {
  const text = htmlToText(html);
  const ld = parseJsonLdProduct(html);

  const ean =
    metaContent(html, "product:gtin") ??
    (ld && typeof ld.gtin13 === "string" ? ld.gtin13 : null) ??
    (ld && typeof ld.gtin === "string" ? ld.gtin : null);

  const titleTag = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const name =
    metaContent(html, "og:title") ??
    (ld ? jsonLdString(ld.name) : null) ??
    (titleTag ? decodeEntities(titleTag).trim() : null);

  const brand = metaContent(html, "og:brand") ?? (ld ? jsonLdString(ld.brand) : null);
  const imageUrl =
    metaContent(html, "og:image") ?? (ld ? jsonLdString(ld.image) : null) ?? extractBodyImage(html);
  const category = metaContent(html, "product:category") ?? (ld ? jsonLdString(ld.category) : null);

  // description: ТОЛЬКО секция; fallback — короткий og:description (НЕ вся
  // страница, НЕ длинный JSON-LD).
  const description = extractDescription(text) ?? metaContent(html, "og:description");

  return {
    ean,
    brand,
    name,
    imageUrl,
    description: description && description.length > 0 ? description : null,
    category,
    volume: extractVolume(name),
    ingredientsRaw: extractIngredients(text), // NULL, если реального INCI нет
    url: metaContent(html, "og:url") ?? fallbackUrl,
    itemGroupId: metaContent(html, "product:item_group_id"),
    retailerItemId: metaContent(html, "product:retailer_item_id"),
  };
}
