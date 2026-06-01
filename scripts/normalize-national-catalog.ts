/**
 * Skinly · normalizer · National Catalog raw → Product/Ingredient/ProductIngredient
 *
 * Запуск:
 *   npm run normalize:national-catalog
 *   npm run normalize:national-catalog -- --batch-size 200
 *   npm run normalize:national-catalog -- --limit 50
 *   npm run normalize:national-catalog -- --source national_catalog
 *
 * Что делает:
 *   1. Читает NationalCatalogRawProduct батчами через cursor pagination.
 *   2. Для каждой raw-записи делает upsert Product (ключ — barcode).
 *   3. Парсит payload.compositionRaw → массив ингредиентов:
 *        split по / , ; → trim → lowercase
 *   4. Для каждого ингредиента: upsert Ingredient (ключ — `inci` = нормализованное RU-имя).
 *   5. Создаёт связь ProductIngredient (composite PK = идемпотентно).
 *
 * Идемпотентность: повторный запуск ничего не дублирует — все операции upsert.
 *
 * Архитектурно:
 *   - НЕ трогает scraper (raw ingestion продолжает работать).
 *   - НЕ требует миграций (использует имеющиеся поля схемы).
 *   - НЕ грузит всю таблицу в память — cursor pagination.
 *   - Каждый row processOne() — отдельный набор upsert'ов; глобальной транзакции
 *     нет, потому что upsert'ы атомарны сами по себе и идемпотентны при retry.
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { ScrapedProduct } from "./national-catalog/types";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const prisma = new PrismaClient({ log: ["error", "warn"] });

/* ───────── CLI ───────── */

interface CliArgs {
  batchSize: number;
  limit: number; // 0 = без лимита
  source: string;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "batch-size": { type: "string", default: "100" },
      limit: { type: "string", default: "0" },
      source: { type: "string", default: "national_catalog" },
    },
  });
  const batchSize = parseInt(String(values["batch-size"]), 10);
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer");
  }
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("--limit must be >= 0");
  }
  return { batchSize, limit, source: String(values.source) };
}

/* ───────── Stats ───────── */

interface Stats {
  rawRows: number;
  productsUpserted: number;
  ingredientsCreated: number;
  ingredientsExisting: number;
  linksCreated: number;
  linksExisting: number;
  skippedMissingBarcode: number;
  skippedMissingTitle: number;
  failures: number;
}

function emptyStats(): Stats {
  return {
    rawRows: 0,
    productsUpserted: 0,
    ingredientsCreated: 0,
    ingredientsExisting: 0,
    linksCreated: 0,
    linksExisting: 0,
    skippedMissingBarcode: 0,
    skippedMissingTitle: 0,
    failures: 0,
  };
}

/* ───────── Helpers ───────── */

/**
 * Нормализованное имя ингредиента — единый ключ в `Ingredient.inci`.
 *   "Тальк "  → "тальк"
 *   "  ПАРФЮМЕРНАЯ КОМПОЗИЦИЯ" → "парфюмерная композиция"
 *   "ESSENTIAL OIL OF LAVENDER*" → "essential oil of lavender"
 */
function normalizeIngredient(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[*•·]+/g, "")
    .replace(/[«»"']/g, "")
    .trim();
}

/**
 * Парсинг сырой строки состава в массив исходных (display) имён.
 * Разделители: запятая, точка с запятой, слэш.
 * Дедуп: по нормализованной форме, порядок сохраняется.
 */
function parseComposition(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parts = raw
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const norm = normalizeIngredient(p);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(p);
  }
  return out;
}

/* ───────── Category detection ───────── */

type ProductCategory =
  | "CLEANSER" | "TONER" | "ESSENCE" | "SERUM" | "MOISTURIZER"
  | "EYE_CREAM" | "SUNSCREEN" | "EXFOLIANT" | "MASK" | "MIST"
  | "OIL" | "LIP_CARE" | "TREATMENT" | "OTHER";

/**
 * Определяет ProductCategory по данным из национального каталога.
 * Приоритет: URL slug → хлебные крошки → ключевые слова в названии.
 */
