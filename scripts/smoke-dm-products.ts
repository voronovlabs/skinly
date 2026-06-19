/**
 * Smoke-тест data-access слоя DM compatibility (Stage 2, шаг 2).
 *
 * Требует рабочую БД (DATABASE_URL) с применёнными dm-объектами и
 * сгенерированный Prisma client. Ничего не подключает к API/UI.
 *
 * Запуск:
 *   npx tsx scripts/smoke-dm-products.ts
 *
 * Делает:
 *   1) берёт несколько barcode из dm.product_ingredient_features (recognized_ratio >= 0.3);
 *   2) getDmCompatibilityInput(barcode);
 *   3) featuresToFacts(rows);
 *   4) evaluateCompatibility(profile, facts) на тестовом профиле;
 *   5) печатает barcode | productName | recognizedRatio | facts.length | score | verdict.
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

async function main() {
  const sample = await prisma.$queryRaw<{ barcode: string }[]>(Prisma.sql`
    SELECT barcode
    FROM dm.product_ingredient_features
    WHERE recognized_ratio >= 0.3 AND barcode IS NOT NULL
    ORDER BY recognized_ratio DESC
    LIMIT 8
  `);

  if (sample.length === 0) {
    console.log("Нет товаров с recognized_ratio >= 0.3 — проверь dm-объекты.");
    return;
  }

  console.log(
    "barcode | productName | recognizedRatio | facts | score | verdict",
  );
  console.log("-".repeat(80));

  for (const { barcode } of sample) {
    const input = await getDmCompatibilityInput(barcode);
    if (!input) {
      console.log(`${barcode} | <не найден>`);
      continue;
    }
    const facts = featuresToFacts(input.rows);
    const result = evaluateCompatibility(profile, facts);
    const name = (input.product.productName ?? "—").slice(0, 32);
    console.log(
      `${barcode} | ${name} | ${input.recognizedRatio.toFixed(3)} | ` +
        `${facts.length} | ${result.score} | ${result.verdict}` +
        `${input.lowConfidence ? " (low-conf)" : ""}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
