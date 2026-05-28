/**
 * Skinly · seed · 100 demo products
 *
 * Запуск локально:
 *   DATABASE_URL=postgresql://skinly:skinly@localhost:5432/skinly npx tsx scripts/seed-demo-products.ts
 *
 * Запуск в Docker:
 *   docker compose -f docker-compose.yml -f docker-compose.local.yml --profile tools \
 *     run --rm tools npx tsx scripts/seed-demo-products.ts
 *
 * Идемпотентен: upsert по barcode.
 */

import { PrismaClient, ProductCategory } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Ингредиентная база ─────────────────────────────────────────────────────

interface IngredientDef {
  inci: string;
  nameRu: string;
}

const INGREDIENTS: IngredientDef[] = [
  { inci: "Aqua", nameRu: "Вода" },
  { inci: "Glycerin", nameRu: "Глицерин" },
  { inci: "Niacinamide", nameRu: "Ниацинамид" },
  { inci: "Hyaluronic Acid", nameRu: "Гиалуроновая кислота" },
  { inci: "Panthenol", nameRu: "Пантенол" },
  { inci: "Centella Asiatica Extract", nameRu: "Экстракт центеллы азиатской" },
  { inci: "Ceramide NP", nameRu: "Керамид NP" },
  { inci: "Retinol", nameRu: "Ретинол" },
  { inci: "Salicylic Acid", nameRu: "Салициловая кислота" },
  { inci: "Ascorbic Acid", nameRu: "Витамин C (аскорбиновая кислота)" },
  { inci: "Zinc PCA", nameRu: "Цинк PCA" },
  { inci: "Adenosine", nameRu: "Аденозин" },
  { inci: "Allantoin", nameRu: "Аллантоин" },
  { inci: "Sodium Hyaluronate", nameRu: "Гиалуронат натрия" },
  { inci: "Snail Secretion Filtrate", nameRu: "Фильтрат секрета улитки" },
  { inci: "Propylene Glycol", nameRu: "Пропиленгликоль" },
  { inci: "Butylene Glycol", nameRu: "Бутиленгликоль" },
  { inci: "Dimethicone", nameRu: "Диметикон" },
  { inci: "Cyclopentasiloxane", nameRu: "Циклопентасилоксан" },
  { inci: "Cetearyl Alcohol", nameRu: "Цетеариловый спирт" },
  { inci: "Stearic Acid", nameRu: "Стеариновая кислота" },
  { inci: "Palmitic Acid", nameRu: "Пальмитиновая кислота" },
  { inci: "Tocopherol", nameRu: "Токоферол (витамин E)" },
  { inci: "Ferulic Acid", nameRu: "Феруловая кислота" },
  { inci: "Azelaic Acid", nameRu: "Азелаиновая кислота" },
  { inci: "Glycolic Acid", nameRu: "Гликолевая кислота" },
  { inci: "Lactic Acid", nameRu: "Молочная кислота" },
  { inci: "Mandelic Acid", nameRu: "Миндальная кислота" },
  { inci: "Tranexamic Acid", nameRu: "Транексамовая кислота" },
  { inci: "Kojic Acid", nameRu: "Кислота койевая" },
  { inci: "Arbutin", nameRu: "Арбутин" },
  { inci: "Licorice Root Extract", nameRu: "Экстракт корня солодки" },
  { inci: "Green Tea Extract", nameRu: "Экстракт зелёного чая" },
  { inci: "Aloe Vera Leaf Juice", nameRu: "Сок листьев алоэ вера" },
  { inci: "Rose Hip Oil", nameRu: "Масло шиповника" },
  { inci: "Jojoba Oil", nameRu: "Масло жожоба" },
  { inci: "Squalane", nameRu: "Скваланe" },
  { inci: "Sodium PCA", nameRu: "Натрий PCA" },
  { inci: "Betaine", nameRu: "Бетаин" },
  { inci: "Xanthan Gum", nameRu: "Ксантановая камедь" },
  { inci: "Carbomer", nameRu: "Карбомер" },
  { inci: "Sodium Lauryl Sulfate", nameRu: "Лаурилсульфат натрия" },
  { inci: "Cocamidopropyl Betaine", nameRu: "Кокамидопропилбетаин" },
  { inci: "Phenoxyethanol", nameRu: "Феноксиэтанол" },
  { inci: "Ethylhexylglycerin", nameRu: "Этилгексилглицерин" },
  { inci: "Parfum", nameRu: "Отдушка" },
  { inci: "Titanium Dioxide", nameRu: "Диоксид титана" },
  { inci: "Zinc Oxide", nameRu: "Оксид цинка" },
  { inci: "Octocrylene", nameRu: "Октокрилен" },
  { inci: "Ethylhexyl Methoxycinnamate", nameRu: "Этилгексил метоксициннамат" },
];

