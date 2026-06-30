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
import { cleanObfIngredients } from "./enrich/ingredients/providers/openbeautyfacts";

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

// 4. РЕАЛЬНАЯ страница CeraVe (cerave-intensive-moisturizing-cream-340g):
// AI-описание с маркетинговыми буллетами, БЕЗ секции INCI. Должно быть NULL
// (не выдёргивать «active ingredients»/«ceramides»/«hyaluronic acid» как INCI).
const CERAVE_HTML = `<h2>Product Description</h2>
<p><strong>CeraVe Intensive Moisturizing Cream 340g</strong> is designed to restore the feel of soft, hydrated skin while providing soothing comfort from head to toe.</p>
<p>Key features include:</p>
<ul>
<li>Rich and comforting consistency for intensive moisturization;</li>
<li>Formulated with three essential ceramides to support the skin barrier;</li>
<li>Contains hyaluronic acid for moisture retention;</li>
<li>Includes 5% hydro-urea to enhance hydrating properties;</li>
<li>MVE Delivery Technology gradually releases active ingredients for lasting hydration up to 72 hours;</li>
<li>Non-sticky formula allows for easy application across the body;</li>
<li>Fast-absorbing to keep dryness at bay.</li>
</ul>
<p><strong>## Manufacturer Information</strong></p>
<p>CeraVe 62, Quai Charles Pasqua France</p>`;
const cerave = parseProduct(CERAVE_HTML, "https://x/cerave");
check("CeraVe (нет INCI на странице) → ingredientsRaw is null",
  cerave.ingredientsRaw === null,
  `got=${JSON.stringify(cerave.ingredientsRaw)?.slice(0, 60)}`);
check("CeraVe → description есть и обрезано до Manufacturer Information",
  cerave.description != null && /Key features/i.test(cerave.description) &&
  !/Manufacturer Information|consumidor/i.test(cerave.description),
  `len=${cerave.description?.length ?? 0}`);

// 5. OpenBeautyFacts dirty ingredients_text (EAN 3337875597296):
// manufacturer/address prefix before the real INCI must be cleaned away.
const OBF_DIRTY =
  "Producător: CeraVe LLC, New York, NY 10022, USA. Ingredients: Aqua/Water, " +
  "Glycerin, Caprylic/Capric Triglyceride, Cetearyl Alcohol, Ceramide NP, " +
  "Ceramide AP, Ceramide EOP, Carbomer, Dimethicone, Behentrimonium Methosulfate, " +
  "Sodium Lauroyl Lactylate, Cholesterol, Phenoxyethanol, Disodium EDTA, " +
  "Tocopherol, Phytosphingosine, Xanthan Gum, Ethylhexylglycerin.";
const cleaned = cleanObfIngredients(OBF_DIRTY);
check("OBF dirty (3337875597296) → cleaned, no manufacturer junk",
  cleaned != null &&
    !/produc|new york|\bllc\b|usa\b/i.test(cleaned) &&
    /^Aqua\/Water/i.test(cleaned) &&
    isLikelyInci(cleaned),
  `got="${(cleaned ?? "null").slice(0, 60)}…"`);

// no 'ingredients:' marker + manufacturer markers present → reject (null)
const OBF_NOLIST = "Producător: CeraVe LLC, New York. Aqua, Glycerin, Tocopherol.";
check("OBF manufacturer-only (no 'ingredients:') → null",
  cleanObfIngredients(OBF_NOLIST) === null,
  `got=${JSON.stringify(cleanObfIngredients(OBF_NOLIST))?.slice(0, 50)}`);

console.log("");
if (failures > 0) {
  console.log(`[check caretobeauty-parser] ❌ FAILED: ${failures}`);
  process.exitCode = 1;
} else {
  console.log("[check caretobeauty-parser] ✅ OK");
}
