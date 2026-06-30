/**
 * Источник — Open Beauty Facts (по EAN/GTIN, ТОЧНОЕ сопоставление).
 *
 * Самый надёжный автоматический источник: открытое API, ключ — штрихкод,
 * `ingredients_text` хранит реальный INCI. Бесплатно, без ключа (нужен лишь
 * описательный User-Agent по их политике). 1 запрос на товар.
 *
 * Возвращает INCI только если он проходит strict-валидатор isLikelyInci.
 */

import { isLikelyInci } from "../../../caretobeauty/parser";
import type { IngredientProvider } from "../types";

const UA =
  "Skinly/1.0 (cosmetics catalog ingredient enrichment; +https://skinly.msvoronov.com)";

interface ObfResponse {
  status?: number;
  product?: {
    ingredients_text_en?: string;
    ingredients_text?: string;
  };
}

// Маркеры производителя/адреса — их быть НЕ должно перед/в составе.
const MANUFACTURER_MARKERS =
  /(produc[ăa]tor|manufactur(er|ed)|distribut(or|ed)|importer|address|adress|new york|levallois|romania|rom[aâ]nia|t[eé]l[eé]phone|telephone|www\.|https?:|\bllc\b|\bgmbh\b|s\.?a\.?r\.?l|laborator|\binc\.)/i;

/**
 * Чистит ingredients_text из OpenBeautyFacts:
 *   1. если есть маркер «ingredients:» — берём ТОЛЬКО хвост после последнего
 *      такого маркера (отрезаем «producător: …», адрес, и т.п.);
 *   2. отвергаем, если в результате остались маркеры производителя/адреса;
 *   3. требуем ≥8 токенов через запятую (настоящий INCI).
 * Возвращает чистый INCI или null.
 */
export function cleanObfIngredients(raw: string): string | null {
  let t = raw.replace(/\s+/g, " ").trim();

  // 1) отрезать всё до последнего «ingredients:» / «ingredient list:»
  const re = /ingredient(?:s| list)?\s*:/gi;
  let cutTo = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) cutTo = m.index + m[0].length;
  if (cutTo >= 0) t = t.slice(cutTo).trim();

  t = t.replace(/^[\s.,;:*•\-]+/, "").trim();

  // 2) маркеры производителя/адреса → это не чистый INCI
  if (MANUFACTURER_MARKERS.test(t)) return null;

  // 3) ≥8 токенов через запятую
  const tokens = t.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length < 8) return null;

  return t.replace(/\s*\.\s*$/, "").trim();
}

export const openBeautyFactsProvider: IngredientProvider = {
  name: "openbeautyfacts",
  async getIngredients(p, log) {
    if (!p.ean) return null;
    const url =
      `https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(p.ean)}.json` +
      `?fields=code,ingredients_text,ingredients_text_en`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as ObfResponse;
      if (j.status !== 1 || !j.product) return null;
      const raw = (j.product.ingredients_text_en || j.product.ingredients_text || "").trim();
      if (!raw) return null;
      // чистим производителя/адрес и берём только настоящий INCI-хвост
      const inci = cleanObfIngredients(raw);
      if (!inci || !isLikelyInci(inci)) return null;
      return {
        inci,
        source: "openbeautyfacts",
        sourceUrl: `https://world.openbeautyfacts.org/product/${p.ean}`,
        method: "ean",
        confidence: 0.9,
      };
    } catch (e) {
      log(`[obf] ${p.ean} fail: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  },
};