// ─── Шаблоны продуктов ──────────────────────────────────────────────────────

interface ProductTemplate {
  brand: string;
  name: string;
  category: ProductCategory;
  emoji: string;
  ingredientIds: number[]; // индексы в INGREDIENTS
}

const TEMPLATES: ProductTemplate[] = [
  // CLEANSER
  { brand: "CeraVe", name: "Увлажняющий очищающий гель", category: ProductCategory.CLEANSER, emoji: "🧴", ingredientIds: [0, 1, 6, 19, 44, 45] },
  { brand: "La Roche-Posay", name: "Toleriane Hydrating Gentle Cleanser", category: ProductCategory.CLEANSER, emoji: "🧴", ingredientIds: [0, 1, 12, 38, 44, 45] },
  { brand: "COSRX", name: "Low pH Good Morning Gel Cleanser", category: ProductCategory.CLEANSER, emoji: "🧴", ingredientIds: [0, 8, 42, 39, 44] },
  { brand: "Paula's Choice", name: "RESIST Perfectly Balanced Foaming Cleanser", category: ProductCategory.CLEANSER, emoji: "🫧", ingredientIds: [0, 1, 42, 39, 44, 45] },
  { brand: "Drunk Elephant", name: "Beste No. 9 Jelly Cleanser", category: ProductCategory.CLEANSER, emoji: "🧴", ingredientIds: [0, 1, 36, 38, 44] },
  { brand: "The Ordinary", name: "Squalane Cleanser", category: ProductCategory.CLEANSER, emoji: "🧴", ingredientIds: [0, 36, 1, 44] },
  { brand: "Bioderma", name: "Sensibio H2O Micellar Water", category: ProductCategory.CLEANSER, emoji: "💧", ingredientIds: [0, 15, 38, 44, 45] },
  { brand: "Kiehl's", name: "Ultra Facial Cleanser", category: ProductCategory.CLEANSER, emoji: "🧴", ingredientIds: [0, 1, 12, 19, 44] },

  // TONER
  { brand: "Some By Mi", name: "AHA BHA PHA 30 Days Miracle Toner", category: ProductCategory.TONER, emoji: "💦", ingredientIds: [0, 1, 8, 26, 27, 2, 44] },
  { brand: "Pyunkang Yul", name: "Essence Toner", category: ProductCategory.TONER, emoji: "💦", ingredientIds: [0, 1, 13, 4, 33, 44] },
  { brand: "COSRX", name: "Advanced Snail 96 Mucin Power Essence Toner", category: ProductCategory.TONER, emoji: "🐌", ingredientIds: [0, 14, 1, 13, 44] },
  { brand: "Klairs", name: "Supple Preparation Facial Toner", category: ProductCategory.TONER, emoji: "💦", ingredientIds: [0, 1, 12, 5, 33, 44] },
  { brand: "Hada Labo", name: "Gokujyun Premium Lotion", category: ProductCategory.TONER, emoji: "💦", ingredientIds: [0, 1, 13, 3, 38, 44] },
  { brand: "Laneige", name: "Cream Skin Refiner", category: ProductCategory.TONER, emoji: "🌿", ingredientIds: [0, 1, 16, 6, 20, 44] },

  // SERUM
  { brand: "The Ordinary", name: "Niacinamide 10% + Zinc 1%", category: ProductCategory.SERUM, emoji: "🔬", ingredientIds: [0, 2, 10, 1, 40, 44] },
  { brand: "The Ordinary", name: "Hyaluronic Acid 2% + B5", category: ProductCategory.SERUM, emoji: "🔬", ingredientIds: [0, 3, 13, 4, 1, 44] },
  { brand: "Paula's Choice", name: "C15 Super Booster", category: ProductCategory.SERUM, emoji: "⚡", ingredientIds: [0, 9, 23, 1, 22, 44] },
  { brand: "Skinceuticals", name: "C E Ferulic", category: ProductCategory.SERUM, emoji: "⚡", ingredientIds: [0, 9, 22, 23, 15, 44] },
  { brand: "The Ordinary", name: "Retinol 0.5% in Squalane", category: ProductCategory.SERUM, emoji: "🌙", ingredientIds: [0, 7, 36, 22, 44] },
  { brand: "The Inkey List", name: "Retinol Serum", category: ProductCategory.SERUM, emoji: "🌙", ingredientIds: [0, 7, 1, 36, 40, 44] },
  { brand: "COSRX", name: "Advanced Snail 96 Mucin Power Essence", category: ProductCategory.SERUM, emoji: "🐌", ingredientIds: [0, 14, 1, 13, 38, 44] },
  { brand: "Drunk Elephant", name: "T.L.C. Framboos Glycolic Night Serum", category: ProductCategory.SERUM, emoji: "🍇", ingredientIds: [0, 25, 26, 8, 1, 44] },
  { brand: "Medik8", name: "Crystal Retinal 3", category: ProductCategory.SERUM, emoji: "🌙", ingredientIds: [0, 7, 36, 22, 1, 44] },
  { brand: "Timeless", name: "20% Vitamin C + E Ferulic Acid Serum", category: ProductCategory.SERUM, emoji: "⚡", ingredientIds: [0, 9, 22, 23, 44] },
  { brand: "Good Genes", name: "Sunday Riley Good Genes Lactic Acid Treatment", category: ProductCategory.SERUM, emoji: "🍋", ingredientIds: [0, 26, 1, 12, 33, 44] },
  { brand: "Klairs", name: "Freshly Juiced Vitamin Drop", category: ProductCategory.SERUM, emoji: "⚡", ingredientIds: [0, 9, 1, 33, 22, 44] },
  { brand: "Some By Mi", name: "Galactomyces Pure Vitamin C Glow Serum", category: ProductCategory.SERUM, emoji: "⚡", ingredientIds: [0, 9, 1, 2, 44] },
  { brand: "Beautycounter", name: "Countertime Tripeptide Radiance Serum", category: ProductCategory.SERUM, emoji: "✨", ingredientIds: [0, 1, 13, 11, 5, 44] },

  // MOISTURIZER
  { brand: "CeraVe", name: "Moisturizing Cream", category: ProductCategory.MOISTURIZER, emoji: "🫙", ingredientIds: [0, 1, 6, 4, 13, 19, 20, 44] },
  { brand: "La Roche-Posay", name: "Toleriane Double Repair Face Moisturizer", category: ProductCategory.MOISTURIZER, emoji: "🫙", ingredientIds: [0, 1, 6, 4, 38, 44] },
  { brand: "Neutrogena", name: "Hydro Boost Water Gel", category: ProductCategory.MOISTURIZER, emoji: "💧", ingredientIds: [0, 1, 3, 13, 17, 18, 44] },
  { brand: "First Aid Beauty", name: "Ultra Repair Cream", category: ProductCategory.MOISTURIZER, emoji: "🫙", ingredientIds: [0, 1, 6, 33, 12, 20, 44] },
  { brand: "Tatcha", name: "The Water Cream", category: ProductCategory.MOISTURIZER, emoji: "🌸", ingredientIds: [0, 1, 3, 11, 33, 45, 44] },
  { brand: "Belif", name: "The True Cream Aqua Bomb", category: ProductCategory.MOISTURIZER, emoji: "💦", ingredientIds: [0, 1, 16, 3, 12, 44] },
  { brand: "Kiehl's", name: "Ultra Facial Cream", category: ProductCategory.MOISTURIZER, emoji: "🫙", ingredientIds: [0, 1, 36, 13, 38, 44, 45] },
  { brand: "Drunk Elephant", name: "Protini Polypeptide Cream", category: ProductCategory.MOISTURIZER, emoji: "🌟", ingredientIds: [0, 1, 11, 36, 6, 44] },
  { brand: "COSRX", name: "Oil-Free Ultra-Moisturizing Lotion", category: ProductCategory.MOISTURIZER, emoji: "💧", ingredientIds: [0, 1, 38, 2, 44, 45] },
  { brand: "Pyunkang Yul", name: "Nutrition Cream", category: ProductCategory.MOISTURIZER, emoji: "🫙", ingredientIds: [0, 1, 35, 4, 34, 44] },

  // SUNSCREEN
  { brand: "La Roche-Posay", name: "Anthelios Melt-In Sunscreen Milk SPF 60", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 48, 49, 17, 1, 44] },
  { brand: "EltaMD", name: "UV Clear Broad-Spectrum SPF 46", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 47, 2, 4, 1, 44] },
  { brand: "Supergoop!", name: "Unseen Sunscreen SPF 40", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 48, 17, 36, 1, 44] },
  { brand: "Biore UV", name: "Aqua Rich Watery Essence SPF 50+", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 49, 48, 17, 1, 44] },
  { brand: "Anessa", name: "Perfect UV Sunscreen Skincare Milk SPF 50+", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 49, 48, 17, 1, 22, 44] },
  { brand: "Purito", name: "Daily Go-To Sunscreen SPF 50+ PA++++", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 49, 47, 1, 12, 44] },
  { brand: "Missha", name: "All Around Safe Block Aqua Sun Gel SPF 50+", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 48, 49, 1, 38, 44] },

  // EXFOLIANT
  { brand: "Paula's Choice", name: "Skin Perfecting 2% BHA Liquid Exfoliant", category: ProductCategory.EXFOLIANT, emoji: "✨", ingredientIds: [0, 8, 1, 38, 44] },
  { brand: "The Ordinary", name: "AHA 30% + BHA 2% Peeling Solution", category: ProductCategory.EXFOLIANT, emoji: "🧪", ingredientIds: [0, 25, 8, 26, 40, 44] },
  { brand: "Glow Recipe", name: "Watermelon Glow BHA + PHA Toner", category: ProductCategory.EXFOLIANT, emoji: "🍉", ingredientIds: [0, 8, 25, 1, 33, 44] },
  { brand: "Pixi", name: "Glow Tonic with 5% Glycolic Acid", category: ProductCategory.EXFOLIANT, emoji: "✨", ingredientIds: [0, 25, 1, 33, 38, 44] },
  { brand: "Stridex", name: "Maximum Strength Salicylic Acid Pads", category: ProductCategory.EXFOLIANT, emoji: "🧪", ingredientIds: [0, 8, 1, 38, 44, 45] },

  // MASK
  { brand: "Innisfree", name: "Super Volcanic Pore Clay Mask", category: ProductCategory.MASK, emoji: "🌋", ingredientIds: [0, 1, 8, 2, 40, 44] },
  { brand: "Glow Recipe", name: "Watermelon Glow Sleeping Mask", category: ProductCategory.MASK, emoji: "🍉", ingredientIds: [0, 1, 3, 33, 12, 44] },
  { brand: "COSRX", name: "Ultimate Nourishing Rice Overnight Spa Mask", category: ProductCategory.MASK, emoji: "🌾", ingredientIds: [0, 1, 4, 13, 6, 44] },
  { brand: "Laneige", name: "Water Sleeping Mask", category: ProductCategory.MASK, emoji: "💤", ingredientIds: [0, 1, 3, 13, 38, 45, 44] },
  { brand: "Peter Thomas Roth", name: "Pumpkin Enzyme Mask", category: ProductCategory.MASK, emoji: "🎃", ingredientIds: [0, 25, 26, 1, 40, 44] },
  { brand: "GlamGlow", name: "Supermud Clearing Treatment", category: ProductCategory.MASK, emoji: "💆", ingredientIds: [0, 8, 25, 1, 40, 44] },

  // EYE_CREAM
  { brand: "The Ordinary", name: "Caffeine Solution 5% + EGCG", category: ProductCategory.EYE_CREAM, emoji: "👁️", ingredientIds: [0, 1, 11, 33, 4, 44] },
  { brand: "Kiehl's", name: "Creamy Eye Treatment with Avocado", category: ProductCategory.EYE_CREAM, emoji: "👁️", ingredientIds: [0, 1, 22, 36, 20, 44] },
  { brand: "Cetaphil", name: "Hydrating Eye Gel-Cream", category: ProductCategory.EYE_CREAM, emoji: "👁️", ingredientIds: [0, 1, 3, 4, 12, 44] },
  { brand: "Tatcha", name: "The Eye Cream", category: ProductCategory.EYE_CREAM, emoji: "👁️", ingredientIds: [0, 1, 11, 13, 33, 45, 44] },

  // ESSENCE
  { brand: "SK-II", name: "Facial Treatment Essence", category: ProductCategory.ESSENCE, emoji: "🌸", ingredientIds: [0, 1, 38, 11, 44] },
  { brand: "Missha", name: "Time Revolution The First Treatment Essence", category: ProductCategory.ESSENCE, emoji: "🌸", ingredientIds: [0, 1, 38, 13, 44] },
  { brand: "Laneige", name: "Water Bank Blue Hyaluronic Essence", category: ProductCategory.ESSENCE, emoji: "💧", ingredientIds: [0, 3, 13, 1, 5, 44] },
  { brand: "Sulwhasoo", name: "First Care Activating Serum", category: ProductCategory.ESSENCE, emoji: "🌿", ingredientIds: [0, 1, 38, 33, 11, 44] },
  { brand: "COSRX", name: "Advanced Snail Peptide Eye Cream Essence", category: ProductCategory.ESSENCE, emoji: "🐌", ingredientIds: [0, 14, 1, 11, 13, 44] },

  // TREATMENT
  { brand: "The Ordinary", name: "Azelaic Acid Suspension 10%", category: ProductCategory.TREATMENT, emoji: "🔬", ingredientIds: [0, 24, 17, 40, 44] },
  { brand: "Differin", name: "Adapalene Gel 0.1%", category: ProductCategory.TREATMENT, emoji: "💊", ingredientIds: [0, 40, 15, 44] },
  { brand: "The Ordinary", name: "Salicylic Acid 2% Masque", category: ProductCategory.TREATMENT, emoji: "🧪", ingredientIds: [0, 8, 24, 40, 44] },
  { brand: "Mario Badescu", name: "Drying Lotion", category: ProductCategory.TREATMENT, emoji: "🩹", ingredientIds: [0, 8, 10, 15, 44] },
  { brand: "Paula's Choice", name: "CLEAR Extra Strength Anti-Redness Exfoliating Solution", category: ProductCategory.TREATMENT, emoji: "🔬", ingredientIds: [0, 8, 25, 2, 1, 44] },

  // MIST
  { brand: "Avene", name: "Thermal Spring Water Spray", category: ProductCategory.MIST, emoji: "🌊", ingredientIds: [0, 44] },
  { brand: "Mario Badescu", name: "Facial Spray with Aloe, Herbs and Rosewater", category: ProductCategory.MIST, emoji: "🌹", ingredientIds: [0, 33, 12, 38, 45, 44] },
  { brand: "Heritage Store", name: "Rosewater Facial Mist", category: ProductCategory.MIST, emoji: "🌹", ingredientIds: [0, 33, 1, 44] },
  { brand: "Tatcha", name: "Luminous Dewy Skin Mist", category: ProductCategory.MIST, emoji: "✨", ingredientIds: [0, 3, 13, 33, 45, 44] },

  // OIL
  { brand: "The Ordinary", name: "100% Plant-Derived Squalane", category: ProductCategory.OIL, emoji: "🫙", ingredientIds: [36] },
  { brand: "Biossance", name: "100% Squalane Oil", category: ProductCategory.OIL, emoji: "🫙", ingredientIds: [36, 22] },
  { brand: "Sunday Riley", name: "Luna Sleeping Night Oil", category: ProductCategory.OIL, emoji: "🌙", ingredientIds: [0, 7, 34, 22, 36, 44, 45] },
  { brand: "The Ordinary", name: "Rosehip Seed Oil", category: ProductCategory.OIL, emoji: "🌹", ingredientIds: [34, 22] },
  { brand: "Kiehl's", name: "Daily Reviving Concentrate", category: ProductCategory.OIL, emoji: "✨", ingredientIds: [36, 35, 22, 45, 44] },

  // LIP_CARE
  { brand: "Laneige", name: "Lip Sleeping Mask Berry", category: ProductCategory.LIP_CARE, emoji: "💋", ingredientIds: [0, 1, 13, 22, 20, 44, 45] },
  { brand: "CeraVe", name: "Healing Ointment Lip Repair", category: ProductCategory.LIP_CARE, emoji: "💋", ingredientIds: [0, 1, 6, 4, 22, 44] },
  { brand: "Aquaphor", name: "Healing Ointment", category: ProductCategory.LIP_CARE, emoji: "💋", ingredientIds: [1, 4, 20, 22, 44] },
  { brand: "Fresh", name: "Sugar Advanced Therapy Lip Treatment", category: ProductCategory.LIP_CARE, emoji: "💋", ingredientIds: [0, 1, 36, 33, 22, 45, 44] },

  // OTHER / дополнительные до 100
  { brand: "Dermalogica", name: "Daily Microfoliant", category: ProductCategory.EXFOLIANT, emoji: "🌾", ingredientIds: [0, 25, 8, 12, 40, 44] },
  { brand: "Glow Recipe", name: "Plum Plump Hyaluronic Serum", category: ProductCategory.SERUM, emoji: "💜", ingredientIds: [0, 3, 13, 1, 4, 44] },
  { brand: "Youth To The People", name: "Superfood Air-Whip Moisture Cream", category: ProductCategory.MOISTURIZER, emoji: "🥦", ingredientIds: [0, 1, 11, 33, 38, 44] },
  { brand: "The INKEY List", name: "Oat Cleansing Balm", category: ProductCategory.CLEANSER, emoji: "🌾", ingredientIds: [0, 36, 1, 33, 44] },
  { brand: "Versed", name: "Guards Up Daily Mineral Sunscreen SPF 35", category: ProductCategory.SUNSCREEN, emoji: "☀️", ingredientIds: [0, 47, 1, 4, 12, 44] },
  { brand: "Dr. Jart+", name: "Ceramidin Cream", category: ProductCategory.MOISTURIZER, emoji: "🛡️", ingredientIds: [0, 1, 6, 4, 13, 20, 44] },
  { brand: "Sulwhasoo", name: "Concentrated Ginseng Renewing Serum", category: ProductCategory.SERUM, emoji: "🌿", ingredientIds: [0, 11, 1, 13, 38, 44, 45] },
  { brand: "Tatcha", name: "The Essence Plumping Skin Softener", category: ProductCategory.ESSENCE, emoji: "🌸", ingredientIds: [0, 1, 3, 33, 11, 44] },
  { brand: "Paula's Choice", name: "RESIST Anti-Aging Eye Cream SPF 25", category: ProductCategory.EYE_CREAM, emoji: "👁️", ingredientIds: [0, 48, 1, 11, 22, 44] },
  { brand: "Farmacy", name: "Honey Halo Ultra-Hydrating Ceramide Moisturizer", category: ProductCategory.MOISTURIZER, emoji: "🍯", ingredientIds: [0, 1, 6, 4, 12, 44] },
  { brand: "COSRX", name: "Centella Blemish Ampule", category: ProductCategory.TREATMENT, emoji: "🌿", ingredientIds: [0, 5, 1, 12, 8, 44] },
  { brand: "Murad", name: "Retinol Youth Renewal Night Cream", category: ProductCategory.MOISTURIZER, emoji: "🌙", ingredientIds: [0, 7, 1, 6, 22, 44] },
  { brand: "Fresh", name: "Rose Face Mask", category: ProductCategory.MASK, emoji: "🌹", ingredientIds: [0, 1, 33, 12, 13, 44, 45] },
  { brand: "Biossance", name: "Squalane + Probiotic Gel Moisturizer", category: ProductCategory.MOISTURIZER, emoji: "💚", ingredientIds: [0, 36, 1, 3, 44] },
  { brand: "Peter Thomas Roth", name: "Water Drench Hyaluronic Cloud Serum", category: ProductCategory.SERUM, emoji: "☁️", ingredientIds: [0, 3, 13, 1, 38, 44] },
  { brand: "Burt's Bees", name: "Renewal Firming Moisturizing Cream", category: ProductCategory.MOISTURIZER, emoji: "🐝", ingredientIds: [0, 1, 11, 22, 4, 44] },
  { brand: "Glossier", name: "Priming Moisturizer", category: ProductCategory.MOISTURIZER, emoji: "🌸", ingredientIds: [0, 1, 4, 38, 44] },
  { brand: "Peach & Lily", name: "Glass Skin Refining Serum", category: ProductCategory.SERUM, emoji: "🍑", ingredientIds: [0, 11, 1, 2, 13, 44] },
  { brand: "Then I Met You", name: "Living Cleansing Balm", category: ProductCategory.CLEANSER, emoji: "🌿", ingredientIds: [0, 36, 33, 5, 44] },
  { brand: "Torriiden", name: "DIVE-IN Low Molecular Hyaluronic Acid Serum", category: ProductCategory.SERUM, emoji: "💧", ingredientIds: [0, 3, 13, 1, 38, 44] },
];

