/**
 * Сопоставление товара со страницей источника — защита от «не тот товар».
 * Приоритет (применяется вызывающими провайдерами):
 *   1. EAN/GTIN (точное — у OpenBeautyFacts)
 *   2. exact / нормализованное name + brand (этот модуль)
 *   3. осторожный токен-overlap
 * Нельзя перепутать товары → порог намеренно высокий.
 */

import type { EnrichProduct } from "./types";

export function tokens(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/**
 * true, если текст-кандидат (заголовок/начало страницы товара) относится к
 * тому же товару: присутствует бренд И ≥60% значимых токенов названия.
 */
export function productMatches(p: EnrichProduct, candidate: string): boolean {
  const ct = candidate.toLowerCase();
  const brandOk = !p.brand || tokens(p.brand).some((b) => ct.includes(b));
  if (!brandOk) return false;

  const nameToks = tokens(p.name).filter((t) => !/^\d+$/.test(t));
  if (nameToks.length === 0) return false;
  const hit = nameToks.filter((t) => ct.includes(t)).length;
  return hit / nameToks.length >= 0.6;
}
