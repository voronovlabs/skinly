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
import { NOOP_COMPAT_TIMER, type CompatTimer } from "./timing";
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

/**
 * Минимальная доля распознанных ингредиентов, при которой DM-результат можно
 * отдавать. Ниже — DM считается ненадёжным (например, recognizedRatio=0 с
 * пустыми facts), и мы откатываемся на legacy. Совпадает с порогом
 * lowConfidence в репозитории.
 */
const MIN_DM_RECOGNIZED_RATIO = 0.3;

/** DM-вход пригоден к использованию (есть состав и распознано достаточно). */
function isUsableDmInput(
  dm: DmCompatibilityInput | null | undefined,
): dm is DmCompatibilityInput {
  return (
    !!dm &&
    dm.rows.length > 0 &&
    dm.recognizedRatio >= MIN_DM_RECOGNIZED_RATIO
  );
}

function legacyResult(
  args: ResolveCompatibilityArgs,
  timer: CompatTimer = NOOP_COMPAT_TIMER,
): ResolveCompatibilityResult {
  const facts = timer.timeSync("featuresToFacts(legacy)", () =>
    args.legacyIngredients.map((l) => inciToFact(l.inci, l.position)),
  );
  const result = timer.timeSync("evaluateCompatibility", () =>
    evaluateCompatibility(args.profile, facts),
  );
  return { facts, result, source: "legacy" };
}

function dmResult(
  dm: DmCompatibilityInput,
  profile: CompatibilityProfile,
  timer: CompatTimer = NOOP_COMPAT_TIMER,
): ResolveCompatibilityResult {
  const facts = timer.timeSync("featuresToFacts", () =>
    featuresToFacts(dm.rows),
  );
  const result = timer.timeSync("evaluateCompatibility", () =>
    evaluateCompatibility(profile, facts),
  );
  return {
    facts,
    result,
    source: "dm",
    recognizedRatio: dm.recognizedRatio,
    lowConfidence: dm.lowConfidence,
  };
}

/**
 * Single-product resolve. Безопасен: любая проблема DM → legacy.
 * `timer` — опциональное профилирование (COMPAT_TIMING=1); noop по умолчанию,
 * поведение не меняет.
 */
export async function resolveCompatibility(
  args: ResolveCompatibilityArgs,
  timer: CompatTimer = NOOP_COMPAT_TIMER,
): Promise<ResolveCompatibilityResult> {
  const useDm = args.forceDm ?? isDmCompatibilityEnabled();

  if (useDm && args.barcode) {
    try {
      const dm =
        args.dmInput !== undefined
          ? args.dmInput
          : await timer.time("dmCompatibilityInputs", () =>
              getDmCompatibilityInput(args.barcode!),
            );
      // DM используем только если он есть, в нём есть состав И распознано
      // достаточно (recognizedRatio >= 0.3). Иначе — legacy.
      if (isUsableDmInput(dm)) {
        if (timer.enabled) {
          // Объёмы пишем только для single-product вызова (batch уже
          // отчитался кумулятивно как batchDmRows/batchDmInputs).
          if (args.dmInput === undefined) {
            timer.count("dmRows", dm.rows.length);
            timer.count("totalIngredients", dm.totalIngredients);
            timer.note(
              `source=dm recognized=${dm.recognizedRatio.toFixed(2)}`,
            );
          } else {
            timer.note("source=dm(batch)");
          }
        }
        return dmResult(dm, args.profile, timer);
      }
    } catch (e) {
      console.error(
        "[resolveCompatibility] DM path failed, fallback to legacy:",
        e,
      );
    }
  }
  if (timer.enabled) {
    timer.count("legacyIngredients", args.legacyIngredients.length);
    timer.note("source=legacy");
  }
  return legacyResult(args, timer);
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
  opts?: { forceDm?: boolean; timer?: CompatTimer },
): Promise<ResolveCompatibilityResult[]> {
  const useDm = opts?.forceDm ?? isDmCompatibilityEnabled();
  const timer = opts?.timer ?? NOOP_COMPAT_TIMER;

  let dmMap = new Map<string, DmCompatibilityInput>();
  if (useDm) {
    const barcodes = items
      .map((i) => i.barcode)
      .filter((b): b is string => !!b);
    if (barcodes.length > 0) {
      try {
        dmMap = await timer.time("dmCompatibilityInputs(batch)", () =>
          getDmCompatibilityInputs(barcodes),
        );
        if (timer.enabled) {
          timer.count("batchBarcodes", barcodes.length);
          timer.count("batchDmInputs", dmMap.size);
          let rows = 0;
          for (const dm of dmMap.values()) rows += dm.rows.length;
          timer.count("batchDmRows", rows);
        }
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
        // Порог recognizedRatio применяется в resolveCompatibility поштучно,
        // поэтому товары с пустым/слабым DM падают на legacy индивидуально.
        dmInput: useDm && it.barcode ? dmMap.get(it.barcode) ?? null : undefined,
      }),
    ),
  );
}
