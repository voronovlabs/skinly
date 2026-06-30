/**
 * Общий извлекатель INCI из ПРОИЗВОЛЬНОГО HTML (для brand-site / retailer
 * провайдеров). Переиспользует strict-валидатор и htmlToText из парсера
 * Care to Beauty — единый источник правды о том, что считается INCI.
 *
 * Гарантии:
 *   • никогда не вернёт маркетинг (Main/Key/Active Ingredients, Benefits,
 *     How to use и т.п.) — всё проходит через isLikelyInci;
 *   • нет настоящего INCI → null.
 */

import { htmlToText, isLikelyInci } from "../../caretobeauty/parser";
import { productMatches } from "./match";
import type { EnrichProduct } from "./types";

// Заголовки настоящей секции состава (мультиязычные).
const INCI_HEADING_RE =
  /(?:^|\n)[ \t#*>•\-]*(Full Ingredients List|Ingredients List|Ingredients|Composition|INCI|Inhaltsstoffe|Ingr[ée]dients|Ingredientes|Состав)\b[ \t:.\-*>]*\n?/gi;
// Любой следующий заголовок — граница блока (вкл. маркетинговые — их не берём).
const NEXT_HEADING_RE =
  /(?:^|\n)[ \t#*>•\-]*(Main Ingredients|Key Ingredients|Active Ingredients|How to use|How to Use|Directions|Description|Characteristics|Benefits|Highlights|Safety|Warning|Manufacturer|Reviews|Subscribe|Delivery|Nutrition|Product Description)\b/i;

function clean(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:*•\-]+/, "")
    .replace(/\s*\.\s*$/, "")
    .trim();
}

/**
 * Достаёт INCI из HTML страницы товара:
 *   1. секция, точно озаглавленная Ingredients/Composition/INCI/… → текст до
 *      следующего заголовка → isLikelyInci;
 *   2. fallback: самая длинная строка-список, прошедшая isLikelyInci.
 * Возвращает строку INCI или null.
 */
export function extractInciFromHtml(html: string): string | null {
  const text = htmlToText(html);

  INCI_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INCI_HEADING_RE.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const next = NEXT_HEADING_RE.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest.slice(0, 4000);
    const cand = clean(body);
    if (isLikelyInci(cand)) return cand;
  }

  // fallback: строка-список где-то на странице (некоторые магазины кладут
  // INCI в <p> без явного заголовка). strict-валидатор отсекает прозу.
  let best: string | null = null;
  for (const line of text.split(/\n+/)) {
    const c = clean(line);
    if (isLikelyInci(c) && (!best || c.length > best.length)) best = c;
  }
  return best;
}

/**
 * Достаёт INCI И проверяет, что страница действительно про этот товар
 * (brand + name gate) — защита от подмешивания состава чужого товара.
 */
export function extractInciIfMatches(
  html: string,
  p: EnrichProduct,
): string | null {
  if (!productMatches(p, htmlToText(html).slice(0, 4000))) return null;
  return extractInciFromHtml(html);
}
