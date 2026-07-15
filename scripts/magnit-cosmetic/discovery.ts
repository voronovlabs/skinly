/**
 * Discovery: полный список URL товаров — через браузерную сессию
 * (сайт за QRATOR, HTTP-клиент вне браузера блокируется).
 *
 * Основной путь — sitemap `/__sitemap__/products.xml` (браузерный fetch
 * той же сессией). Обход листинга категории `?page=N` — для режима
 * `--category-url` (навигация той же страницей).
 */

import * as cheerio from "cheerio";
import type { Page } from "playwright";
import { browserFetchText, gotoAndWait } from "./browser";
import { BASE_URL, SITEMAP_CATALOG_URL, SITEMAP_PRODUCTS_URL } from "./config";
import { debug, ts } from "./logger";

export interface DiscoveredProduct {
  externalId: string;
  url: string;
  slug: string;
}

const PRODUCT_PATH_RE = /\/product\/(\d+)-([a-z0-9_\-]+)/i;

/** Канонизирует URL карточки: абсолютный, без query/fragment. */
export function canonicalProductUrl(href: string): DiscoveredProduct | null {
  const m = href.match(PRODUCT_PATH_RE);
  if (!m) return null;
  const [, externalId, slug] = m;
  return {
    externalId,
    slug,
    url: `${BASE_URL}/product/${externalId}-${slug}`,
  };
}

/** Все товары из sitemap (браузерный fetch — та же сессия/cookies). */
export async function discoverFromSitemap(page: Page): Promise<DiscoveredProduct[]> {
  ts(`sitemap: fetching ${SITEMAP_PRODUCTS_URL} (через браузерную сессию)`);
  const xml = await browserFetchText(page, SITEMAP_PRODUCTS_URL);
  const out: DiscoveredProduct[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const p = canonicalProductUrl(m[1]);
    if (p) out.push(p);
  }
  ts(`sitemap: ${out.length} product urls`);
  return out;
}

/** Список категорий из sitemap каталога (для отчёта о полноте). */
export async function discoverCategories(page: Page): Promise<string[]> {
  const xml = await browserFetchText(page, SITEMAP_CATALOG_URL);
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (/\/catalog\/\d+-/.test(m[1])) urls.push(m[1]);
  }
  return urls;
}

/* ───────── Репрезентативная выборка (--sample-categories) ───────── */

interface SampleGroup {
  label: string;
  /** Паттерны по slug карточки (латинская транслитерация). */
  slug: RegExp;
  count: number;
}

/**
 * Отбирает из sitemap репрезентативную выборку по группам: лицо, волосы,
 * тело, макияж и не-косметика. Slug карточки — транслит названия, по нему
 * надёжно угадывается тип товара. Порядок в выдаче — как в группах.
 */
export function selectRepresentativeSample(
  products: DiscoveredProduct[],
): { picked: DiscoveredProduct[]; byGroup: Record<string, string[]> } {
  // Группа «лицо» — ТОЛЬКО явные face-маркеры slug (никаких общих
  // ochishch/krem/maska: они встречаются в волосах и быту, из-за чего
  // шампунь Clear с «глубоким очищением» ошибочно попал в «лицо»).
  const groups: SampleGroup[] = [
    { label: "лицо", count: 2, slug: /dlya_litsa|_litsa|krem_dlya_litsa|maska_dlya_litsa|tonik|syvorot|mitsellyar|micellyar/i },
    { label: "волосы", count: 2, slug: /shampun|konditsioner|balzam.*volos|dlya_volos|_d_v_|maska.*volos|hair/i },
    { label: "тело", count: 2, slug: /dlya_dusha|gel_dlya_dusha|krem_dlya_tela|dlya_tela|dezodorant|_mylo|myl[oa]|loson_dlya_tela|skrab_dlya_tela/i },
    { label: "макияж", count: 2, slug: /tush|pomad|_teni|pudr|tonal|rumyan|konsiler|karandash|luxvisage|brovey|lak_dlya_nog|gel_lak|manikyur/i },
    { label: "не-косметика", count: 2, slug: /korm|felix|purina|bumazhn|tualetn|stolov|chistyasch|sredstvo_dlya_mytya|osvezhitel|stirk|_gubk|gubki|myt[yё]a_posud|santekhnik|osheynik|napolnitel/i },
  ];

  const picked: DiscoveredProduct[] = [];
  const byGroup: Record<string, string[]> = {};
  const usedIds = new Set<string>();

  for (const g of groups) {
    byGroup[g.label] = [];
    for (const p of products) {
      if (byGroup[g.label].length >= g.count) break;
      if (usedIds.has(p.externalId)) continue;
      if (g.slug.test(p.slug)) {
        usedIds.add(p.externalId);
        picked.push(p);
        byGroup[g.label].push(p.url);
      }
    }
  }
  return { picked, byGroup };
}

