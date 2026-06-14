/**
 * Парсер detail-страницы товара FARERA (CS-Cart, server-rendered).
 *
 * Толерантный, в духе national-catalog/parser.ts: для каждого поля несколько
 * стратегий (стандартные CS-Cart 4.x классы → meta/og → текстовый fallback),
 * чтобы пережить кастомизацию темы. Никакого Playwright — чистый cheerio.
 *
 * Извлекаем:
 *   title, brand, line, productType, skinType, country, volume,
 *   priceCurrent/priceOld, vendorCode (Код), productId, imageUrl (og:image),
 *   compositionRaw (INCI из текста описания), categoryPath (хлебные крошки),
 *   flatAttributes (блок «Особенности»).
 *
 * barcode у farera отсутствует — всегда null.
 */

import * as cheerio from "cheerio";
import { SOURCE } from "./config";
import type { FareraScrapedProduct } from "./types";

type Cheerio$ = cheerio.CheerioAPI;

function clean(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Нечёткий поиск значения по ключу среди плоских атрибутов. */
function lookup(
  flat: Record<string, string>,
  ...needles: string[]
): string | null {
  for (const n of needles) {
    if (flat[n]) return flat[n];
  }
  for (const [k, v] of Object.entries(flat)) {
    const kk = k.toLowerCase();
    for (const n of needles) {
      if (kk.includes(n.toLowerCase())) return v;
    }
  }
  return null;
}

/* ───────── price ───────── */

function parsePriceNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  // «1 100 ₽» / «990.00» / «1 100» → 1100 / 990
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // CS-Cart обычно отдаёт целые рубли; точка/запятая — копейки.
  const normalized = cleaned.replace(",", ".");
  const n = Math.round(parseFloat(normalized));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickPrices($: Cheerio$): { current: number | null; old: number | null } {
  // 1) Schema.org: <meta itemprop="price" content="990">
  let current =
    parsePriceNumber($('[itemprop="price"]').first().attr("content")) ??
    parsePriceNumber($('meta[itemprop="price"]').first().attr("content"));

  // 2) CS-Cart актуальная цена: .ty-price-num внутри .ty-price (не list-price).
  if (current == null) {
    const node = $(".ty-price-update .ty-price-num, .ty-price .ty-price-num")
      .first()
      .text();
    current = parsePriceNumber(node);
  }

  // 3) Старая (зачёркнутая) цена.
  const old =
    parsePriceNumber(
      $(".ty-list-price .ty-price-num, .ty-strike .ty-price-num")
        .first()
        .text(),
    ) ?? null;

  return { current, old };
}

/* ───────── vendor code (Код) ───────── */

function pickVendorCode($: Cheerio$): string | null {
  const cand =
    $(".cm-product-sku, .ty-sku-item__code, [itemprop='sku']").first().text() ||
    $("[itemprop='sku']").first().attr("content") ||
    "";
  const c = clean(cand);
  if (c) return c;

  // Текстовый fallback: «Код: 6102». Берём первое осмысленное значение.
  const bodyText = $("body").text();
  const m = bodyText.match(/Код[:\s]+([A-Za-z0-9._-]{2,40})/);
  return m ? clean(m[1]) : null;
}

/* ───────── product_id ───────── */

function pickProductId(html: string): number | null {
  const m = html.match(/product_id[=:]\s*"?(\d{1,9})"?/);
  return m ? parseInt(m[1], 10) : null;
}

/* ───────── image ───────── */

function pickImage($: Cheerio$): string | null {
  const og =
    $("meta[property='og:image']").attr("content") ||
    $("meta[property='og:image:secure_url']").attr("content") ||
    $("meta[name='twitter:image']").attr("content");
  if (og && clean(og)) return clean(og);

  // Fallback: первая «detailed» картинка товара.
  const detailed = $("a[href*='/detailed/'], img[src*='/detailed/']")
    .first()
    .attr("href");
  if (detailed) return clean(detailed);
  const imgSrc = $("img[src*='/detailed/']").first().attr("src");
  return imgSrc ? clean(imgSrc) : null;
}

/* ───────── features (Особенности) ───────── */

function extractFeatures($: Cheerio$): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const kk = clean(k).replace(/[:：]\s*$/, "");
    const vv = clean(v);
    if (!kk || !vv || kk === vv || kk.length > 80) return;
    if (!out[kk]) out[kk] = vv;
  };

  // 1) CS-Cart стандарт: .ty-product-feature { __label, __value }
  $(".ty-product-feature").each((_, el) => {
    const $el = $(el);
    const label =
      $el.find(".ty-product-feature__label").first().text() ||
      $el.find("[class*='label']").first().text();
    const value =
      $el.find(".ty-product-feature__value").first().text() ||
      $el.find("[class*='value']").first().text();
    put(label, value);
  });

  // 2) Generic key/value (таблицы/dl/двухдетные ряды) — на случай иной темы.
  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td, th");
    if (cells.length >= 2) put($(cells[0]).text(), $(cells[cells.length - 1]).text());
  });
  $("dl").each((_, dl) => {
    const dts = $(dl).find("dt").toArray();
    const dds = $(dl).find("dd").toArray();
    for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
      put($(dts[i]).text(), $(dds[i]).text());
    }
  });

  return out;
}

