/**
 * Сборка провайдер-цепочки + последовательный резолвер INCI.
 *
 * Порядок по умолчанию:
 *   1. caretobeauty     — настоящий INCI с самой карточки (если есть);
 *   2. openbeautyfacts  — по EAN (точно, надёжно, без анти-бота);
 *   (3+) экспериментальные HTML-адаптеры брендов/магазинов — только если
 *        включены флагом (их вёрстка/анти-бот нестабильны).
 *
 * Замечание об архитектуре: OpenBeautyFacts стоит вторым (а не четвёртым, как
 * в исходном списке), потому что это EAN-точный и самый надёжный
 * автоматический источник; brand/retailer HTML — best-effort fallback.
 * Любой результат всё равно валидируется isLikelyInci.
 */

import type { EnrichProduct, IngredientProvider, IngredientResult } from "./types";
import { careToBeautyProvider } from "./providers/caretobeauty";
import { openBeautyFactsProvider } from "./providers/openbeautyfacts";
import { EXPERIMENTAL_ADAPTERS, htmlSiteProvider } from "./providers/html-site";

export function buildProviders(opts: { enableHtml?: boolean } = {}): IngredientProvider[] {
  const chain: IngredientProvider[] = [careToBeautyProvider, openBeautyFactsProvider];
  if (opts.enableHtml) {
    for (const a of EXPERIMENTAL_ADAPTERS) chain.push(htmlSiteProvider(a));
  }
  return chain;
}

/** Последовательно опрашивает провайдеры; первый валидный INCI выигрывает. */
export async function resolveIngredients(
  p: EnrichProduct,
  providers: IngredientProvider[],
  log: (m: string) => void,
): Promise<IngredientResult | null> {
  for (const provider of providers) {
    try {
      const r = await provider.getIngredients(p, log);
      if (r && r.inci) return r;
    } catch (e) {
      log(`[${provider.name}] error: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}

export type { EnrichProduct, IngredientProvider, IngredientResult } from "./types";
