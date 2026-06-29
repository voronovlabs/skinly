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

/* ── строгий валидатор INCI ── */

// Маркетинг/инструкция по применению — этих слов в настоящем INCI не бывает.
const APP_WORDS =
  /\b(appl(y|ied|ies)|rinse[sd]?|using|uses?|used|helps?|support(s|ed)?|purif(y|ies|ied)|neutrali[sz]e[sd]?|tone[sd]?|energi[sz](ing|e[sd]?)|moisturi[sz]e[sd]?|hydrate[sd]?|soothe[sd]?|calm(s|ed)?|protect(s|ed)?|improve[sd]?|reduce[sd]?|leaves?|provide[sd]?|designed|formulated|suitable|skin|pores?|redness|acne|morning|evening|wet|lather|managing|manage[sd]?|treatment|regeneration)\b/i;
const PROSE_MARKERS = /(this product|helps to|apply every|such as|while)/i;
// Типичные INCI-маркеры (должен присутствовать хотя бы один).
const INCI_MARKERS =
  /\b(aqua|water|eau|glycerin|glycerine|alcohol|dimethicone|caprylic|sodium|potassium|glycol|extract|seed oil|butter|[a-z]+ic acid|chloride|benzoate|phenoxyethanol|tocopher(ol|yl)|parfum|fragrance|cetearyl|cetyl|niacinamide|squalane|paraffinum|butyrospermum|carbomer|hyaluron|panthenol|xanthan|ci ?\d{4,5})\b/i;

/**
 * Строгая проверка: это РЕАЛЬНЫЙ INCI-список, а не маркетинг/инструкция.
 * Отклоняем прозу (глаголы применения, ≥2 точек, точки с запятой, «this
 * product» и т.п.). Принимаем только список через запятую с INCI-маркерами.
 */
export function isLikelyInci(input: string | null): boolean {
  if (!input) return false;
  const t = input.replace(/\s+/g, " ").trim();
  if (t.length < 12) return false;
  // ── reject: проза ──
  if ((t.match(/\./g) ?? []).length > 1) return false;       // >1 точки = предложения
  if (t.includes(";")) return false;                          // ; = маркетинговые фразы
  if (PROSE_MARKERS.test(t)) return false;
  if (APP_WORDS.test(t)) return false;                        // apply/helps/skin/…
  // ── accept: список + INCI-маркеры ──
  const commas = (t.match(/,/g) ?? []).length;
  if (commas < 3) return false;                               // нужен список токенов
  if (!INCI_MARKERS.test(t)) return false;
  return true;
}

// Заголовок РЕАЛЬНОЙ INCI-секции (на отдельной строке). Только точные
// названия; «Main/Key/Active Ingredients», «How to use», навигация — НЕ сюда.
const INCI_HEADING_RE =
  /(?:^|\n)[ \t#*>•-]*(Full Ingredients List|Ingredients list|Ingredients|Composition|INCI)\b[ \t:.\-*>]*\n?/gi;
// Любой следующий заголовок секции — граница INCI-блока.
const NEXT_HEADING_RE =
  /(?:^|\n)[ \t#*>•-]*(Characteristics|Main Ingredients|Key Ingredients|Active Ingredients|How to use|How to Use|Directions|Safety Warning|Safety Information|Manufacturer Information|Additional Information|Videos|Articles about|Reviews|Why shop|Subscribe our|Download Care to Beauty|Product Description|Full Ingredients List|Ingredients list|Composition|INCI|Ingredients)\b/i;

/**
 * INCI = ТОЛЬКО из секции, точно озаглавленной Ingredients / Full Ingredients
 * List / Ingredients list / Composition / INCI. «Main/Key/Active Ingredients»
 * и инструкции игнорируются. Режем дисклеймер, валидируем isLikelyInci.
 * Не нашли настоящий INCI → NULL.
 */
function extractIngredients(text: string): string | null {
  // искать строго после начала описания → не цеплять верхнюю навигацию
  const from = Math.max(0, text.toLowerCase().indexOf("product description"));
  INCI_HEADING_RE.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = INCI_HEADING_RE.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const next = NEXT_HEADING_RE.exec(rest);
    let body = next ? rest.slice(0, next.index) : rest.slice(0, 4000);
    body = body.replace(DISCLAIMER_RE, " ").replace(DISCLAIMER_RE2, " ");
    const cand = body
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[\s.,;:*•\-]+/, "")
      .replace(/\s*\.\s*$/, "")
      .trim();
    if (isLikelyInci(cand)) return cand;
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