/* ───────── composition / INCI ───────── */

/**
 * Ищем явную INCI-строку в тексте страницы. Формат с сайта:
 *   «Состав продукта (INCI): Aqua, Lactic Acid, ...»
 * Также поддерживаем «Ingredients:» / «INCI:».
 * Возвращаем строку до конца предложения/строки.
 */
function extractInci(pageText: string): string | null {
  const patterns: RegExp[] = [
    /Состав\s*(?:продукта|товара)?\s*\(?\s*INCI\s*\)?\s*[:：]\s*([^\n]+)/i,
    /\bINCI\s*[:：]\s*([^\n]+)/i,
    /\bIngredients\s*[:：]\s*([^\n]+)/i,
  ];
  for (const re of patterns) {
    const m = pageText.match(re);
    if (m && m[1]) {
      let v = clean(m[1]);
      // Обрезаем хвост, если регуляркой захватили начало следующего блока.
      v = v.split(/\s{2,}|(?:Применение|Способ применения|Примечание)\b/)[0];
      v = clean(v);
      if (v.length >= 3) return v;
    }
  }
  return null;
}

/* ───────── volume ───────── */

function extractVolume(
  title: string | null,
  flat: Record<string, string>,
): string | null {
  const fromFeat = lookup(flat, "объём", "объем", "обьём", "обьем", "объем (мл)");
  if (fromFeat) return clean(fromFeat);
  if (title) {
    // NB: JS \b не работает после кириллицы (\w = ASCII), поэтому вместо \b —
    // negative lookahead «дальше не буква».
    const m = title.match(
      /(\d+(?:[.,]\d+)?)\s*(мл|ml|мг|л|гр|г|g|шт|капс|табл)(?![а-яёa-z])/i,
    );
    if (m) return clean(m[0]);
  }
  return null;
}

/* ───────── breadcrumbs ───────── */

function extractBreadcrumbs($: Cheerio$): string[] {
  const crumbs: string[] = [];
  $(
    ".ty-breadcrumbs a, [class*='breadcrumb'] a, nav[aria-label*='хлеб'] a",
  ).each((_, el) => {
    const t = clean($(el).text());
    if (t && t.toLowerCase() !== "главная" && t.length < 80) crumbs.push(t);
  });
  return crumbs;
}

/* ───────── main ───────── */

export function parseFareraProduct(
  html: string,
  sourceUrl: string,
): FareraScrapedProduct {
  const $ = cheerio.load(html);

  const title =
    clean($("h1.ty-product-block-title").first().text()) ||
    clean($("h1").first().text()) ||
    clean($("meta[property='og:title']").attr("content")) ||
    null;

  const flatAttributes = extractFeatures($);
  const categoryPath = extractBreadcrumbs($);
  const imageUrl = pickImage($);
  const { current: priceCurrent, old: priceOld } = pickPrices($);
  const vendorCode = pickVendorCode($);
  const productId = pickProductId(html);

  const pageText = $("body").text().replace(/ /g, " ");
  const compositionRaw = extractInci(pageText);

  // brand / line / productType / skinType / country: feature → breadcrumb.
  const brand =
    lookup(flatAttributes, "бренд", "торговая марка", "марка") ??
    (categoryPath.length >= 2 ? categoryPath[categoryPath.length - 2] : null);
  const line = lookup(flatAttributes, "линия", "серия");
  const productType = lookup(flatAttributes, "средства", "тип средства", "категория товара");
  const skinType = lookup(flatAttributes, "тип кожи", "для кожи");
  const country = lookup(flatAttributes, "страна производства", "страна");

  const volume = extractVolume(title, flatAttributes);

  return {
    source: SOURCE,
    sourceUrl,
    productId,
    vendorCode,
    categoryPath,
    title,
    barcode: null,
    brand: brand || null,
    country: country || null,
    line: line || null,
    productType: productType || null,
    skinType: skinType || null,
    volume: volume || null,
    priceCurrent,
    priceOld,
    currency: "RUB",
    imageUrl,
    compositionRaw,
    hasInci: compositionRaw != null,
    flatAttributes,
    scrapedAt: new Date().toISOString(),
  };
}
