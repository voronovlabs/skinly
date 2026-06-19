/**
 * Smoke-тест DM compatibility pipeline по когортам (Stage 2, шаг 3).
 *
 * Требует рабочую БД (DATABASE_URL) с применёнными dm-объектами и
 * сгенерированный Prisma client. Ничего не подключает к API/UI и НЕ включает
 * prisma query-логи (использует общий клиент из @/lib/prisma как есть).
 *
 * Запуск:
 *   npx tsx scripts/smoke-dm-products.ts
 *
 * Когорты выборки:
 *   3 × has_fragrance · 3 × has_acids · 3 × has_retinoids
 *   3 × category 'Лицо' · 3 × category 'Волосы'
 *   3 × random (recognized_ratio 0.3..0.8)
 *
 * Для каждого товара печатает:
 *   cohort | barcode | category | productName | recognizedRatio |
 *   totalIngredients | facts.length | top canonical ids | score | verdict | lowConfidence
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDmCompatibilityInput } from "@/lib/db/repositories/dm-products";
import {
  evaluateCompatibility,
  featuresToFacts,
  summaryProfileToEngine,
} from "@/lib/compatibility";

// Тестовый профиль: сухая, очень чувствительная кожа, избегает отдушек.
const profile = summaryProfileToEngine({
  skinType: "dry",
  sensitivity: "high",
  concerns: ["redness"],
  avoidedList: ["fragrance"],
  goal: "hydration",
});

interface CohortRow {
  cohort: string;
  barcode: string;
}

async function selectCohorts(): Promise<CohortRow[]> {
  return prisma.$queryRaw<CohortRow[]>(Prisma.sql`
    SELECT DISTINCT ON (barcode) cohort, barcode FROM (
      (SELECT 'fragrance'  AS cohort, f.barcode FROM dm.product_ingredient_features f
         WHERE f.has_fragrance  AND f.barcode IS NOT NULL ORDER BY random() LIMIT 3)
      UNION ALL
      (SELECT 'acids'      AS cohort, f.barcode FROM dm.product_ingredient_features f
         WHERE f.has_acids      AND f.barcode IS NOT NULL ORDER BY random() LIMIT 3)
      UNION ALL
      (SELECT 'retinoids'  AS cohort, f.barcode FROM dm.product_ingredient_features f
         WHERE f.has_retinoids  AND f.barcode IS NOT NULL ORDER BY random() LIMIT 3)
      UNION ALL
      (SELECT 'cat:Лицо'   AS cohort, p.barcode FROM dm.dm_products p
         JOIN dm.product_ingredient_features f USING (business_key)
         WHERE p.category = 'Лицо'   AND p.barcode IS NOT NULL ORDER BY random() LIMIT 3)
      UNION ALL
      (SELECT 'cat:Волосы' AS cohort, p.barcode FROM dm.dm_products p
         JOIN dm.product_ingredient_features f USING (business_key)
         WHERE p.category = 'Волосы' AND p.barcode IS NOT NULL ORDER BY random() LIMIT 3)
      UNION ALL
      (SELECT 'random'     AS cohort, f.barcode FROM dm.product_ingredient_features f
         WHERE f.recognized_ratio BETWEEN 0.3 AND 0.8 AND f.barcode IS NOT NULL
         ORDER BY random() LIMIT 3)
    ) s
  `);
}

async function main() {
  const cohorts = await selectCohorts();
  if (cohorts.length === 0) {
    console.log("Нет подходящих товаров — проверь dm-объекты / refresh MV.");
    return;
  }

  console.log(
    "cohort | barcode | category | productName | recRatio | total | facts | topCanonical | score | verdict | lowConf",
  );
  console.log("-".repeat(110));

  for (const { cohort, barcode } of cohorts) {
    const input = await getDmCompatibilityInput(barcode);
    if (!input) {
      console.log(`${cohort} | ${barcode} | <не найден в DM>`);
      continue;
    }
    const facts = featuresToFacts(input.rows);
    const result = evaluateCompatibility(profile, facts);
    const top = input.rows
      .slice(0, 5)
      .map((r) => r.canonical_id)
      .join(",");
    const name = (input.product.productName ?? "—").slice(0, 28);

    console.log(
      [
        cohort,
        barcode,
        input.product.category ?? "—",
        name,
        input.recognizedRatio.toFixed(3),
        input.totalIngredients,
        facts.length,
        top || "—",
        result.score,
        result.verdict,
        input.lowConfidence ? "yes" : "no",
      ].join(" | "),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
