/**
 * resolve-compatibility — выбор источника IngredientFact[] для движка.
 *
 *   USE_DM_COMPATIBILITY=false → старый путь: inciToFact(Ingredient.inci) + KB.
 *   USE_DM_COMPATIBILITY=true  → DM-путь: getDmCompatibilityInput(barcode) →
 *                                featuresToFacts(rows); при отсутствии данных
 *                                или ошибке БД — безопасный fallback на legacy.
 *
 * ⚠️ SERVER-ONLY: модуль импортирует репозиторий (prisma). НЕ реэкспортируется
 * из lib/compatibility/index.ts, чтобы баррель оставался client-safe. Импортить
 * только из серверного кода (route handlers, server actions, server components).
 *
 * Сам движок (score.ts/rules.ts/explain.ts) и inciToFact не трогаются.
 */

import {
  getDmCompatibilityInput,
  getDmCompatibilityInputs,
  type DmCompatibilityInput,
} from "@/lib/db/repositories/dm-products";
import { isDmCompatibilityEnabled } from "@/lib/flags";
import { evaluateCompatibility } from "./score";
import { inciToFact } from "./ingredients";
import { featuresToFacts } from "./dm-adapters";
import type {
  CompatibilityProfile,
  CompatibilityResult,
  IngredientFact,
} from "./types";

export interface LegacyIngredient {
  inci: string;
  position: number;
}

export interface ResolveCompatibilityArgs {
  /** EAN/UPC реального товара. null/undefined (mock/demo) → сразу legacy. */
  barcode?: string | null;
  /** Старый источник состава — на случай fallback. */
  legacyIngredients: readonly LegacyIngredient[];
  profile: CompatibilityProfile;
  /** Переопределить флаг (для тестов/batch). По умолчанию читается из env. */
  forceDm?: boolean;
  /**
   * Уже загруженный DM-вход (batch-путь, против N+1).
   *   undefined → функция при необходимости сама сходит в БД;
   *   null      → «уже искали, не нашли» → не ходить в БД, сразу legacy.
   */
  dmInput?: DmCompatibilityInput | null;
}

export interface ResolveCompatibilityResult {
  facts: IngredientFact[];
  result: CompatibilityResult;
  source: "dm" | "legacy";
  recognizedRatio?: number;
  lowConfidence?: boolean;
}

function legacyResult(
  args: ResolveCompatibilityArgs,
): ResolveCompatibilityResult {
  const facts = args.legacyIngredients.map((l) =>
    inciToFact(l.inci, l.position),
  );
  return {
    facts,
    result: evaluateCompatibility(args.profile, facts),
    source: "legacy",
  };
}

function dmResult(
  dm: DmCompatibilityInput,
  profile: CompatibilityProfile,
): ResolveCompatibilityResult {
  const facts = featuresToFacts(dm.rows);
  return {
    facts,
    result: evaluateCompatibility(profile, facts),
    source: "dm",
    recognizedRatio: dm.recognizedRatio,
    lowConfidence: dm.lowConfidence,
  };
}

/**
 * Single-product resolve. Безопасен: любая проблема DM → legacy.
 */
export async function resolveCompatibility(
  args: ResolveCompatibilityArgs,
): Promise<ResolveCompatibilityResult> {
  const useDm = args.forceDm ?? isDmCompatibilityEnabled();

  if (useDm && args.barcode) {
    try {
      const dm =
        args.dmInput !== undefined
          ? args.dmInput
          : await getDmCompatibilityInput(args.barcode);
      if (dm && dm.rows.length > 0) return dmResult(dm, args.profile);
    } catch (e) {
      console.error(
        "[resolveCompatibility] DM path failed, fallback to legacy:",
        e,
      );
    }
  }
  return legacyResult(args);
}

/**
 * Batch resolve для листингов (forMe). Один запрос за весь набор barcode →
 * нет N+1. Порядок результата совпадает с порядком `items`.
 */
export async function resolveCompatibilityBatch(
  profile: CompatibilityProfile,
  items: ReadonlyArray<{
    barcode?: string | null;
    legacyIngredients: readonly LegacyIngredient[];
  }>,
  opts?: { forceDm?: boolean },
): Promise<ResolveCompatibilityResult[]> {
  const useDm = opts?.forceDm ?? isDmCompatibilityEnabled();

  let dmMap = new Map<string, DmCompatibilityInput>();
  if (useDm) {
    const barcodes = items
      .map((i) => i.barcode)
      .filter((b): b is string => !!b);
    if (barcodes.length > 0) {
      try {
        dmMap = await getDmCompatibilityInputs(barcodes);
      } catch (e) {
        console.error(
          "[resolveCompatibilityBatch] DM batch failed, fallback to legacy:",
          e,
        );
      }
    }
  }

  return Promise.all(
    items.map((it) =>
      resolveCompatibility({
        barcode: it.barcode,
        legacyIngredients: it.legacyIngredients,
        profile,
        forceDm: useDm,
        // null = «уже искали в batch, нет» → без повторного запроса.
        dmInput: useDm && it.barcode ? dmMap.get(it.barcode) ?? null : undefined,
      }),
    ),
  );
}
