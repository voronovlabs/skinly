/**
 * Skinly · IMPORT · A-Derma INCI (staging file) → Ingredient / ProductIngredient
 *
 * Полу-ручной добор реального INCI для товаров A-Derma (Product.source=
 * 'caretobeauty', brand='A-Derma'), которых нет на самой карточке Care to
 * Beauty. Источник — курируемый файл data/staging/aderma-ingredients.json
 * (INCI берётся с официального сайта / OpenBeautyFacts / Cocooncenter /
 * incidecoder и т.п., БЕЗ Main/Key/Active Ingredients).
 *
 * ВАЖНО про ingredientId: он НЕ выдумывается — каждый ингредиент резолвится
 * по уникальному ключу Ingredient.inci (существующий → reuse, иначе → create,
 * id генерит Prisma @default(cuid())). Ключ inci строится тем же
 * dm.norm_ingredients, что и весь каталог → дедуп с остальными источниками.
 *
 * Пишем ТОЛЬКО Ingredient + ProductIngredient. Product не трогаем.
 * Полностью идемпотентно: повторный --apply → created = 0.
 *
 * Запуск (tools-контейнер):
 *   npm run import:aderma-ingredients               # DRY-RUN (по умолчанию)
 *   npm run import:aderma-ingredients -- --apply
 *   npm run import:aderma-ingredients -- --file data/staging/aderma-ingredients.json
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { closeDb, getPrisma } from "./inn-skin/storage";
import { isLikelyInci } from "./caretobeauty/parser";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

const SOURCE = "caretobeauty";
const BRAND = "A-Derma";

interface StagingEntry {
  productId?: string | null;
  barcode: string;
  brand: string;
  name?: string | null;
  source_url?: string | null;
  ingredients_raw: string;
  ingredients?: string[];
}

interface CliArgs {
  apply: boolean;
  file: string;
  examples: number;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      file: { type: "string", default: "data/staging/aderma-ingredients.json" },
      examples: { type: "string", default: "20" },
    },
  });
  const examples = parseInt(String(values.examples), 10);
  return {
    apply: Boolean(values.apply),
    file: String(values.file),
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

interface Resolved {
  barcode: string;
  name: string | null;
  productId: string;
  tokens: string[];
}

async function main(): Promise<void> {
  const args = parseCli();
  log(`[import A-Derma INCI] mode=${args.apply ? "APPLY" : "DRY-RUN"} file=${args.file}`);

  const prisma = getPrisma();

  /* ── читаем staging ── */
  const raw = await fs.readFile(path.resolve(args.file), "utf-8");
  const entries = JSON.parse(raw) as StagingEntry[];
  log(`[import A-Derma INCI] записей в staging: ${entries.length}`);

  /* ── всего A-Derma товаров в каталоге ── */
  const tot = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT count(*) AS c FROM "Product"
    WHERE source = ${SOURCE} AND lower(brand) = lower(${BRAND})
  `);
  const totalAderma = n(tot[0]?.c);

  /* ── резолвим каждую запись: Product + dm.norm_ingredients ── */
  const resolved: Resolved[] = [];
  let skippedNoProduct = 0;
  let skippedNotInci = 0;
  let skippedNoTokens = 0;

  for (const e of entries) {
    if (!e.barcode || !e.ingredients_raw) {
      skippedNotInci++;
      continue;
    }
    // защита: только настоящий INCI (не маркетинг)
    if (!isLikelyInci(e.ingredients_raw)) {
      skippedNotInci++;
      log(`[SKIP] ${e.barcode} reason=not-inci`);
      continue;
    }

    const prod = await prisma.$queryRaw<{ id: string; name: string | null }[]>(Prisma.sql`
      SELECT id, name FROM "Product"
      WHERE barcode = ${e.barcode} AND source = ${SOURCE} AND lower(brand) = lower(${BRAND})
      LIMIT 1
    `);
    if (prod.length === 0) {
      skippedNoProduct++;
      log(`[SKIP] ${e.barcode} reason=no-product(source=${SOURCE},brand=${BRAND})`);
      continue;
    }

    // ТОТ ЖЕ нормализатор, что и весь каталог → согласованные inci-ключи
    const t = await prisma.$queryRaw<{ tokens: string[] | null }[]>(
      Prisma.sql`SELECT dm.norm_ingredients(${e.ingredients_raw}) AS tokens`,
    );
    const tokens = (t[0]?.tokens ?? []).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 200);
    if (tokens.length === 0) {
      skippedNoTokens++;
      continue;
    }
    resolved.push({ barcode: e.barcode, name: prod[0].name ?? e.name ?? null, productId: prod[0].id, tokens });
  }

  /* ── Ingredient: preload → create missing ── */
  const distinct = [...new Set(resolved.flatMap((r) => r.tokens))];
  const inciToId = new Map<string, string>();
  for (const batch of chunk(distinct, 1000)) {
    const found = await prisma.ingredient.findMany({
      where: { inci: { in: batch } },
      select: { id: true, inci: true },
    });
    for (const f of found) inciToId.set(f.inci, f.id);
  }
  const missing = distinct.filter((tk) => !inciToId.has(tk));
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
    for (const batch of chunk(missing, 1000)) {
      const found = await prisma.ingredient.findMany({
        where: { inci: { in: batch } },
        select: { id: true, inci: true },
      });
      for (const f of found) inciToId.set(f.inci, f.id);
    }
  }

  /* ── ProductIngredient: preload существующие связи ── */
  const productIds = [...new Set(resolved.map((r) => r.productId))];
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

  for (const r of resolved) {
    let nw = 0;
    for (let i = 0; i < r.tokens.length; i++) {
      const ingId = inciToId.get(r.tokens[i]); // dry-run: missing → undefined
      const identity = ingId ?? `new:${r.tokens[i]}`;
      const key = `${r.productId}|${identity}`;
      if (existingLinks.has(key)) {
        piReused++;
        continue;
      }
      existingLinks.add(key);
      piCreated++;
      nw++;
      if (ingId) toCreate.push({ productId: r.productId, ingredientId: ingId, position: i + 1 });
    }
    if (nw > 0) perProductNew.set(r.productId, nw);
  }

  if (args.apply && toCreate.length) {
    for (const batch of chunk(toCreate, 1000)) {
      await prisma.productIngredient.createMany({ data: batch, skipDuplicates: true });
    }
  }

  /* ── отчёт ── */
  log("");
  log("══════════ A-Derma · INGREDIENTS → Product ══════════");
  log(`режим:                       ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log(`total A-Derma products:      ${totalAderma}`);
  log(`staging entries:             ${entries.length}`);
  log(`products with INCI found:    ${resolved.length}`);
  log(`products skipped:            ${skippedNoProduct + skippedNotInci + skippedNoTokens}`);
  log(`  ├ no Product (barcode):    ${skippedNoProduct}`);
  log(`  ├ not real INCI / empty:   ${skippedNotInci}`);
  log(`  └ no tokens after norm:    ${skippedNoTokens}`);
  log("-----------------------------------------------------");
  log(`Ingredients created:         ${ingredientsCreated}`);
  log(`Ingredients reused:          ${ingredientsReused}`);
  log(`ProductIngredient created:   ${piCreated}`);
  log(`ProductIngredient reused:    ${piReused}`);
  log("-----------------------------------------------------");
  log(`примеры (до ${args.examples}):`);
  for (const r of resolved.slice(0, args.examples)) {
    log(`  • ${r.barcode} | ${trunc(r.name ?? "—", 40)} | ingredients=${r.tokens.length} | new links=${perProductNew.get(r.productId) ?? 0}`);
  }
  log("");
  if (!args.apply) log("DRY-RUN: ничего не записано. Запись: -- --apply");
  log("БЕЗОПАСНОСТЬ: записаны ТОЛЬКО Ingredient + ProductIngredient. Product не тронут.");
  log("═════════════════════════════════════════════════════");
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
