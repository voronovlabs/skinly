/**
 * Парсер detail-страницы товара.
 *
 * Делает 2 вида извлечения:
 *  1) nested: секция → key-value таблица; секции — KNOWN_SECTIONS из config.
 *  2) flat:   все найденные key-value, без группировки.
 *
 * Парсинг key-value толерантен — пробует три раскладки:
 *   - <table>...<tr><td>label</td><td>value</td></tr>...</table>
 *   - <dl><dt>...</dt><dd>...</dd></dl>
 *   - <div class="row|param|attr">  с дочерними .label/.name + .value
 *
 * Если конкретный сайт всегда использует одну схему — можно упростить.
 */

import * as cheerio from "cheerio";
import { KNOWN_SECTIONS } from "./config";
import type { ScrapedProduct } from "./types";

type Cheerio$ = cheerio.CheerioAPI;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Scope = cheerio.Cheerio<any>;

function clean(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/ /g, " ") // nbsp
    .replace(/\s+/g, " ")
    .trim();
}

function isKnownSection(title: string): boolean {
  const t = clean(title).toLowerCase();
  return KNOWN_SECTIONS.some((s) => t.includes(s.toLowerCase()));
}

/** Достаёт key-value из любого DOM-фрагмента. */
function extractKeyValue($: Cheerio$, $scope: Scope): Record<string, string> {
  const out: Record<string, string> = {};

  // Раскладка 1: tables
  $scope.find("table").each((_, tbl) => {
    $(tbl)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr).find("td, th");
        if (cells.length < 2) return;
        const k = clean($(cells[0]).text());
        const v = clean($(cells[cells.length - 1]).text());
        if (k && v && !out[k]) out[k] = v;
      });
  });

  // Раскладка 2: definition lists
  $scope.find("dl").each((_, dl) => {
    const dts = $(dl).find("dt").toArray();
    const dds = $(dl).find("dd").toArray();
    for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
      const k = clean($(dts[i]).text());
      const v = clean($(dds[i]).text());
      if (k && v && !out[k]) out[k] = v;
    }
  });

  // Раскладка 3: div-based rows
  $scope
    .find("[class*='row'], [class*='param'], [class*='attr'], [class*='prop']")
    .each((_, row) => {
      const $row = $(row);
      const k = clean(
        $row
          .find("[class*='name'], [class*='label'], [class*='title'], [class*='key']")
          .first()
          .text(),
      );
      const v = clean(
        $row.find("[class*='value'], [class*='val']").first().text(),
      );
      if (k && v && !out[k]) out[k] = v;
    });

  return out;
}

/**
 * Извлекает barcode (8–14 цифр) из URL вида
 * `https://.../product/4660243673834-ru-talk-dlya-depilyacii...`.
 * Тот же regex, что в discovery.ts — единый источник истины формата.
 */
const PRODUCT_BARCODE_FROM_URL = /\/product\/(\d{8,14})(?:[-/]|$)/;

function extractBarcodeFromSourceUrl(sourceUrl: string): string | null {
  // Сначала пробуем парсить URL — это даст pathname без query/hash, на случай
  // если ?utm=… подцеплено к URL'у. Если URL не валидный (мало ли что в строке),
  // просто matches на raw-строку.
  let pathname = sourceUrl;
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    /* fallthrough: используем raw */
  }
  const m = pathname.match(PRODUCT_BARCODE_FROM_URL);
  return m ? m[1] : null;
}

/* ───────── Image extraction (Phase 13.3) ───────── */

/**
 * Паттерны заведомо-невалидных картинок. Сюда попадает дефолтная заглушка
 * националкаталог.рф (`/img/default/1x1.jpg`), стандартные `1x1.jpg`,
 * data:image/gif (часто GIF89a 1×1 пустышка), а также любые `placeholder` /
 * `no-image` пути, которые сайты часто выдают до lazy-load'а.
 */
