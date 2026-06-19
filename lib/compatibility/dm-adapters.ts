/**
 * DM → engine adapter (Stage 2, шаг 1).
 *
 * Превращает строки канонического слоя `dm.*` (как их отдаёт
 * data-access поверх dm.product_ingredient_features + dm.ingredient_properties)
 * в `IngredientFact[]` — ровно ту же форму, что строит старый `inciToFact`.
 *
 * Полностью PURE: без БД, без Date.now, без рандома — server- и client-safe,
 * как и остальной движок. Сам SQL-запрос живёт в репозитории (отдельный шаг);
 * здесь только маппинг уже загруженных строк.
 *
 * Что НЕ трогаем: score.ts / rules.ts / explain.ts / adapters.ts / inciToFact.
 * Этот файл пока никуда не подключён (нет feature flag, нет API-изменений).
 */

import type { AvoidedIngredient, SkinConcern } from "@/lib/types";
import type {
  IngredientFact,
  IngredientSafety,
  IngredientTag,
} from "./types";

/* ───────── Входной тип (одна строка состава из DM) ───────── */

export interface DmIngredientRow {
  canonical_id: string;
  position: number;
  inci_name: string | null;
  display_ru: string | null;
  display_en: string | null;
  tags: string[];
  benefits_for: string[];
  cautions_for: string[];
  flags_avoided: string[];
  comedogenicity: number;
  irritancy: number;
  allergenicity: number;
}

/* ───────── Whitelists (значения, которые понимает движок) ───────── */

/** Совпадает с union `IngredientTag` из ./types. */
const VALID_TAGS: ReadonlySet<IngredientTag> = new Set<IngredientTag>([
  "humectant",
  "barrier",
  "soothing",
  "occlusive",
  "exfoliant_aha",
  "exfoliant_bha",
  "exfoliant_pha",
  "retinoid",
  "vitamin_c",
  "antioxidant",
  "fragrance",
  "alcohol_drying",
  "essential_oil",
  "comedogenic_oil",
  "heavy_oil",
  "physical_filter",
  "chemical_filter",
  "sulfate_surfactant",
  "paraben",
  "active",
]);

/** Совпадает с union `SkinConcern` из @/lib/types. */
const VALID_CONCERNS: ReadonlySet<SkinConcern> = new Set<SkinConcern>([
  "acne",
  "aging",
  "pigmentation",
  "redness",
  "pores",
  "blackheads",
]);

/** Совпадает с union `AvoidedIngredient` из @/lib/types. */
const VALID_AVOIDED: ReadonlySet<AvoidedIngredient> = new Set<AvoidedIngredient>(
  ["fragrance", "alcohol", "sulfates", "parabens", "essential_oils"],
);

/** Теги, по которым ингредиент считается «полезным» по умолчанию. */
const BENEFICIAL_TAGS: ReadonlySet<IngredientTag> = new Set<IngredientTag>([
  "active",
  "humectant",
  "barrier",
  "soothing",
]);

function keepKnown<T extends string>(
  values: readonly string[],
  allowed: ReadonlySet<T>,
): T[] {
  const out: T[] = [];
  for (const v of values) {
    if (allowed.has(v as T)) out.push(v as T);
  }
  return out;
}

/* ───────── baseSafety derivation ───────── */

/**
 * Базовая безопасность ингредиента с учётом DM-свойств.
 * Порядок важен: caution имеет приоритет над beneficial.
 *
 *   - flags_avoided не пуст | irritancy ≥ 2 | allergenicity ≥ 2 → "caution"
 *   - benefits_for не пуст | tags ∋ {active|humectant|barrier|soothing} → "beneficial"
 *   - иначе → "neutral"
 *
 * "danger" здесь не присваивается — он вычисляется в explain.ts из rule-hits
 * (avoidedFlag / sensitiveTrigger) с учётом профиля. Поведение совместимо со
 * старым движком.
 */
export function deriveBaseSafety(row: DmIngredientRow): IngredientSafety {
  if (
    row.flags_avoided.length > 0 ||
    row.irritancy >= 2 ||
    row.allergenicity >= 2
  ) {
    return "caution";
  }

  const hasBeneficialTag = row.tags.some((t) =>
    BENEFICIAL_TAGS.has(t as IngredientTag),
  );
  if (row.benefits_for.length > 0 || hasBeneficialTag) {
    return "beneficial";
  }

  return "neutral";
}

/* ───────── Row → Fact ───────── */

/**
 * Одна DM-строка → IngredientFact.
 *
 *   canonical_id            → kbId
 *   inci_name / display     → inci  (стабильный ключ; UI-имя может прийти отдельно)
 *   position                → position
 *   tags (whitelist)        → tags
 *   benefits_for (concerns) → benefitsFor
 *   cautions_for (concerns) → cautionsFor
 *   flags_avoided (avoided) → flagsAvoided
 *   derive                  → baseSafety
 *
 * Незнакомые движку значения (tags `allergen/hair_dye/...`, benefits `dryness/…`)
 * отфильтровываются — они inert для правил, но загрязняли бы типы.
 */
export function dmRowToFact(
  row: DmIngredientRow,
  locale: "ru" | "en" = "ru",
): IngredientFact {
  const display = locale === "en" ? row.display_en : row.display_ru;
  const inci = row.inci_name ?? display ?? row.canonical_id;

  return {
    inci,
    position: row.position,
    kbId: row.canonical_id,
    benefitsFor: keepKnown<SkinConcern>(row.benefits_for, VALID_CONCERNS),
    cautionsFor: keepKnown<SkinConcern>(row.cautions_for, VALID_CONCERNS),
    flagsAvoided: keepKnown<AvoidedIngredient>(row.flags_avoided, VALID_AVOIDED),
    tags: keepKnown<IngredientTag>(row.tags, VALID_TAGS),
    baseSafety: deriveBaseSafety(row),
  };
}

/**
 * Список DM-строк → IngredientFact[]. Порядок сохраняется (вызывающий обычно
 * уже отсортировал по position в SQL).
 */
export function featuresToFacts(
  rows: readonly DmIngredientRow[],
  locale: "ru" | "en" = "ru",
): IngredientFact[] {
  return rows.map((r) => dmRowToFact(r, locale));
}
