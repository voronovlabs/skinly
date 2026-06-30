/**
 * Skinly · ingredient enrichment · общие типы.
 *
 * Провайдер-цепочка: каждый источник INCI — отдельный IngredientProvider.
 * getIngredients(product) возвращает первый НАСТОЯЩИЙ INCI или null.
 * Добавить источник = добавить провайдер в реестр, остальной код не трогаем.
 */

export interface EnrichProduct {
  /** EAN/GTIN (главный ключ сопоставления). */
  ean: string | null;
  brand: string | null;
  name: string | null;
  volume: string | null;
  /** Уже имеющийся в staging INCI (если карточка Care to Beauty его дала). */
  existingInci: string | null;
}

export interface IngredientResult {
  /** ТОЛЬКО валидный INCI-список (прошёл isLikelyInci). */
  inci: string;
  /** Имя источника-провайдера: 'caretobeauty' | 'openbeautyfacts' | <site>. */
  source: string;
  sourceUrl: string | null;
  /** Способ сопоставления: 'staging' | 'ean' | 'brand-html' | 'retailer-html'. */
  method: string;
  /** 0..1 — уверенность (ean-exact выше, чем name-search). */
  confidence: number;
}

export interface IngredientProvider {
  name: string;
  getIngredients(
    p: EnrichProduct,
    log: (m: string) => void,
  ): Promise<IngredientResult | null>;
}