const PLACEHOLDER_IMAGE_PATTERNS: ReadonlyArray<RegExp> = [
  /\/img\/default\/1x1\.jpg(?:$|\?)/i,
  /(?:^|\/)1x1\.(?:jpg|jpeg|png|gif|webp)(?:$|\?)/i,
  /^data:image\/gif/i,
  /^data:image\/svg\+xml/i,
  /\/placeholder[^/]*\.(?:jpg|jpeg|png|gif|webp|svg)(?:$|\?)/i,
  /\/no[-_]image[^/]*\.(?:jpg|jpeg|png|gif|webp|svg)(?:$|\?)/i,
  /\/blank\.(?:jpg|jpeg|png|gif|webp)(?:$|\?)/i,
  /\/transparent\.(?:jpg|jpeg|png|gif|webp)(?:$|\?)/i,
];

function isPlaceholderImage(url: string | null | undefined): boolean {
  if (!url) return true;
  const s = String(url).trim();
  if (!s) return true;
  return PLACEHOLDER_IMAGE_PATTERNS.some((re) => re.test(s));
}

/**
 * Абсолютизировать относительный URL через sourceUrl. `data:` URL'ы
 * пропускаем как есть. Возвращает `null` при невалидном вводе.
 */
function normalizeImage(
  url: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!url) return null;
  const s = String(url).trim();
  if (!s) return null;
  if (s.startsWith("data:")) return s;
  try {
    return new URL(s, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Из `srcset="url1 1x, url2 2x"` достать первый URL. Возвращает null,
 * если srcset пустой / не парсится.
 */
function firstFromSrcset(srcset: string | undefined | null): string | null {
  if (!srcset) return null;
  const part = srcset.split(",")[0]?.trim();
  if (!part) return null;
  return part.split(/\s+/)[0] ?? null;
}

/** Подмножество JSON-LD узла, в котором у нас может быть картинка. */
function extractImageFromJsonLd(node: unknown): string[] {
  const out: string[] = [];
  if (!node) return out;
  if (typeof node === "string") return out;
  if (Array.isArray(node)) {
    for (const item of node) out.push(...extractImageFromJsonLd(item));
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;

  const im = obj.image;
  if (typeof im === "string") {
    out.push(im);
  } else if (Array.isArray(im)) {
    for (const it of im) {
      if (typeof it === "string") out.push(it);
      else if (it && typeof it === "object") {
        const u = (it as Record<string, unknown>).url;
        if (typeof u === "string") out.push(u);
      }
    }
  } else if (im && typeof im === "object") {
    const u = (im as Record<string, unknown>).url;
    if (typeof u === "string") out.push(u);
  }

  // JSON-LD часто упакован в @graph.
  if (Array.isArray(obj["@graph"])) {
    out.push(...extractImageFromJsonLd(obj["@graph"]));
  }
  return out;
}

const PRODUCT_SCOPE_SELECTOR =
  "[class*='product'] img, [class*='gallery'] img, [class*='photo'] img";

/**
 * Pick image URL по priority-сheme из таска. Каждый кандидат проверяется
 * через `isPlaceholderImage` ДО и ПОСЛЕ абсолютизации (некоторые placeholder'ы
 * становятся очевидны только в абсолютной форме).
 *
 * Возвращает первый «честный» абсолютный URL, либо `null`.
 */
function pickImage($: Cheerio$, sourceUrl: string): string | null {
  const candidates: string[] = [];
  const push = (v: string | undefined | null) => {
    if (v) candidates.push(v);
  };
  const pushSrcset = (v: string | undefined | null) => {
    const first = firstFromSrcset(v);
    if (first) candidates.push(first);
  };

  // 1) meta og:image / twitter:image
  push($("meta[property='og:image']").attr("content"));
  push($("meta[property='og:image:secure_url']").attr("content"));
  push($("meta[name='twitter:image']").attr("content"));
  push($("meta[name='twitter:image:src']").attr("content"));

  // 2) link[rel='image_src']
  push($("link[rel='image_src']").attr("href"));

  // 3-7) attribute walk: product-scoped first, then global. Один проход
  //      per attribute, чтобы сохранить priority-порядок из таска:
  //        data-src > data-original > data-lazy-src > srcset > src
  const ATTR_WALK: Array<{ attr: string; mode: "attr" | "srcset" }> = [
    { attr: "data-src", mode: "attr" },
    { attr: "data-original", mode: "attr" },
    { attr: "data-lazy-src", mode: "attr" },
    { attr: "srcset", mode: "srcset" },
    { attr: "src", mode: "attr" },
  ];
  for (const { attr, mode } of ATTR_WALK) {
    $(PRODUCT_SCOPE_SELECTOR).each((_, el) => {
      const v = $(el).attr(attr);
      if (mode === "srcset") pushSrcset(v);
      else push(v);
    });
    $("img").each((_, el) => {
      const v = $(el).attr(attr);
      if (mode === "srcset") pushSrcset(v);
      else push(v);
    });
  }

  // 6b) <picture><source srcset> — отдельно, потому что не <img>
  $("source[srcset]").each((_, el) => {
    pushSrcset($(el).attr("srcset"));
  });

  // 8) JSON-LD image
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    try {
      const json: unknown = JSON.parse(txt);
      for (const u of extractImageFromJsonLd(json)) push(u);
    } catch {
      /* битый JSON-LD — пропускаем */
    }
  });

  // 9) inline scripts — regex-fallback. Защита от мега-минифицированных
  //    бандлов: пропускаем скрипты длиной > 1MB, и берём максимум 20 URL'ов.
  $("script:not([src])").each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt || txt.length > 1_000_000) return;
    const re =
      /https?:\/\/[^\s'"\\)]+\.(?:jpe?g|png|webp|gif|avif)(?:\?[^\s'"\\)]*)?/gi;
    let m: RegExpExecArray | null;
    let safety = 0;
    while ((m = re.exec(txt)) !== null && safety < 20) {
      push(m[0]);
      safety++;
    }
  });

  // Pick: первый non-placeholder, нормализованный, ещё раз non-placeholder.
  for (const c of candidates) {
    if (isPlaceholderImage(c)) continue;
    const abs = normalizeImage(c, sourceUrl);
    if (!abs) continue;
    if (isPlaceholderImage(abs)) continue;
    return abs;
  }
  return null;
}

