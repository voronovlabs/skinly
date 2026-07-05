/**
 * Skinly · IMPORT · Care to Beauty INCI → Ingredient / ProductIngredient
 *
 * Импортирует ингредиенты из scrape.caretobeauty_products_normalized в боевые
 * таблицы Ingredient + ProductIngredient. БЕЗ создания/изменения Product.
 *
 * Источник правды — ingredients_normalized (text[], уже очищен dm.norm_
 * ingredients). ingredients_raw НЕ используется.
 *
 * Алгоритм (как в normalize-national-catalog, но батчами):
 *   1. Product по barcode = ean И source = 'caretobeauty' (нет → skip).
 *   2. ingredients_normalized пуст → skip.
 *   3. Ingredient по inci: есть → reuse, нет → create (без дублей).
 *   4. ProductIngredient (productId, ingredientId, position): нет → create.
 * Полностью идемпотентно: повторный --apply → created = 0.
 *
 * Запуск (tools-контейнер):
 *   npm run import:caretobeauty-ingredients              # DRY-RUN (по умолчанию)
 *   npm run import:caretobeauty-ingredients -- --apply   # запись
 *   npm run import:caretobeauty-ingredients -- --limit 100
 *
 * БЕЗОПАСНОСТЬ: пишем ТОЛЬКО Ingredient + ProductIngredient. Product,
 * description, image, barcode, brand, normalized-таблицы — не трогаем.
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

const SOURCE = "caretobeauty";

interface CliArgs {
  apply: boolean;
  limit: number;
  examples: number;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      limit: { type: "string", default: "0" },
      examples: { type: "string", default: "20" },
    },
  });
  const limit = parseInt(String(values.limit), 10);
  const examples = parseInt(String(values.examples), 10);
  return {
    apply: Boolean(values.apply),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    examples: Number.isFinite(examples) && examples > 0 ? examples : 20,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function titleCase(s: string): string {
  return s.replace(/\b([\p{L}\p{N}])/gu, (c) => c.toUpperCase());
}
function cleanToken(t: string): string | null {
  const v = t.trim();
  return v.length >= 2 && v.length <= 200 ? v : null;
}

interface Row {
  product_id: string;
  barcode: string;
  name: string | null;
  tokens: string[];
}

async function main(): Promise<void> {
  const args = parseCli();
  log(`[import c2b ingredients] mode=${args.apply ? "APPLY" : "DRY-RUN"} limit=${args.limit || "∞"}`);

  await ensureSchema(log);
  const prisma = getPrisma();

  /* ── счётчики продуктов ── */
  const counts = await prisma.$queryRaw<
    {
      products_found: bigint;
      products_skipped: bigint;
      products_with_ingredients: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE p.id IS NOT NULL)                                   AS products_found,
      count(*) FILTER (WHERE p.id IS NULL)                                       AS products_skipped,
      count(*) FILTER (WHERE p.id IS NOT NULL
                        AND nrm.ingredients_normalized IS NOT NULL
                        AND cardinality(nrm.ingredients_normalized) > 0)         AS products_with_ingredients
    FROM scrape.caretobeauty_products_normalized nrm
    LEFT JOIN "Product" p ON p.barcode = nrm.ean AND p.source = ${SOURCE}
  `);
  const c = counts[0];

  /* ── обрабатываемые строки (Product найден + есть состав) ── */
  const limitClause = args.limit ? Prisma.sql`LIMIT ${args.limit}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT p.id AS product_id, nrm.ean AS barcode, p.name AS name,
           nrm.ingredients_normalized AS tokens
    FROM scrape.caretobeauty_products_normalized nrm
    JOIN "Product" p ON p.barcode = nrm.ean AND p.source = ${SOURCE}
    WHERE nrm.ingredients_normalized IS NOT NULL
      AND cardinality(nrm.ingredients_normalized) > 0
    ORDER BY nrm.ean
    ${limitClause}
  `);

  // нормализуем токены строк
  const rowTokens = rows.map((r) => ({
    productId: r.product_id,
    barcode: r.barcode,
    name: r.name,
    tokens: (r.tokens ?? [])
      .map(cleanToken)
      .filter((t): t is string => t !== null),
  }));

  /* ── 1) Ingredient: preload → create missing ── */
  const distinct = [...new Set(rowTokens.flatMap((r) => r.tokens))];
  const inciToId = new Map<string, string>();
  for (const batch of chunk(distinct, 1000)) {
    const found = await prisma.ingredient.findMany({
      where: { inci: { in: batch } },
      select: { id: true, inci: true },
    });
    for (const f of found) inciToId.set(f.inci, f.id);
  }
  const missing = distinct.filter((t) => !inciToId.has(t));
  const ingredientsCreated = missing.length;
  const ingredientsReused = distinct.length - missing.length;

  if (args.apply && missing.length) {
    for (const batch of chunk(missing, 1000)) {
      await prisma.ingredient.createMany({
        data: batch.map((inci) => ({
          inci,
          displayNameRu: titleCase(inci),
          displayNameEn: titleCase(inci),
        })),
        skipDuplicates: true,
      });
    }
    // перечитываем id новых ингредиентов
    for (const batch of chunk(missing, 1000)) {
      const found = await prisma.ingredient.findMany({
        where: { inci: { in: batch } },
        select: { id: true, inci: true },
      });
      for (const f of found) inciToId.set(f.inci, f.id);
    }
  }

  /* ── 2) ProductIngredient: preload существующие связи ── */
  const productIds = [...new Set(rowTokens.map((r) => r.productId))];
  const existingLinks = new Set<string>();
  for (const batch of chunk(productIds, 500)) {
    const links = await prisma.productIngredient.findMany({
      where: { productId: { in: batch } },
      select: { productId: true, ingredientId: true },
    });
    for (const l of links) existingLinks.add(`${l.productId}|${l.ingredientId}`);
  }

  let piCreated = 0;
  let piReused = 0;
  const toCreate: { productId: string; ingredientId: string; position: number }[] = [];
  const perProductNew = new Map<string, number>();

  for (const r of rowTokens) {
    let newForProduct = 0;
    for (let i = 0; i < r.tokens.length; i++) {
      const token = r.tokens[i];
      const ingId = inciToId.get(token); // dry-run: missing → undefined
      // идентичность связи: реальный id, либо синтетика для ещё-не-созданного
      const identity = ingId ?? `new:${token}`;
      const key = `${r.productId}|${identity}`;
      if (existingLinks.has(key)) {
        piReused++;
        continue;
      }
      existingLinks.add(key); // дедуп в рамках прогона
      piCreated++;
      newForProduct++;
      if (ingId) toCreate.push({ productId: r.productId, ingredientId: ingId, position: i + 1 });
    }
    if (newForProduct > 0) perProductNew.set(r.productId, newForProduct);
  }

  if (args.apply && toCreate.length) {
    for (const batch of chunk(toCreate, 1000)) {
      await prisma.productIngredient.createMany({ data: batch, skipDuplicates: true });
    }
  }

  /* ── отчёт ── */
  log("");
  log("══════════ Care to Beauty · INGREDIENTS → Product ══════════");
  log(`режим:                     ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log(`Products found:            ${n(c?.products_found)}`);
  log(`Products skipped:          ${n(c?.products_skipped)}`);
  log(`Products with ingredients: ${n(c?.products_with_ingredients)}`);
  log(`  (обработано в этом прогоне: ${rowTokens.length})`);
  log("-----------------------------------------------------------");
  log(`Ingredients created:       ${ingredientsCreated}`);
  log(`Ingredients reused:        ${ingredientsReused}`);
  log(`ProductIngredient created: ${piCreated}`);
  log(`ProductIngredient reused:  ${piReused}`);
  log("-----------------------------------------------------------");
  log(`примеры (первые ${args.examples} товаров):`);
  for (const r of rowTokens.slice(0, args.examples)) {
    const nw = perProductNew.get(r.productId) ?? 0;
    log(
      `  • ${r.barcode} | ${trunc(r.name ?? "—", 40)} | ` +
        `ingredients=${r.tokens.length} | new links=${nw}`,
    );
  }
  log("");
  if (!args.apply) log("DRY-RUN: ничего не записано. Запись: -- --apply");
  log("БЕЗОПАСНОСТЬ: записаны ТОЛЬКО Ingredient + ProductIngredient. Product не тронут.");
  log("═══════════════════════════════════════════════════════════");
}

function trunc(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "…" : s;
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
