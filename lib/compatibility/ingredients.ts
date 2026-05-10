/**
 * Compatibility KB — нормализованная база знаний по ингредиентам.
 *
 * Источник правды для:
 *   - per-ingredient «полезен/вреден»
 *   - tags для rules-движка (fragrance, alcohol_drying, exfoliant_bha и т.п.)
 *   - flagsAvoided (зеркально к user.avoidedList)
 *
 * Записи маленькие и плоские — добавление нового ингредиента = новый объект.
 * Никаких giant-switch'ей и if-цепей.
 *
 * Lookup устойчив к:
 *   - разному регистру и пробелам
 *   - суффиксам процентов («Niacinamide 4%»)
 *   - суффиксам ™/® / скобок
 *   - частичному совпадению (в крайнем случае)
 *
 * Если KB не знает ингредиент — engine считает его нейтральным (без штрафов
 * и без бонусов), а финальный `lowConfidence` поднимется, если таких много.
 */

import type {
  AvoidedIngredient,
  SkinConcern,
} from "@/lib/types";
import type { IngredientFact, IngredientTag, KbEntry } from "./types";

/* ───────── KB entries ───────── */

function entry(
  e: Omit<KbEntry, "benefitsFor" | "cautionsFor" | "flagsAvoided" | "tags"> & {
    benefitsFor?: readonly SkinConcern[];
    cautionsFor?: readonly SkinConcern[];
    flagsAvoided?: readonly AvoidedIngredient[];
    tags?: readonly IngredientTag[];
  },
): KbEntry {
  return {
    benefitsFor: [],
    cautionsFor: [],
    flagsAvoided: [],
    tags: [],
    ...e,
  };
}

/**
 * Ядро KB. Намеренно компактно: каждое правило в `rules.ts` опирается ТОЛЬКО
 * на семантические поля (`benefitsFor`, `tags`, `flagsAvoided`), а не на
 * спец-листы конкретных INCI. Поэтому новый ингредиент достаточно описать
 * один раз и он автоматически участвует во всех релевантных правилах.
 */