/* ───────── Misc helpers ───────── */

/** Ищет значение поля по «нечёткому» совпадению ключа. */
function lookup(
  flat: Record<string, string>,
  ...needles: string[]
): string | null {
  // 1) точное совпадение
  for (const n of needles) {
    if (flat[n]) return flat[n];
  }
  // 2) substring (case-insensitive)
  for (const [k, v] of Object.entries(flat)) {
    const kk = k.toLowerCase();
    for (const n of needles) {
      if (kk.includes(n.toLowerCase())) return v;
    }
  }
  return null;
}

export function parseProductPage(
  html: string,
  sourceUrl: string,
): ScrapedProduct {
  const $ = cheerio.load(html);

  // ── Title ───────────────────────────────────────────────
  const title = clean($("h1").first().text()) || null;

  // ── Image (Phase 13.3 — production image extraction) ────
  //
  // На националкаталог.рф большая часть HTML — server-rendered, но картинка
  // нередко lazy-load'ится через data-* атрибуты, og:image мета-тэг,
  // JSON-LD или встраивается в inline script. До этого patch'а парсер
  // ловил placeholder `/img/default/1x1.jpg`, и Skinly хранил его как
  // настоящую картинку — UI потом показывал прозрачный 1×1 piksel.
  //
  // Новый pipeline:
  //   1. собрать кандидатов в строгом priority-order
  //   2. отфильтровать placeholder'ы (см. PLACEHOLDER_IMAGE_PATTERNS)
  //   3. первый «честный» URL абсолютизировать через sourceUrl и вернуть
  //   4. если ничего не нашли — `imageUrl: null` (contract уже nullable)
  //
  // Stats не добавляем — scraper-уровневый `productsWithoutImage` теперь
  // покрывает И "вообще нет картинки" И "только placeholder". Этого достаточно.
  const imageUrl = pickImage($, sourceUrl);

  // ── Breadcrumbs (categoryPath) ──────────────────────────
  const categoryPath: string[] = [];
  $("[class*='breadcrumb'] a, [class*='breadcrumbs'] a, nav[aria-label*='хлеб'] a")
    .each((_, el) => {
      const t = clean($(el).text());
      if (t && t.toLowerCase() !== "главная" && t.length < 80) {
        categoryPath.push(t);
      }
    });

  // ── Characteristics: nested ─────────────────────────────
  const characteristics: Record<string, Record<string, string>> = {};

  $("h2, h3, h4, [class*='section-title'], [class*='block-title']").each(
    (_, headerEl) => {
      const sectionTitle = clean($(headerEl).text());
      if (!isKnownSection(sectionTitle)) return;

      // Ищем «соседний контейнер» — у Национального каталога это,
      // как правило, следующий блок DOM. Берём первого подходящего родителя
      // и от него ниже — собираем key-value.
      const $header = $(headerEl);
      let $section = $header.nextUntil("h2, h3, h4");
      if ($section.length === 0) {
        $section = $header.parent();
      }

      const pairs = extractKeyValue($, $section);
      if (Object.keys(pairs).length > 0) {
        // Канонизируем ключ секции к одному из KNOWN_SECTIONS, если нашли.
        const canonical =
          KNOWN_SECTIONS.find((s) =>
            sectionTitle.toLowerCase().includes(s.toLowerCase()),
          ) ?? sectionTitle;
        characteristics[canonical] = {
          ...(characteristics[canonical] ?? {}),
          ...pairs,
        };
      }
    },
  );

  // Fallback: если не нашли ни одной известной секции — собираем всё со всей body.
  if (Object.keys(characteristics).length === 0) {
    const all = extractKeyValue($, $("body"));
    if (Object.keys(all).length > 0) {
      characteristics["__unstructured__"] = all;
    }
  }

  // ── Flatten ─────────────────────────────────────────────
  const flatAttributes: Record<string, string> = {};
  for (const sect of Object.values(characteristics)) {
    for (const [k, v] of Object.entries(sect)) {
      if (!flatAttributes[k]) flatAttributes[k] = v;
    }
  }

  // ── Известные поля ──────────────────────────────────────
  // Сначала пробуем достать barcode из HTML-атрибутов (самый «доверенный» источник).
  // Если на странице его нет (часть товаров такие — либо рендерится JS'ом,
  // либо просто не указано в паспорте) — fallback на /product/<barcode>… в URL.
  // На националкаталог.рф URL канонический, поэтому fallback надёжный.
  const barcode =
    flatAttributes["Штрихкод"] ??
    flatAttributes["GTIN"] ??
    lookup(flatAttributes, "штрихкод", "gtin") ??
    extractBarcodeFromSourceUrl(sourceUrl);

  const brand =
    flatAttributes["Товарный знак"] ??
    flatAttributes["Бренд"] ??
    lookup(flatAttributes, "товарный знак", "бренд", "торговая марка");

  const country =
    flatAttributes["Страна происхождения"] ??
    lookup(flatAttributes, "страна происхождения", "страна");

  const manufacturer = lookup(flatAttributes, "производитель");
  const signer = lookup(flatAttributes, "заявитель", "подписант");
  const importer = lookup(flatAttributes, "импортер", "импортёр");

  const compositionRaw = lookup(flatAttributes, "состав", "inci", "ингредиент");

  return {
    source: "national_catalog",
    sourceUrl,
    categoryPath,
    title,
    barcode: barcode || null,
    brand: brand || null,
    country: country || null,
    manufacturer: manufacturer || null,
    signer: signer || null,
    importer: importer || null,
    imageUrl,
    compositionRaw: compositionRaw || null,
    characteristics,
    flatAttributes,
    scrapedAt: new Date().toISOString(),
  };
}
