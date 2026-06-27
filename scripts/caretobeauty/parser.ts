/**
 * Care to Beauty · извлечение данных товара.
 *
 * Порядок (robust → fallback), без хрупких CSS-селекторов:
 *   1. OpenGraph / product:* мета     (gtin, brand, title, image, category)
 *   2. JSON-LD (application/ld+json)   (name/brand/image/description/gtin)
 *   3. структурный HTML по заголовкам  (Product Description, Ingredients)
 *   4. fallback-регэкспы               (объём из названия и т.п.)
 *
 * Значения возвращаются СЫРЫМИ (без нормализации). Любое поле — best-effort:
 * не нашли → null.
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

/* ───────── text utils ───────── */

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

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/* ───────── (1) meta ───────── */

export function metaContent(html: string, prop: string): string | null {
  const propEsc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagRe = new RegExp(`<meta\\b[^>]*\\bproperty=["']${propEsc}["'][^>]*>`, "i");
  const tag = tagRe.exec(html)?.[0];
  if (!tag) return null;
  const c = /\bcontent=["']([^"']*)["']/i.exec(tag);
  const v = c ? decodeEntities(c[1]).trim() : "";
  return v || null;
}

/* ───────── (2) JSON-LD ───────── */

type JsonLdNode = Record<string, unknown>;

function parseJsonLdProduct(html: string): JsonLdNode | null {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes: JsonLdNode[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const o of arr) {
        if (o && typeof o === "object") {
          const graph = (o as JsonLdNode)["@graph"];
          if (Array.isArray(graph)) nodes.push(...(graph as JsonLdNode[]));
          else nodes.push(o as JsonLdNode);
        }
      }
    } catch {
      /* битый JSON-LD — пропускаем */
    }
  }
  const isProduct = (t: unknown): boolean =>
    t === "Product" || (Array.isArray(t) && t.includes("Product"));
  return nodes.find((n) => isProduct(n["@type"])) ?? null;
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

/* ───────── (3) structured HTML ───────── */

const DESC_STOP =
  "Characteristics|Main Ingredients|How to use|Ingredients|Safety Warning|Manufacturer Information|Videos|Articles about|Subscribe";

function extractDescription(text: string): string | null {
  const m = new RegExp(
    `Product Description\\s+([\\s\\S]*?)(?:\\s+(?:${DESC_STOP})\\b|$)`,
    "i",
  ).exec(text);
  const v = m?.[1]?.trim();
  return v && v.length >= 10 ? v : null;
}

const INCI_MARKER =
  /\b(aqua|water|glycerin|glycerine|parfum|fragrance|alcohol|sodium|cetearyl|cetyl|dimethicone|butylene|propylene|glycol|tocopher|citric acid|niacinamide|phenoxyethanol|caprylic|stearyl|panthenol|xanthan|squalane|ci \d|carbomer)\b/i;

/**
 * INCI-блок: на странице это самый «плотный» по запятым латинский фрагмент,
 * содержащий типичные INCI-маркеры. Режем текст на «предложения» по `. `
 * (внутри INCI-списка точек-с-пробелом обычно нет) и берём фрагмент с
 * максимумом запятых среди тех, что похожи на состав.
 */
function extractIngredients(text: string): string | null {
  const chunks = text.split(/\.\s+/);
  let best: string | null = null;
  let bestCommas = 0;
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (chunk.length < 40) continue;
    const commas = (chunk.match(/,/g) ?? []).length;
    if (commas < 5) continue;
    if (!INCI_MARKER.test(chunk)) continue;
    // INCI — латиница + типичная пунктуация; отсекаем явно текстовые абзацы
    const latinRatio =
      (chunk.match(/[A-Za-z]/g) ?? []).length / Math.max(chunk.length, 1);
    if (latinRatio < 0.5) continue;
    if (commas > bestCommas) {
      bestCommas = commas;
      best = chunk.replace(/\s+/g, " ").trim();
    }
  }
  return best;
}

/* ───────── (4) fallback regex ───────── */

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
  // первая product-картинка из каталога (самый крупный вариант, как есть)
  const m = /<img[^>]+src=["']([^"']*media\/catalog\/product[^"']+)["']/i.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

/* ───────── main ───────── */

export function parseProduct(html: string, fallbackUrl: string): C2BProduct {
  const text = stripTags(html);
  const ld = parseJsonLdProduct(html);

  const ean =
    metaContent(html, "product:gtin") ??
    (ld && typeof ld.gtin13 === "string" ? ld.gtin13 : null) ??
    (ld && typeof ld.gtin === "string" ? ld.gtin : null);

  const name =
    metaContent(html, "og:title") ??
    (ld ? jsonLdString(ld.name) : null) ??
    (/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]
      ? decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(html)![1]).trim()
      : null);

  const brand =
    metaContent(html, "og:brand") ??
    (ld ? jsonLdString(ld.brand) : null);

  const imageUrl =
    metaContent(html, "og:image") ??
    (ld ? jsonLdString(ld.image) : null) ??
    extractBodyImage(html);

  const category =
    metaContent(html, "product:category") ??
    (ld ? jsonLdString(ld.category) : null);

  // описание: самый полный из (секция HTML, JSON-LD, og:description)
  const descCandidates = [
    extractDescription(text),
    ld && typeof ld.description === "string" ? decodeEntities(ld.description).trim() : null,
    metaContent(html, "og:description"),
  ].filter((v): v is string => !!v && v.length > 0);
  descCandidates.sort((a, b) => b.length - a.length);
  const description = descCandidates[0] ?? null;

  return {
    ean,
    brand,
    name,
    imageUrl,
    description,
    category,
    volume: extractVolume(name),
    ingredientsRaw: extractIngredients(text),
    url: metaContent(html, "og:url") ?? fallbackUrl,
    itemGroupId: metaContent(html, "product:item_group_id"),
    retailerItemId: metaContent(html, "product:retailer_item_id"),
  };
}