function detectCategory(
  categoryPath: string[],
  sourceUrl: string,
  title: string,
): ProductCategory {
  const url = sourceUrl.toLowerCase();
  const crumbs = categoryPath.map((c) => c.toLowerCase()).join(" ");
  const t = title.toLowerCase();
  const all = `${url} ${crumbs} ${t}`;

  // ── URL slug (наиболее структурированный сигнал) ──────────────
  if (/\/syvorotka/.test(url))                          return "SERUM";
  if (/\/essenciy|\/essentsiy/.test(url))               return "ESSENCE";
  if (/\/tonik|\/toner/.test(url))                      return "TONER";
  if (/\/maska/.test(url))                              return "MASK";
  if (/\/skrab|\/piling/.test(url))                     return "EXFOLIANT";
  if (/\/solncezashchit|\/spf/.test(url))               return "SUNSCREEN";
  if (/\/krem-dlya-glaz|\/uhod-za-glazami/.test(url))   return "EYE_CREAM";
  if (/\/maslo-kosmet|\/maslo-dlya-litsa/.test(url))    return "OIL";
  if (/\/mist|\/gidrolat/.test(url))                    return "MIST";
  if (/\/uhod-za-gubami|\/gigiena-gub|\/balzam-dlya-gub/.test(url)) return "LIP_CARE";
  if (/\/krem(-dlya-litsa|-dlya-tela|-uvlazhn|\/krem\/)/.test(url)) return "MOISTURIZER";
  if (/\/molochko/.test(url))                           return "MOISTURIZER";
  if (/\/ochishch|\/gel-dlya-umyv|\/penka|\/mylo|\/micellyarn/.test(url)) return "CLEANSER";

  // ── Хлебные крошки + название (RU ключевые слова) ────────────
  if (/сыворотк|serum/.test(all))                       return "SERUM";
  if (/эссенц/.test(all))                               return "ESSENCE";
  if (/тонер|тоник/.test(all))                          return "TONER";
  if (/маска для лица|маски для лица/.test(all))        return "MASK";
  if (/скраб|пилинг|эксфолиант/.test(all))              return "EXFOLIANT";
  if (/крем для глаз|уход.{0,10}глаз|eye.?cream/.test(all)) return "EYE_CREAM";
  if (/солнцезащит|\bspf\b/.test(all))                  return "SUNSCREEN";
  if (/масло.{0,15}(лица|тела|космет)/.test(all))       return "OIL";
  if (/\bмист\b|спрей.{0,10}лица/.test(all))            return "MIST";
  if (/уход.{0,10}губ|бальзам.{0,10}губ|блеск.{0,10}губ|помада/.test(all)) return "LIP_CARE";
  if (/крем.{0,15}(лица|увлажн|питат)|увлажняющий крем|moisturiz/.test(all)) return "MOISTURIZER";
  if (/очищ|умыв|мицеллярн|micellar|cleansing|cleanser/.test(all)) return "CLEANSER";
  if (/маска/.test(all))                                return "MASK";
  if (/масло/.test(all))                                return "OIL";
  if (/\bкрем\b/.test(all))                             return "MOISTURIZER";

  return "OTHER";
}

/* ───────── Process one raw row ───────── */

interface RawRow {
  id: string;
  source: string;
  sourceUrl: string;
  barcode: string | null;
  payload: unknown;
}

