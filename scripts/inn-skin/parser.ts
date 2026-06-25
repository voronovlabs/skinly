/**
 * Skinly · staging scraper · inn-skin.ru — парсер.
 *
 * inn-skin.ru — SSR Next.js, данные есть прямо в HTML. Парсер намеренно
 * НЕ опирается на хешированные классы Next.js. Он держится за стабильные,
 * контентные маркеры:
 *   - UUID карточки в `/app/cosmetics/<uuid>`
 *   - полная INCI в query-параметре `?ingredients=<urlencoded>`
 *   - ссылка продавца с маркером `?from=inn-skin.ru`
 *   - `<title>NAME — BRAND | Inn-Skin.ru</title>`
 *   - текстовые заголовки «Примерная цена:», «Описание», «Состав»
 *   - имя файла картинки `/uploads/products/<article>_<hash>.webp`
 *
 * Любое поле — best-effort: не нашли → null, скрейп продолжается.
 */

import type { ListingPage, ListingStub } from "./types";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PRODUCT_HREF_RE =
  /\/app\/cosmetics\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/* ───────────────────────── text utils ───────────────────────── */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name] ?? m);
}

/** Снять теги/скрипты, декодировать сущности, схлопнуть пробелы. */
export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/* ───────────────────────── listing ───────────────────────── */

/**
 * Парсит страницу листинга бренда.
 *   - перечисляет UUID карточек (надёжно, по href)
 *   - best-effort вытягивает сырой ярлык категории из текста карточки
 *     (текст вида «<категория><Бренд>» прямо перед именем бренда)
 *   - определяет общее число страниц из «N из M»
 */
export function parseListingPage(html: string, brand: string): ListingPage {
  // 1) Сегментируем HTML по позициям product-href'ов → по карточке на UUID.
  const matches: { uuid: string; index: number }[] = [];
  PRODUCT_HREF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRODUCT_HREF_RE.exec(html)) !== null) {
    matches.push({ uuid: m[1].toLowerCase(), index: m.index });
  }

  const seen = new Set<string>();
  const stubs: ListingStub[] = [];
  for (let i = 0; i < matches.length; i++) {
    const { uuid, index } = matches[i];
    if (seen.has(uuid)) continue;
    seen.add(uuid);

    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const segment = html.slice(index, end);
    const categoryRaw = extractCardCategory(segment, brand);

    stubs.push({
      sourceProductId: uuid,
      sourceUrl: `https://inn-skin.ru/app/cosmetics/${uuid}`,
      categoryRaw,
    });
  }

  return { stubs, totalPages: extractTotalPages(html) };
}

/**
 * Категория из карточки: в листинге текст идёт как «<категория><Бренд>»
 * (например «молочко для лицаUriage»). Бренд известен → берём фрагмент
 * кириллицы/латиницы прямо перед ним.
 */
function extractCardCategory(segment: string, brand: string): string | null {
  const text = stripTags(segment);
  const re = new RegExp(
    `([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё /\\-]{2,40}?)\\s*${escapeRegex(brand)}`,
  );
  const hit = re.exec(text);
  if (!hit) return null;
  const cat = hit[1].trim();
  // Отсекаем явный мусор (цена/служебка попала бы цифрами).
  if (!cat || /\d/.test(cat) || cat.length < 3) return null;
  return cat;
}

function extractTotalPages(html: string): number | null {
  const text = stripTags(html);
  const m = /(\d+)\s+из\s+(\d+)/.exec(text);
  if (m) {
    const total = parseInt(m[2], 10);
    if (Number.isFinite(total) && total > 0) return total;
  }
  return null;
}

/* ───────────────────────── detail ───────────────────────── */

export interface DetailFields {
  productName: string | null;
  brand: string | null;
  priceText: string | null;
  priceValue: number | null;
  ingredientsRaw: string | null;
  description: string | null;
  usage: string | null;
  imageUrl: string | null;
  retailer: string | null;
  retailerArticle: string | null;
  sellerUrl: string | null;
}

export function parseDetailPage(
  html: string,
  knownBrand: string | null,
): DetailFields {
  const text = stripTags(html);

  const { name, brand } = extractTitleNameBrand(html, knownBrand);
  const { priceText, priceValue } = extractPrice(text);
  const ingredientsRaw = extractIngredients(html, text);
  const description = extractDescription(text);
  const imageUrl = extractImageUrl(html);
  const seller = extractSeller(html);
  const article = seller.article ?? extractArticleFromImage(imageUrl);

  return {
    productName: name,
    brand: brand ?? knownBrand,
    priceText,
    priceValue,
    ingredientsRaw,
    description,
    usage: null, // inn-skin держит один блок «Описание»; отдельной инструкции нет
    imageUrl,
    retailer: seller.retailer,
    retailerArticle: article,
    sellerUrl: seller.url,
  };
}