// ─── Утилиты ────────────────────────────────────────────────────────────────

function makeBarcode(index: number): string {
  return `4600001${String(index).padStart(6, "0")}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding ${TEMPLATES.length} demo products…`);

  // 1. Upsert все ингредиенты
  console.log("  → upserting ingredients…");
  for (const ing of INGREDIENTS) {
    await prisma.ingredient.upsert({
      where: { inci: ing.inci },
      create: {
        inci: ing.inci,
        displayNameRu: ing.nameRu,
        displayNameEn: ing.inci,
      },
      update: {},
    });
  }

  // 2. Загрузить созданные ингредиенты в Map для быстрого доступа
  const dbIngredients = await prisma.ingredient.findMany({
    where: { inci: { in: INGREDIENTS.map((i) => i.inci) } },
    select: { id: true, inci: true },
  });
  const inciToId = new Map(dbIngredients.map((i) => [i.inci, i.id]));

  // 3. Upsert продукты + ингредиентные связи
  console.log("  → upserting products…");
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < TEMPLATES.length; i++) {
    const tpl = TEMPLATES[i];
    const barcode = makeBarcode(i + 1);

    const product = await prisma.product.upsert({
      where: { barcode },
      create: {
        barcode,
        brand: tpl.brand,
        name: tpl.name,
        category: tpl.category,
        emoji: tpl.emoji,
        source: "seed",
      },
      update: {},
      select: { id: true, createdAt: true, updatedAt: true },
    });

    const isNew = product.createdAt.getTime() === product.updatedAt.getTime();
    if (isNew) {
      created++;
    } else {
      skipped++;
    }

    // Upsert связей ProductIngredient (идемпотентно через skipDuplicates)
    const links = tpl.ingredientIds
      .map((idx, pos) => {
        const ingredientId = inciToId.get(INGREDIENTS[idx]?.inci ?? "");
        if (!ingredientId) return null;
        return { productId: product.id, ingredientId, position: pos + 1 };
      })
      .filter(Boolean) as { productId: string; ingredientId: string; position: number }[];

    if (links.length > 0) {
      await prisma.productIngredient.createMany({
        data: links,
        skipDuplicates: true,
      });
    }
  }

  console.log(`\nDone. Created: ${created}, already existed: ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