async function processOne(raw: RawRow, stats: Stats): Promise<void> {
  const payload = raw.payload as ScrapedProduct;

  // ── Validate ────────────────────────────────────────────
  if (!raw.barcode) {
    stats.skippedMissingBarcode++;
    log(`[SKIP] ${raw.sourceUrl} reason=missing-barcode`);
    return;
  }
  const titleRaw = (payload?.title ?? "").trim();
  if (!titleRaw) {
    stats.skippedMissingTitle++;
    log(`[SKIP] ${raw.sourceUrl} reason=missing-title`);
    return;
  }

  const brand = (payload?.brand ?? "").trim() || "Unknown";
  const imageUrl = (payload?.imageUrl ?? "").trim() || null;
  const category = detectCategory(
    payload?.categoryPath ?? [],
    raw.sourceUrl,
    titleRaw,
  );

  // ── Product upsert (key = barcode) ──────────────────────
  const product = await prisma.product.upsert({
    where: { barcode: raw.barcode },
    create: {
      barcode: raw.barcode,
      brand,
      name: titleRaw,
      category,
      imageUrl,
      source: "national_catalog",
      externalId: raw.id,
    },
    update: {
      brand,
      name: titleRaw,
      category,
      imageUrl,
      source: "national_catalog",
      externalId: raw.id,
    },
  });
  stats.productsUpserted++;
  log(
    `[PRODUCT UPSERT] barcode=${raw.barcode} name="${titleRaw.slice(0, 60)}${titleRaw.length > 60 ? "…" : ""}"`,
  );

  // ── Ingredients + links ─────────────────────────────────
  const composition = parseComposition(payload?.compositionRaw);
  if (composition.length === 0) {
    return; // нечего парсить — это нормально, многие товары не имеют состава
  }

  for (let i = 0; i < composition.length; i++) {
    const display = composition[i];
    const inci = normalizeIngredient(display);
    if (!inci) continue;

    // Сначала — find. Это даёт точную статистику created/existing.
    let ingredient = await prisma.ingredient.findUnique({
      where: { inci },
    });

    if (!ingredient) {
      ingredient = await prisma.ingredient.create({
        data: {
          inci,
          displayNameRu: display.trim(),
          displayNameEn: display.trim(),
        },
      });
      stats.ingredientsCreated++;
      log(`[INGREDIENT CREATED] inci="${inci}" id=${ingredient.id}`);
    } else {
      stats.ingredientsExisting++;
    }

    const existingLink = await prisma.productIngredient.findUnique({
      where: {
        productId_ingredientId: {
          productId: product.id,
          ingredientId: ingredient.id,
        },
      },
    });

    if (!existingLink) {
      await prisma.productIngredient.create({
        data: {
          productId: product.id,
          ingredientId: ingredient.id,
          position: i + 1,
        },
      });
      stats.linksCreated++;
      log(
        `[LINK CREATED] product=${raw.barcode} ↔ ingredient="${inci}" position=${i + 1}`,
      );
    } else {
      stats.linksExisting++;
      // Если позиция изменилась (поменялся состав), обновляем
      if (existingLink.position !== i + 1) {
        await prisma.productIngredient.update({
          where: {
            productId_ingredientId: {
              productId: product.id,
              ingredientId: ingredient.id,
            },
          },
          data: { position: i + 1 },
        });
      }
    }
  }
}

/* ───────── Main loop with cursor pagination ───────── */

async function main(): Promise<void> {
  const args = parseCli();
  log(
    `[NORMALIZE] starting · batchSize=${args.batchSize} limit=${args.limit || "∞"} source=${args.source}`,
  );

  const stats = emptyStats();
  let cursor: string | undefined = undefined;
  let processed = 0;
  let batchIdx = 0;

  while (true) {
    if (args.limit && processed >= args.limit) break;

    const take = args.limit
      ? Math.min(args.batchSize, args.limit - processed)
      : args.batchSize;

    const batch = (await prisma.nationalCatalogRawProduct.findMany({
      where: { source: args.source },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        source: true,
        sourceUrl: true,
        barcode: true,
        payload: true,
      },
    })) as RawRow[];

    if (batch.length === 0) break;

    batchIdx++;
    log(
      `[NORMALIZE] batch #${batchIdx} size=${batch.length}, processed so far=${processed}`,
    );

    for (const raw of batch) {
      try {
        stats.rawRows++;
        await processOne(raw, stats);
      } catch (e) {
        stats.failures++;
        const reason = e instanceof Error ? e.message : String(e);
        log(`[FAIL] ${raw.sourceUrl} reason=${reason}`);
      }
    }

    cursor = batch[batch.length - 1].id;
    processed += batch.length;
  }

  // ── Summary ──
  log("──────────────────────────────────────────────");
  log("[NORMALIZE] DONE");
  log(`  raw rows processed:        ${stats.rawRows}`);
  log(`  products upserted:         ${stats.productsUpserted}`);
  log(`  ingredients created:       ${stats.ingredientsCreated}`);
  log(`  ingredients existing:      ${stats.ingredientsExisting}`);
  log(`  links created:             ${stats.linksCreated}`);
  log(`  links existing:            ${stats.linksExisting}`);
  log(`  skipped: missing-barcode:  ${stats.skippedMissingBarcode}`);
  log(`  skipped: missing-title:    ${stats.skippedMissingTitle}`);
  log(`  failures:                  ${stats.failures}`);
  log("──────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
