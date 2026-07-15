/**
 * Парсер SSR-карточки товара cosmetic.magnit.ru.
 *
 * Извлечение секций («Описание», «Состав», «Характеристики», «Способ
 * применения») построено на ЛИНЕАРИЗОВАННОМ тексте страницы (аналог
 * browser innerText: обход DOM с разрывами строк на блочных границах),
 * а НЕ на textContent большого родительского блока. Для каждой секции
 * ищется строка-заголовок и берётся контент до следующего заголовка.
 *
 * Ключевая тонкость — таб-навигация карточки: заголовки
 * «Описание Состав Характеристики Документы Отзывы» встречаются ещё и как
 * ряд кнопок-табов (несколько заголовков подряд без контента). Поэтому для
 * каждой секции берётся то вхождение заголовка, за которым следует РЕАЛЬНЫЙ
 * контент (не другой заголовок), — это отсекает таб-строку.
 *
 * Прочее (h1, breadcrumbs, картинка, JSON-LD) — как раньше; парсер не
 * привязан к CSS-классам (Nuxt-хэши меняются).
 */

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { Page } from "playwright";
import { gotoAndWait } from "./browser";
import { canonicalProductUrl } from "./discovery";
import { debug } from "./logger";
import type { MagnitCharacteristics, RawMagnitProduct } from "./types";

/** Заголовки секций карточки. Порядок не важен — используем как множество. */
const SECTION_TITLES = [
  "Описание",
  "Состав",
  "Характеристики",
  "Способ применения",
  "Применение",
  "Документы",
  "Отзывы",
] as const;

const SECTION_SET = new Set<string>(SECTION_TITLES);

/** Известные ключи блока «Характеристики». */
const CHAR_KEYS = [
  "Бренд",
  "Линейка",
  "Производитель",
  "Страна",
  "Страна производства",
  "Объем, л",
  "Объем, мл",
  "Объем",
  "Вес, г",
  "Вес, кг",
  "Вес",
  "Артикул",
  "Тип кожи",
  "Тип волос",
  "Тип средства",
  "Назначение",
  "Возраст",
  "Пол",
  "Аромат",
  "Цвет",
  "SPF",
];

const IMAGE_HOST = "images-foodtech.magnit.ru";
const PLACEHOLDER_IMAGE = /cosmetic-share|\/images\/|install-app|banner|logo|data:image/i;

function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nonEmpty(s: string | null | undefined): string | null {
  const c = clean(s);
  return c.length > 0 ? c : null;
}

/* ───────── Линеаризация текста (innerText-подобно) ───────── */

const BLOCK_TAGS = new Set([
  "div", "section", "article", "main", "header", "footer", "nav", "aside",
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tr", "td", "th", "br", "button", "figure",
  "figcaption", "hr", "label",
]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "template"]);

/**
 * Обходит поддерево и возвращает список непустых строк — как их «видит»
 * пользователь. Разрыв строки ставится на границах блочных элементов,
 * поэтому заголовки секций оказываются на отдельных строках.
 */
function linearize($: cheerio.CheerioAPI, rootSel: string): string[] {
  const root = $(rootSel).first();
  if (!root.length) return [];
  let buf = "";
  const walk = (node: AnyNode): void => {
    if (node.type === "text") {
      buf += (node as { data?: string }).data ?? "";
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) buf += "\n";
    for (const child of el.children as AnyNode[]) walk(child);
    if (isBlock) buf += "\n";
  };
  for (const child of (root.get(0) as Element).children as AnyNode[]) walk(child);

  return buf
    .split("\n")
    .map((l) => clean(l))
    .filter((l) => l.length > 0);
}

/* ───────── Извлечение секций по строкам ───────── */

/**
 * Маркеры-границы, при которых контент секции обрывается, даже если это не
 * отдельная строка-заголовок. Нужны, т.к. блок отзывов / описание бренда
 * часто отрендерены без чистого заголовка «Отзывы» (например «22 отзыва»).
 */