export const KB: readonly KbEntry[] = [
  /* ── Hydration / barrier — humectants & co. ── */
  entry({
    id: "hyaluronic_acid",
    inci: "Sodium Hyaluronate",
    aliases: [
      "hyaluronic acid",
      "sodium hyaluronate",
      "sodium hyaluronate crosspolymer",
      "hydrolyzed hyaluronic acid",
    ],
    benefitsFor: [],
    tags: ["humectant", "barrier"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "glycerin",
    inci: "Glycerin",
    aliases: ["glycerine"],
    tags: ["humectant"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "panthenol",
    inci: "Panthenol",
    aliases: ["pantothenic acid", "vitamin b5", "d-panthenol"],
    tags: ["humectant", "soothing", "barrier"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "betaine",
    inci: "Betaine",
    aliases: [],
    tags: ["humectant"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "ceramide",
    inci: "Ceramide NP",
    aliases: [
      "ceramide",
      "ceramide np",
      "ceramide ap",
      "ceramide eop",
      "phytoceramides",
      "procerad",
    ],
    benefitsFor: ["aging"],
    tags: ["barrier", "occlusive"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "squalane",
    inci: "Squalane",
    aliases: ["plant squalane"],
    tags: ["occlusive"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "snail_mucin",
    inci: "Snail Secretion Filtrate",
    aliases: ["snail mucin"],
    tags: ["humectant", "barrier", "soothing"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "allantoin",
    inci: "Allantoin",
    aliases: [],
    tags: ["soothing"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "centella",
    inci: "Centella Asiatica Extract",
    aliases: ["cica", "centella asiatica", "madecassoside", "asiaticoside"],
    benefitsFor: ["redness"],
    tags: ["soothing", "antioxidant"],
    baseSafety: "beneficial",
  }),

  /* ── Actives ── */
  entry({
    id: "niacinamide",
    inci: "Niacinamide",
    aliases: ["nicotinamide", "vitamin b3"],
    benefitsFor: ["acne", "redness", "pigmentation", "pores"],
    tags: ["active", "barrier", "antioxidant"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "salicylic_acid",
    inci: "Salicylic Acid",
    aliases: ["bha"],
    benefitsFor: ["acne", "blackheads", "pores"],
    cautionsFor: [],
    tags: ["active", "exfoliant_bha"],
    baseSafety: "caution",
  }),
  entry({
    id: "glycolic_acid",
    inci: "Glycolic Acid",
    aliases: ["aha"],
    benefitsFor: ["pigmentation", "aging"],
    tags: ["active", "exfoliant_aha"],
    baseSafety: "caution",
  }),
  entry({
    id: "lactic_acid",
    inci: "Lactic Acid",
    aliases: [],
    benefitsFor: ["pigmentation", "aging"],
    tags: ["active", "exfoliant_aha", "humectant"],
    baseSafety: "caution",
  }),
  entry({
    id: "mandelic_acid",
    inci: "Mandelic Acid",
    aliases: [],
    benefitsFor: ["pigmentation", "acne"],
    tags: ["active", "exfoliant_aha"],
    baseSafety: "caution",
  }),
  entry({
    id: "azelaic_acid",
    inci: "Azelaic Acid",
    aliases: [],
    benefitsFor: ["acne", "redness", "pigmentation"],
    tags: ["active"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "retinol",
    inci: "Retinol",
    aliases: ["retinaldehyde", "retinyl palmitate", "retinyl retinoate"],
    benefitsFor: ["aging", "acne", "pigmentation"],
    tags: ["active", "retinoid"],
    baseSafety: "caution",
  }),
  entry({
    id: "bakuchiol",
    inci: "Bakuchiol",
    aliases: [],
    benefitsFor: ["aging"],
    tags: ["active", "antioxidant"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "vitamin_c",
    inci: "Ascorbic Acid",
    aliases: [
      "l-ascorbic acid",
      "vitamin c",
      "ascorbyl glucoside",
      "magnesium ascorbyl phosphate",
      "tetrahexyldecyl ascorbate",
      "ascorbyl tetraisopalmitate",
    ],
    benefitsFor: ["pigmentation", "aging"],
    tags: ["active", "vitamin_c", "antioxidant"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "zinc_pca",
    inci: "Zinc PCA",
    aliases: ["zinc gluconate"],
    benefitsFor: ["acne", "pores"],
    tags: ["active"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "tea_tree_oil",
    inci: "Melaleuca Alternifolia Leaf Oil",
    aliases: ["tea tree oil"],
    benefitsFor: ["acne"],
    cautionsFor: ["redness"],
    tags: ["essential_oil"],
    baseSafety: "caution",
  }),
  entry({
    id: "green_tea",
    inci: "Camellia Sinensis Leaf Extract",
    aliases: ["green tea extract"],
    benefitsFor: ["redness", "aging"],
    tags: ["antioxidant", "soothing"],
    baseSafety: "beneficial",
  }),

  /* ── Avoided list — отдушки / спирты / SLS / парабены / эфирные масла ── */
  entry({
    id: "fragrance",
    inci: "Parfum",
    aliases: ["fragrance", "perfume"],
    cautionsFor: ["redness"],
    flagsAvoided: ["fragrance"],
    tags: ["fragrance"],
    baseSafety: "caution",
  }),
  entry({
    id: "linalool",
    inci: "Linalool",
    aliases: [],
    flagsAvoided: ["fragrance"],
    tags: ["fragrance"],
    baseSafety: "caution",
  }),
  entry({
    id: "limonene",
    inci: "Limonene",
    aliases: [],
    flagsAvoided: ["fragrance"],
    tags: ["fragrance"],
    baseSafety: "caution",
  }),
  entry({
    id: "alcohol_denat",
    inci: "Alcohol Denat",
    aliases: ["denatured alcohol", "ethanol", "sd alcohol"],
    flagsAvoided: ["alcohol"],
    tags: ["alcohol_drying"],
    baseSafety: "caution",
  }),
  entry({
    id: "isopropyl_alcohol",
    inci: "Isopropyl Alcohol",
    aliases: ["ipa"],
    flagsAvoided: ["alcohol"],
    tags: ["alcohol_drying"],
    baseSafety: "caution",
  }),
  entry({
    id: "sls",
    inci: "Sodium Lauryl Sulfate",
    aliases: ["sls"],
    flagsAvoided: ["sulfates"],
    tags: ["sulfate_surfactant"],
    baseSafety: "caution",
  }),
  entry({
    id: "sles",
    inci: "Sodium Laureth Sulfate",
    aliases: ["sles"],
    flagsAvoided: ["sulfates"],
    tags: ["sulfate_surfactant"],
    baseSafety: "caution",
  }),
  entry({
    id: "methylparaben",
    inci: "Methylparaben",
    aliases: ["propylparaben", "ethylparaben", "butylparaben"],
    flagsAvoided: ["parabens"],
    tags: ["paraben"],
    baseSafety: "neutral",
  }),
  entry({
    id: "lavender_oil",
    inci: "Lavandula Angustifolia Oil",
    aliases: ["lavender oil"],
    flagsAvoided: ["essential_oils"],
    cautionsFor: ["redness"],
    tags: ["essential_oil", "fragrance"],
    baseSafety: "caution",
  }),
  entry({
    id: "peppermint_oil",
    inci: "Mentha Piperita Oil",
    aliases: ["peppermint oil"],
    flagsAvoided: ["essential_oils"],
    cautionsFor: ["redness"],
    tags: ["essential_oil"],
    baseSafety: "caution",
  }),
  entry({
    id: "eucalyptus_oil",
    inci: "Eucalyptus Globulus Oil",
    aliases: ["eucalyptus oil"],
    flagsAvoided: ["essential_oils"],
    tags: ["essential_oil"],
    baseSafety: "caution",
  }),

  /* ── Comedogenic / heavy oils ── */
  entry({
    id: "coconut_oil",
    inci: "Cocos Nucifera Oil",
    aliases: ["coconut oil"],
    cautionsFor: ["acne", "blackheads"],
    tags: ["comedogenic_oil", "occlusive", "heavy_oil"],
    baseSafety: "caution",
  }),
  entry({
    id: "isopropyl_myristate",
    inci: "Isopropyl Myristate",
    aliases: [],
    cautionsFor: ["acne"],
    tags: ["comedogenic_oil"],
    baseSafety: "caution",
  }),
  entry({
    id: "shea_butter",
    inci: "Butyrospermum Parkii Butter",
    aliases: ["shea butter"],
    tags: ["heavy_oil", "occlusive"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "petrolatum",
    inci: "Petrolatum",
    aliases: ["petroleum jelly"],
    tags: ["occlusive", "heavy_oil"],
    baseSafety: "neutral",
  }),
  entry({
    id: "mineral_oil",
    inci: "Mineral Oil",
    aliases: ["paraffinum liquidum"],
    tags: ["occlusive", "heavy_oil"],
    baseSafety: "neutral",
  }),

  /* ── UV filters ── */
  entry({
    id: "zinc_oxide",
    inci: "Zinc Oxide",
    aliases: [],
    tags: ["physical_filter"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "titanium_dioxide",
    inci: "Titanium Dioxide",
    aliases: [],
    tags: ["physical_filter"],
    baseSafety: "beneficial",
  }),
  entry({
    id: "octinoxate",
    inci: "Ethylhexyl Methoxycinnamate",
    aliases: ["octinoxate"],
    tags: ["chemical_filter"],
    baseSafety: "neutral",
  }),
  entry({
    id: "avobenzone",
    inci: "Butyl Methoxydibenzoylmethane",
    aliases: ["avobenzone"],
    tags: ["chemical_filter"],
    baseSafety: "neutral",
  }),
];

/* ───────── Lookup ───────── */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    // выкинуть процентные суффиксы вроде «4 %» / «4%»
    .replace(/\d+(?:[.,]\d+)?\s*%/g, "")
    // ™/® и т.п.
    .replace(/[™®©]/g, "")
    // знаки препинания/слешы → пробел
    .replace(/[._/\-]+/g, " ")
    // схлопнуть пробелы
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP: Map<string, KbEntry> = (() => {
  const m = new Map<string, KbEntry>();
  for (const e of KB) {
    m.set(normalize(e.inci), e);
    for (const a of e.aliases) m.set(normalize(a), e);
  }
  return m;
})();

/**
 * Найти KB-entry для INCI-строки. Возвращает null, если ни один из
 * вариантов не подошёл. Никогда не бросает — на пустую строку вернёт null.
 */
export function findKbEntry(inci: string): KbEntry | null {
  if (!inci) return null;
  const n = normalize(inci);
  if (!n) return null;

  // 1) точное совпадение
  const direct = LOOKUP.get(n);
  if (direct) return direct;

  // 2) убрать всё после первой скобки (часто там описания типа «(Plant Source)»)
  const beforeParen = n.split("(")[0]?.trim();
  if (beforeParen && beforeParen !== n) {
    const hit = LOOKUP.get(beforeParen);
    if (hit) return hit;
  }

  // 3) частичное совпадение — KB-токен является подстрокой входа.
  //    Полезно для случаев вроде «Niacinamide 4%» (после нормализации
  //    остаётся «niacinamide»; если бы остался «niacinamide 4», fallback
  //    подхватит; и для «Hydrolyzed Hyaluronic Acid (Plant Source)»).
  for (const [key, value] of LOOKUP) {
    if (key.length < 4) continue; // не давать слишком коротким ключам триггерить шум
    if (n.includes(key)) return value;
  }

  return null;
}

/* ───────── Convert KB → IngredientFact ───────── */

/**
 * Превратить INCI-строку (и опц. позицию в составе) в IngredientFact.
 * Если KB не знает — возвращается «нейтральный» Fact: без бонусов и штрафов.
 */
export function inciToFact(inci: string, position = 0): IngredientFact {
  const kb = findKbEntry(inci);
  if (!kb) {
    return {
      inci,
      position,
      kbId: null,
      benefitsFor: [],
      cautionsFor: [],
      flagsAvoided: [],
      tags: [],
      baseSafety: "neutral",
    };
  }
  return {
    inci,
    position,
    kbId: kb.id,
    benefitsFor: kb.benefitsFor,
    cautionsFor: kb.cautionsFor,
    flagsAvoided: kb.flagsAvoided,
    tags: kb.tags,
    baseSafety: kb.baseSafety,
  };
}

/**
 * Удобный helper: список INCI → массив Fact'ов с порядковыми позициями.
 */
export function inciListToFacts(
  list: ReadonlyArray<{ inci: string; position?: number }>,
): IngredientFact[] {
  return list.map((x, i) => inciToFact(x.inci, x.position ?? i + 1));
}

/* ───────── Recognition ratio ───────── */

/**
 * Доля распознанных ингредиентов. 1.0 — все попали в KB; 0.0 — ни одного.
 */
export function recognitionRatio(facts: readonly IngredientFact[]): number {
  if (facts.length === 0) return 0;
  const known = facts.filter((f) => f.kbId !== null).length;
  return known / facts.length;
}
