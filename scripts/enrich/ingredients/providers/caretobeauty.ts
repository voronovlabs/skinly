/**
 * Источник №1 — Care to Beauty (уже в staging).
 * Если карточка Care to Beauty дала НАСТОЯЩИЙ INCI (прошёл isLikelyInci при
 * скрейпе), используем его как есть. Иначе → следующий провайдер.
 */

import { isLikelyInci } from "../../../caretobeauty/parser";
import type { IngredientProvider } from "../types";

export const careToBeautyProvider: IngredientProvider = {
  name: "caretobeauty",
  async getIngredients(p) {
    const inci = (p.existingInci ?? "").trim();
    if (inci && isLikelyInci(inci)) {
      return {
        inci,
        source: "caretobeauty",
        sourceUrl: null,
        method: "staging",
        confidence: 0.95,
      };
    }
    return null;
  },
};
