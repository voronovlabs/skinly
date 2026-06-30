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
      const inci = raw.replace(/\s+/g, " ").trim();
      if (!isLikelyInci(inci)) return null;
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