// Блок отзывов: «Отзывы», «22 отзыва», рейтинг «4.8 Все», «Читать полностью».
const REVIEW_MARKERS: RegExp[] = [
  /\bОтзывы\b/,
  /\d+\s+отзыв/i,
  /Читать полностью/i,
  /\b[1-5][.,]\d\s*(?:·|Все\b)/,
];
// Описание бренда / соседние секции — не часть состава.
const BRAND_SECTION_MARKERS: RegExp[] = [
  /Описание производителя/i,
  /О бренде/i,
  /Документы/i,
  /Отзывы/i,
  /Характеристики/i,
  /Способ применения/i,
];

interface SectionOpts {
  /** Прекратить сбор строк, если строка матчит один из паттернов. */
  stopLine?: RegExp[];
  /** Обрезать склеенный текст по первому вхождению любого паттерна. */
  cut?: RegExp[];
}

/** Обрезает текст по самому раннему из маркеров. */
function cutAtMarkers(text: string, markers: RegExp[]): string {
  let cutIdx = -1;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index !== undefined) cutIdx = cutIdx < 0 ? m.index : Math.min(cutIdx, m.index);
  }
  return cutIdx >= 0 ? text.slice(0, cutIdx).trim() : text;
}

/**
 * Возвращает контент секции: строки после заголовка `title` до следующего
 * заголовка (или строки-маркера). Берётся вхождение, за которым идёт
 * НЕ-заголовок (реальный контент), чтобы отсечь таб-строку.
 */
function extractSection(lines: string[], title: string, opts: SectionOpts = {}): string | null {
  const contentIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== title) continue;
    const next = lines[i + 1];
    if (next !== undefined && !SECTION_SET.has(next)) contentIndices.push(i);
  }
  if (contentIndices.length === 0) return null;

  // Если контентных вхождений несколько — берём последнее (табы всегда выше).
  const start = contentIndices[contentIndices.length - 1];
  const parts: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_SET.has(lines[i])) break;
    if (opts.stopLine?.some((re) => re.test(lines[i]))) break;
    parts.push(lines[i]);
  }
  let text = clean(parts.join(" "));
  if (opts.cut) text = cutAtMarkers(text, opts.cut);
  return nonEmpty(text);
}

/** Строки секции «Характеристики» (для парсинга пар ключ-значение). */
function extractSectionLines(lines: string[], title: string): string[] {
  const contentIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== title) continue;
    const next = lines[i + 1];
    if (next !== undefined && !SECTION_SET.has(next)) contentIndices.push(i);
  }
  if (contentIndices.length === 0) return [];
  const start = contentIndices[contentIndices.length - 1];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_SET.has(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

/* ───────── JSON-LD ───────── */

interface JsonLdResult {
  name: string | null;
  description: string | null;
  image: string | null;
  brand: string | null;
  gtin: string | null;
  breadcrumbs: string[];
}

function parseJsonLd($: cheerio.CheerioAPI): JsonLdResult {
  const out: JsonLdResult = {
    name: null, description: null, image: null, brand: null, gtin: null, breadcrumbs: [],
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const nodes: unknown[] = Array.isArray(data) ? data : [data];
    for (const nodeRaw of nodes) {
      const node = nodeRaw as Record<string, unknown>;
      const graph = node?.["@graph"];
      const all = Array.isArray(graph) ? graph : [node];
      for (const itemRaw of all) {
        const item = itemRaw as Record<string, unknown>;
        const type = item?.["@type"];
        if (type === "Product") {
          out.name = out.name ?? nonEmpty(item.name as string);
          out.description = out.description ?? nonEmpty(item.description as string);
          const img = item.image;
          out.image =
            out.image ??
            (typeof img === "string" ? img : Array.isArray(img) ? (img[0] as string) : null);
          const brand = item.brand as Record<string, unknown> | string | undefined;
          out.brand =
            out.brand ?? (typeof brand === "string" ? brand : nonEmpty(brand?.name as string));
          out.gtin =
            out.gtin ??
            nonEmpty((item.gtin13 ?? item.gtin ?? item.gtin14 ?? item.gtin8) as string);
        }
        if (type === "BreadcrumbList" && Array.isArray(item.itemListElement)) {
          const names = (item.itemListElement as Array<Record<string, unknown>>)
            .map((li) => {
              const it = li?.item as Record<string, unknown> | string | undefined;
              return clean(
                (li?.name as string) ?? (typeof it === "string" ? "" : (it?.name as string)),
              );
            })
            .filter(Boolean);
          if (names.length > out.breadcrumbs.length) out.breadcrumbs = names;
        }
      }
    }
  });

  return out;
}

