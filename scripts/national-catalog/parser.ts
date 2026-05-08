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

  // ── Image ───────────────────────────────────────────────
  const rawImg =
    $("[class*='product'] img, [class*='gallery'] img, [class*='photo'] img")
      .first()
      .attr("src") ||
    $("meta[property='og:image']").attr("content") ||
    null;
  const imageUrl = rawImg
    ? (() => {
        try {
          return new URL(rawImg, sourceUrl).toString();
        } catch {
          return null;
        }
      })()
    : null;

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
  const barcode =
    flatAttributes["Штрихкод"] ??
    flatAttributes["GTIN"] ??
    lookup(flatAttributes, "штрихкод", "gtin");

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
