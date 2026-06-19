/**
 * Smoke-тест для lib/compatibility/dm-adapters.ts (Stage 2, шаг 1).
 *
 * Чистая проверка маппинга и derive — без БД, без движка. Падает с кодом 1,
 * если правило сломано.
 *
 * Запуск:
 *   npx tsx scripts/smoke-dm-adapters.ts
 *
 * (dm-adapters импортирует типы через `import type` → они стираются на
 *  рантайме, поэтому путь-алиас `@/` для исполнения не требуется.)
 */

import {
  deriveBaseSafety,
  dmRowToFact,
  featuresToFacts,
  type DmIngredientRow,
} from "../lib/compatibility/dm-adapters";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    console.error(`  FAIL ${name}`);
    failures++;
  }
}

function row(over: Partial<DmIngredientRow>): DmIngredientRow {
  return {
    canonical_id: "x",
    position: 1,
    inci_name: "X",
    display_ru: "Икс",
    display_en: "X",
    tags: [],
    benefits_for: [],
    cautions_for: [],
    flags_avoided: [],
    comedogenicity: 0,
    irritancy: 0,
    allergenicity: 0,
    ...over,
  };
}

// 1) fragrance → caution + flagsAvoided includes fragrance, tags whitelist
const fragrance = dmRowToFact(
  row({
    canonical_id: "fragrance",
    inci_name: "Parfum",
    tags: ["fragrance", "allergen"],
    cautions_for: ["redness"],
    flags_avoided: ["fragrance"],
    irritancy: 1,
    allergenicity: 3,
  }),
);
check("fragrance → baseSafety caution", fragrance.baseSafety === "caution");
check("fragrance → flagsAvoided has fragrance", fragrance.flagsAvoided.includes("fragrance"));
check("fragrance → tags drop 'allergen', keep 'fragrance'",
  fragrance.tags.length === 1 && fragrance.tags.includes("fragrance"));
check("fragrance → cautionsFor has redness", fragrance.cautionsFor.includes("redness"));
check("fragrance → kbId = canonical_id", fragrance.kbId === "fragrance");

// 2) glycerin → beneficial (humectant tag)
const glycerin = dmRowToFact(row({ canonical_id: "glycerin", tags: ["humectant"] }));
check("glycerin → baseSafety beneficial", glycerin.baseSafety === "beneficial");

// 3) colorant_ci → neutral (irr/all < 2, no benefits, no beneficial tags)
const ci = dmRowToFact(row({ canonical_id: "colorant_ci", tags: [], allergenicity: 1 }));
check("colorant_ci → baseSafety neutral", ci.baseSafety === "neutral");

// 4) alcohol → caution (flag alcohol)
const alcohol = dmRowToFact(
  row({ canonical_id: "alcohol", tags: ["alcohol_drying"], flags_avoided: ["alcohol"], irritancy: 2 }),
);
check("alcohol → baseSafety caution", alcohol.baseSafety === "caution");
check("alcohol → flagsAvoided has alcohol", alcohol.flagsAvoided.includes("alcohol"));

// 5) unknown/custom tags + non-concern benefits/cautions are filtered out
const hairDye = dmRowToFact(
  row({
    canonical_id: "p_phenylenediamine",
    tags: ["hair_dye", "color_chemistry", "bogus", "humectant"],
    benefits_for: ["acne", "dryness", "damaged_hair"],
    cautions_for: ["redness", "sensitive"],
    irritancy: 2,
  }),
);
check("custom tags filtered (only humectant kept)",
  hairDye.tags.length === 1 && hairDye.tags.includes("humectant"));
check("benefits_for filtered to SkinConcern (only acne)",
  hairDye.benefitsFor.length === 1 && hairDye.benefitsFor.includes("acne"));
check("cautions_for filtered to SkinConcern (only redness)",
  hairDye.cautionsFor.length === 1 && hairDye.cautionsFor.includes("redness"));

// 6) derive precedence: irritancy>=2 wins over beneficial tag
check("caution precedence over beneficial",
  deriveBaseSafety(row({ tags: ["humectant"], irritancy: 2 })) === "caution");
check("allergenicity>=2 → caution",
  deriveBaseSafety(row({ allergenicity: 2 })) === "caution");
check("benefits_for non-empty → beneficial",
  deriveBaseSafety(row({ benefits_for: ["acne"] })) === "beneficial");
check("empty everything → neutral", deriveBaseSafety(row({})) === "neutral");

// 7) featuresToFacts preserves order + locale display fallback
const facts = featuresToFacts(
  [row({ canonical_id: "a", position: 1 }), row({ canonical_id: "b", position: 2 })],
  "en",
);
check("featuresToFacts length/order", facts.length === 2 && facts[0].kbId === "a" && facts[1].kbId === "b");
const noInci = dmRowToFact(row({ inci_name: null, display_en: "Disp", display_ru: null }), "en");
check("inci fallback to display when inci_name null", noInci.inci === "Disp");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