/* ───────── Характеристики ───────── */

function parseCharacteristics(
  $: cheerio.CheerioAPI,
  sectionLines: string[],
): MagnitCharacteristics {
  const chars: MagnitCharacteristics = {};

  // Вариант 1: dt/dd (самый надёжный, если разметка семантическая)
  $("dt").each((_, el) => {
    const key = clean($(el).text());
    const val = clean($(el).next("dd").text());
    if (key && val && key.length < 60) chars[key] = val;
  });
  if (Object.keys(chars).length > 0) return chars;

  // Вариант 2: строки секции «Характеристики».
  // Формат бывает: пара строк ["Бренд","Mixit"] ИЛИ одна строка "БрендMixit".
  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    // "Ключ" отдельной строкой, значение — следующая строка
    if (CHAR_KEYS.includes(line)) {
      const val = sectionLines[i + 1];
      if (val && !CHAR_KEYS.includes(val)) {
        chars[line] = val;
        i++;
        continue;
      }
    }
    // "КлючЗначение" или "Ключ: Значение" в одной строке
    for (const key of CHAR_KEYS) {
      if (line === key) continue;
      const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*(.+)$`);
      const m = line.match(re);
      if (m) {
        const val = clean(m[1]);
        if (val && !chars[key]) chars[key] = val;
        break;
      }
    }
  }
  return chars;
}

/* ───────── Изображение ───────── */

function upgradeImageUrl(url: string): string {
  return url.replace(/rs:fit:\d+:\d+/, "rs:fit:1600:1600");
}

function parseImage(
  $: cheerio.CheerioAPI,
  name: string | null,
  jsonLdImage: string | null,
): string | null {
  const candidates: string[] = [];
  if (jsonLdImage && jsonLdImage.includes(IMAGE_HOST)) candidates.push(jsonLdImage);

  $(`img[src*="${IMAGE_HOST}"]`).each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const alt = clean($(el).attr("alt"));
    if (PLACEHOLDER_IMAGE.test(src)) return;
    if (name && alt === name) candidates.unshift(src);
    else candidates.push(src);
  });

  $('meta[property="og:image"], link[rel="preload"][as="image"]').each((_, el) => {
    const src = $(el).attr("content") ?? $(el).attr("href") ?? "";
    if (src.includes(IMAGE_HOST) && !PLACEHOLDER_IMAGE.test(src)) candidates.push(src);
  });

  const first = candidates.find((c) => c.startsWith("http"));
  return first ? upgradeImageUrl(first) : null;
}

/* ───────── Breadcrumbs ───────── */

function parseBreadcrumbs($: cheerio.CheerioAPI, ld: JsonLdResult): string[] {
  const drop = /^(главная|каталог|все категории)$/i;
  let crumbs = ld.breadcrumbs.filter((c) => !drop.test(c));
  if (crumbs.length > 0) return crumbs;

  const links: string[] = [];
  $('nav a[href*="/catalog/"], [class*="breadcrumb" i] a, [class*="crumb" i] a').each((_, el) => {
    const t = clean($(el).text());
    if (t && !drop.test(t)) links.push(t);
  });
  crumbs = [...new Set(links)];

  const leaf = clean(
    $('[class*="breadcrumb" i], nav').first().children().last().text(),
  );
  if (leaf && !crumbs.includes(leaf) && !drop.test(leaf) && leaf.length < 80) {
    crumbs.push(leaf);
  }
  return crumbs;
}

/* ───────── Public API ───────── */

export function parseProductHtml(html: string, url: string): RawMagnitProduct {
  const discovered = canonicalProductUrl(url);
  if (!discovered) throw new Error(`not a product url: ${url}`);

  const $ = cheerio.load(html);
  const ld = parseJsonLd($);

  const name = nonEmpty($("h1").first().text()) ?? ld.name;
  const breadcrumbs = parseBreadcrumbs($, ld);

  // Линеаризуем main (или body), извлекаем секции по строкам.
  const lines = linearize($, $("main").length ? "main" : "body");

  // Описание: обрезаем хвост отзывов (описание бренда — легитимная часть).
  const description =
    extractSection(lines, "Описание", { stopLine: REVIEW_MARKERS, cut: REVIEW_MARKERS }) ??
    ld.description;
  // Состав: только INCI — режем «Описание производителя / О бренде / соседние секции».
  const composition = extractSection(lines, "Состав", {
    stopLine: BRAND_SECTION_MARKERS,
    cut: [...BRAND_SECTION_MARKERS, ...REVIEW_MARKERS],
  });
  // Способ применения: режем блок отзывов (часто без чистого заголовка «Отзывы»).
  const usage =
    extractSection(lines, "Способ применения", { stopLine: REVIEW_MARKERS, cut: REVIEW_MARKERS }) ??
    extractSection(lines, "Применение", { stopLine: REVIEW_MARKERS, cut: REVIEW_MARKERS });

  const charLines = extractSectionLines(lines, "Характеристики");
  const characteristics = parseCharacteristics($, charLines);
  if (ld.brand && !characteristics["Бренд"]) characteristics["Бренд"] = ld.brand;

  const imageUrl = parseImage($, name, ld.image);

  // debug: первые 500 символов каждой секции
  debug(`── ${discovered.externalId} секции ──`);
  debug(`  Описание[500]: ${(description ?? "∅").slice(0, 500)}`);
  debug(`  Состав[500]: ${(composition ?? "∅").slice(0, 500)}`);
  debug(`  Способ применения[500]: ${(usage ?? "∅").slice(0, 500)}`);
  debug(`  Характеристики: ${JSON.stringify(characteristics).slice(0, 500)}`);
  debug(
    `  meta: name=${name ? "ok" : "MISS"} crumbs=[${breadcrumbs.join(" / ")}] img=${imageUrl ? "ok" : "-"}`,
  );

  return {
    externalId: discovered.externalId,
    url: discovered.url,
    slug: discovered.slug,
    name,
    breadcrumbs,
    description,
    composition,
    usage,
    characteristics,
    imageUrl,
    gtin: ld.gtin,
    scrapedAt: new Date().toISOString(),
  };
}

/** Одна попытка: goto(domcontentloaded) → ожидание h1 → парсинг DOM. */
async function loadProductOnce(
  page: Page,
  url: string,
): Promise<{ raw: RawMagnitProduct; html: string; status: number | null }> {
  const { status } = await gotoAndWait(page, url, "h1");
  if (status !== null && status !== 200) {
    throw new Error(`HTTP ${status} (документ карточки)`);
  }
  await page.waitForTimeout(300); // добираем гидрацию секций
  const html = await page.content();
  return { raw: parseProductHtml(html, url), html, status };
}

/**
 * Загрузка карточки через браузерную сессию (единственный транспорт).
 * При таймауте/сбое — ОДИН повтор: пауза 1.5с и повторный goto (ошибки
 * бывают временными). Если и вторая попытка без h1 — бросает, вызывающий
 * сохраняет debug-артефакты и идёт дальше. Бесконечных retry нет.
 */
export async function fetchProductViaBrowser(
  page: Page,
  url: string,
): Promise<{ raw: RawMagnitProduct; html: string; status: number | null }> {
  try {
    return await loadProductOnce(page, url);
  } catch (e) {
    debug(`retry ${url}: ${(e as Error).message.slice(0, 80)} — повтор через 1.5с`);
    await page.waitForTimeout(1500);
    return await loadProductOnce(page, url); // второй сбой пробрасывается наружу
  }
}
