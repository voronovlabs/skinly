/**
 * Skinly · self-check парсера Care to Beauty (INCI-валидатор).
 *
 * Запуск:
 *   npm run check:caretobeauty-parser
 *
 * Проверяет:
 *   1. маркетинговый текст «Main Ingredients / How to use» → NULL;
 *   2. реальный INCI-список → возвращается списком;
 *   3. isLikelyInci() отклоняет прозу и принимает настоящий INCI.
 * Exit code 1 при провале. Сети/БД не требует.
 */

import { isLikelyInci, parseProduct } from "./caretobeauty/parser";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Плохой текст из реального бага (EAN 8809933611633): Main Ingredients + How to use.
const BAD_TEXT =
  "such as sage, lavender, and glycerin; Sage purifies, tones, and helps close pores " +
  "while energizing the skin and managing excess oil; Lavender neutralizes redness, " +
  "purifies, and supports acne treatment and skin regeneration; Apply every morning " +
  "and/or evening on wet skin, lather, and rinse with water; avoid the eye area";

const REAL_INCI =
  "Aqua (Water), Glycerin, Sodium Cocoyl Glycinate, Cocamidopropyl Betaine, " +
  "Sodium Chloride, Phenoxyethanol, Parfum, Citric Acid.";

const BAD_HTML = `<h2>Product Description</h2><p>A purifying toner for oily skin.</p>
<p><strong>### Main Ingredients</strong></p>
<p>Care to Beauty updates the product ingredient listings periodically. However, the ingredients list might be changed by the brands without any warning, so please read the ingredients list on the packaging of your product before using.</p>
<ul><li>${BAD_TEXT}</li></ul>
<p><strong>### How to use</strong></p>
<p>Apply every morning and/or evening on wet skin, lather, and rinse with water.</p>
<h2>Manufacturer Information</h2><p>Dr.Jart+</p>`;

const REAL_HTML = `<h2>Product Description</h2><p>A gentle daily cleanser.</p>
<p><strong>### Main Ingredients</strong></p>
<p>Care to Beauty updates the product ingredient listings periodically. However, the ingredients list might be changed by the brands without any warning, so please read the ingredients list on the packaging of your product before using.</p>
<ul><li>Glycerin helps to hydrate the skin.</li></ul>
<p><strong>### Ingredients</strong></p>
<p>Care to Beauty updates the product ingredient listings periodically. However, the ingredients list might be changed by the brands without any warning, so please read the ingredients list on the packaging of your product before using.</p>
<p>${REAL_INCI}</p>
<h2>Safety Warning</h2><p>For external use only.</p>`;

console.log("[check caretobeauty-parser]");

// 3. isLikelyInci напрямую
check("isLikelyInci(BAD_TEXT) === false", isLikelyInci(BAD_TEXT) === false);
check("isLikelyInci(REAL_INCI) === true", isLikelyInci(REAL_INCI) === true);

// 1. плохой HTML → ingredientsRaw NULL
const bad = parseProduct(BAD_HTML, "https://x/bad");
check("BAD_HTML → ingredientsRaw is null", bad.ingredientsRaw === null,
  `got=${JSON.stringify(bad.ingredientsRaw)?.slice(0, 60)}`);

// 2. реальный HTML → ingredientsRaw содержит INCI
const real = parseProduct(REAL_HTML, "https://x/real");
const okReal =
  real.ingredientsRaw != null &&
  /Sodium Cocoyl Glycinate/i.test(real.ingredientsRaw) &&
  /Citric Acid/i.test(real.ingredientsRaw) &&
  !/main ingredients|apply|helps/i.test(real.ingredientsRaw);
check("REAL_HTML → ingredientsRaw = реальный INCI", okReal,
  `got="${(real.ingredientsRaw ?? "null").slice(0, 70)}…"`);

console.log("");
if (failures > 0) {
  console.log(`[check caretobeauty-parser] ❌ FAILED: ${failures}`);
  process.exitCode = 1;
} else {
  console.log("[check caretobeauty-parser] ✅ OK");
}