interface CategoryPage {
  products: DiscoveredProduct[];
  /** Заявленное «N товаров» на странице категории, если распарсилось. */
  declaredTotal: number | null;
  /** Максимальный номер страницы из пагинации. */
  maxPage: number | null;
}

function parseListing(html: string): CategoryPage {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const products: DiscoveredProduct[] = [];

  $('a[href*="/product/"]').each((_, el) => {
    const p = canonicalProductUrl($(el).attr("href") ?? "");
    if (p && !seen.has(p.externalId)) {
      seen.add(p.externalId);
      products.push(p);
    }
  });

  // «7 276 товаров» — число может содержать неразрывные/узкие пробелы
  const bodyText = $("body").text();
  const totalMatch = bodyText.match(/([\d\s  ]{1,12})\s*товар(?:ов|а)?/i);
  const declaredTotal = totalMatch
    ? parseInt(totalMatch[1].replace(/[^\d]/g, ""), 10) || null
    : null;

  // Максимальный номер страницы в пагинации (?page=N)
  let maxPage: number | null = null;
  $('a[href*="page="]').each((_, el) => {
    const m = ($(el).attr("href") ?? "").match(/[?&]page=(\d+)/);
    if (m) maxPage = Math.max(maxPage ?? 0, parseInt(m[1], 10));
  });

  return { products, declaredTotal, maxPage };
}

/**
 * Обход категории той же браузерной страницей: ?page=1..N, пока
 * появляются новые товары. `maxPages` — страховка от бесконечного цикла.
 */
export async function discoverFromCategory(
  page: Page,
  categoryUrl: string,
  opts: { startPage?: number; maxPages?: number } = {},
): Promise<{ products: DiscoveredProduct[]; declaredTotal: number | null }> {
  const base = categoryUrl.split("?")[0];
  const startPage = opts.startPage ?? 1;
  const hardLimit = opts.maxPages ?? 500;

  const all = new Map<string, DiscoveredProduct>();
  let declaredTotal: number | null = null;
  let knownMax: number | null = null;

  for (let pageNo = startPage; pageNo <= hardLimit; pageNo++) {
    const url = pageNo === 1 ? base : `${base}?page=${pageNo}`;
    ts(`category: opening ${url}`);
    try {
      await gotoAndWait(page, url, 'a[href*="/product/"]');
    } catch (e) {
      ts(`category: page ${pageNo} — товары не дождались (${(e as Error).message.slice(0, 80)}), останавливаюсь`);
      break;
    }
    const parsed = parseListing(await page.content());
    declaredTotal = declaredTotal ?? parsed.declaredTotal;
    knownMax = parsed.maxPage ?? knownMax;

    const before = all.size;
    for (const p of parsed.products) all.set(p.externalId, p);
    const added = all.size - before;
    ts(`category "${base.split("/").pop()}": page ${pageNo}, products ${parsed.products.length} (+${added} new)`);

    if (added === 0) break; // дальше только повторы/пусто
    if (knownMax !== null && pageNo >= knownMax) break;
    if (declaredTotal !== null && all.size >= declaredTotal) break;
  }

  debug(`category done: unique=${all.size} declared=${declaredTotal ?? "?"}`);
  return { products: [...all.values()], declaredTotal };
}