/** `<title>NAME — BRAND | Inn-Skin.ru</title>` → {name, brand}. */
function extractTitleNameBrand(
  html: string,
  knownBrand: string | null,
): { name: string | null; brand: string | null } {
  const tm = /<title>([\s\S]*?)<\/title>/i.exec(html);
  let raw = tm ? decodeEntities(tm[1]).trim() : "";
  // Отрезаем суффикс сайта.
  raw = raw.replace(/\s*\|\s*Inn-?Skin\.ru\s*$/i, "").trim();
  if (!raw) {
    // fallback на <h1>
    const hm = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    raw = hm ? stripTags(hm[1]) : "";
    raw = raw.replace(/\s*\|\s*Inn-?Skin\.ru\s*$/i, "").trim();
  }
  if (!raw) return { name: null, brand: knownBrand };

  // Делим по « — » (em-dash). Бренд — справа.
  const parts = raw.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    const brand = parts[parts.length - 1].trim();
    const name = parts.slice(0, -1).join(" — ").trim();
    return { name: name || null, brand: brand || knownBrand };
  }
  return { name: raw, brand: knownBrand };
}

function extractPrice(text: string): {
  priceText: string | null;
  priceValue: number | null;
} {
  // «Примерная цена: 1 957 ₽» или карточный «≈ 1 957 ₽».
  const m =
    /Примерн[а-я]*\s*цена[:\s]*([\d  \s]+)\s*₽/i.exec(text) ||
    /[≈~]\s*([\d  \s]+)\s*₽/.exec(text);
  if (!m) return { priceText: null, priceValue: null };
  const digits = m[1].replace(/[^\d]/g, "");
  const value = digits ? parseInt(digits, 10) : null;
  return {
    priceText: `${m[1].replace(/\s+/g, " ").trim()} ₽`,
    priceValue: Number.isFinite(value as number) ? value : null,
  };
}

/**
 * INCI: приоритет — query-параметр `ingredients=` (самый чистый источник).
 * Берём самую длинную расшифровку среди всех вхождений (навигационные
 * ссылки идут с пустым параметром). Fallback — текст после «Состав».
 */
function extractIngredients(html: string, text: string): string | null {
  const re = /ingredients=([^"'&)\s]+)/gi;
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const decoded = safeDecodeURIComponent(m[1]).trim();
    if (decoded.length > best.length) best = decoded;
  }
  if (best.length >= 8) return cleanInci(best);

  // Fallback: «Состав <...>» до конца/следующего заголовка.
  const sm = /\bСостав\b[:\s]*([A-Za-z0-9].*)$/.exec(text);
  if (sm) {
    const tail = sm[1].trim();
    if (tail.length >= 8) return cleanInci(tail);
  }
  return null;
}

function cleanInci(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\.\s*$/, "").trim();
}

/** Текст между «Описание» и «Состав». */
function extractDescription(text: string): string | null {
  const m = /\bОписание\b[:\s]*([\s\S]*?)\s*\bСостав\b/.exec(text);
  if (!m) return null;
  const desc = m[1].trim();
  // Защита: если границы «Состав» не было и захватили весь INCI — отбрасываем.
  if (!desc || desc.length > 800) return null;
  return desc;
}

/** Распакованный URL картинки из `_next/image?url=<enc>`. */
function extractImageUrl(html: string): string | null {
  const re = /_next\/image\?url=([^&"'\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const decoded = safeDecodeURIComponent(m[1]);
    if (decoded.includes("/uploads/products/")) return decoded;
  }
  return null;
}

function extractArticleFromImage(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  const m = /\/uploads\/products\/(\d{6,})_/.exec(imageUrl);
  return m ? m[1] : null;
}

/**
 * Ссылка «Сайт продавца» — стабильный маркер `?from=inn-skin.ru`.
 * retailer = домен 2-го уровня, article = первый числовой сегмент пути.
 */
function extractSeller(html: string): {
  url: string | null;
  retailer: string | null;
  article: string | null;
} {
  const m = /https?:\/\/[^\s"'<>]+\?from=inn-skin\.ru/i.exec(html);
  if (!m) return { url: null, retailer: null, article: null };
  const url = decodeEntities(m[0]);

  let retailer: string | null = null;
  let article: string | null = null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    retailer = host.split(".")[0] || host;
    const am = /\/(\d{6,})(?:[-/?]|$)/.exec(u.pathname);
    article = am ? am[1] : null;
  } catch {
    /* ignore */
  }
  return { url, retailer, article };
}

export { UUID_RE };
