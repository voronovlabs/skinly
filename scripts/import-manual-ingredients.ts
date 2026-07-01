/**
 * Skinly · IMPORT · ручные INCI из Excel → staging → Ingredient / ProductIngredient
 *
 * Универсальный импорт курируемых Excel-файлов (data/manual/*.xlsx) с
 * колонками id / barcode / brand / name / ingredients_raw / source_name /
 * source_url / confidence — тот формат, в котором собирались составы
 * A-Derma / CeraVe / Dr.Jart+.
 *
 * Поток:
 *   Excel → scrape.manual_product_ingredients (staging, upsert по file+barcode)
 *         → public."Ingredient" / public."ProductIngredient"   (только --apply)
 *
 * ВАЖНО про ingredientId: он НЕ выдумывается — каждый ингредиент резолвится
 * по уникальному ключу Ingredient.inci (существующий → reuse, иначе → create,
 * id генерит Prisma @default(cuid())). Ключ inci строится тем же
 * dm.norm_ingredients, что и весь каталог → дедуп с остальными источниками.
 *
 * Пишем ТОЛЬКО Ingredient + ProductIngredient (+ staging в схеме scrape).
 * Product не создаётся и не изменяется. Полностью идемпотентно:
 * повторный --apply → created = 0.
 *
 * Запуск (tools-контейнер):
 *   npm run import:manual-ingredients -- --file data/manual/ADerma.xlsx            # DRY-RUN
 *   npm run import:manual-ingredients -- --file data/manual/ADerma.xlsx --apply
 *   npm run import:manual-ingredients -- --file data/manual/Cerave.xlsx --apply
 *   npm run import:manual-ingredients -- --file data/manual/Dr.Jart+.xlsx --apply
 *   опционально: --brand "CeraVe" (обрабатывать только строки этого бренда)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { closeDb, getPrisma } from "./inn-skin/storage";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const SCHEMA_SQL = path.resolve("sql/scrape/01_manual_product_ingredients.sql");

/* ───────── CLI ───────── */

interface CliArgs {
  apply: boolean;
  file: string;
  brand: string | null;
  examples: number;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      file: { type: "string" },
      brand: { type: "string" },
      examples: { type: "string", default: "20" },
    },
  });
  if (!values.file) {
    console.error("Использование: npm run import:manual-ingredients -- --file data/manual/<Brand>.xlsx [--apply] [--brand <Brand>]");
    process.exit(1);
  }
  const examples = parseInt(String(values.examples), 10);
  return {
    apply: Boolean(values.apply),
    file: String(values.file),
    brand: values.brand ? String(values.brand) : null,
    examples: Number.isFinite(examples) && examples > 0 ? examples : 20,
  };
}

/* ───────── helpers ───────── */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function titleCase(s: string): string {
  return s.replace(/\b([\p{L}\p{N}])/gu, (c) => c.toUpperCase());
}

function trunc(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "…" : s;
}

/** Ячейка Excel → строка (штрихкоды приходят числами — без экспоненты). */
function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Снять сегментные ярлыки, НЕ являющиеся ингредиентами, чтобы они не стали
 * мусорными Ingredient после dm.norm_ingredients (split по [,;/]):
 *   "Active Ingredient: Dimethicone 1%. Inactive Ingredients: Water, ..."
 *   "Step 1 Dr.Jart Vitamin C 1000 Ppm Ampoule: Water/Eau, ..."
 *   "May Contain: Titanium Dioxide (Ci 77891), ..."
 * Удаляются ТОЛЬКО известные словарные ярлыки вида "<label>:" вместе с
 * двоеточием; предшествующий разделитель сохраняется ("." → ","), сами
 * ингредиенты и их порядок не меняются.
 */
const SEGMENT_LABEL_RE =
  /(^|[.,;/])\s*(?:active ingredients?|inactive ingredients?|may contain|full ingredients list|ingredients list|ingredients|inci|composition|step\s*\d[^:,;]*)\s*:\s*/gi;

function stripSegmentLabels(raw: string): string {
  return raw.replace(SEGMENT_LABEL_RE, (_m, p1: string) =>
    p1 === "" ? "" : p1 === "." ? ", " : `${p1} `,
  );
}

/* ───────── типы ───────── */

interface ExcelRow {
  productId: string | null;
  barcode: string;
  brand: string | null;
  name: string | null;
  ingredientsRaw: string;
  sourceName: string | null;
  sourceUrl: string | null;
  confidence: string | null;
}

interface Resolved extends ExcelRow {
  resolvedProductId: string;
  tokens: string[];
}

/* ───────── Excel ───────── */

function readExcel(file: string, brandFilter: string | null): { all: number; withRaw: ExcelRow[]; filteredOutByBrand: number } {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: true, defval: null });

  let filteredOutByBrand = 0;
  const withRaw: ExcelRow[] = [];
  for (const r of rows) {
    const barcode = cellToString(r["barcode"]);
    if (!barcode) continue; // пустая строка листа
    const brand = cellToString(r["brand"]);
    if (brandFilter && (brand ?? "").toLowerCase() !== brandFilter.toLowerCase()) {
      filteredOutByBrand++;
      continue;
    }
    const ingredientsRaw = cellToString(r["ingredients_raw"]);
    if (!ingredientsRaw) continue;
    withRaw.push({
      productId: cellToString(r["id"]),
      barcode,
      brand,
      name: cellToString(r["name"]),
      ingredientsRaw,
      sourceName: cellToString(r["source_name"]),
      sourceUrl: cellToString(r["source_url"]),
      confidence: cellToString(r["confidence"]),
    });
  }
  const all = rows.filter((r) => cellToString(r["barcode"]) !== null).length;
  return { all, withRaw, filteredOutByBrand };
}

/* ───────── schema bootstrap (scrape.manual_product_ingredients) ───────── */

async function ensureSchema(): Promise<void> {
  const sql = await fs.readFile(SCHEMA_SQL, "utf-8");
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s.replace(/\s/g, "")));
  const prisma = getPrisma();
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  log(`[schema] ensured scrape.manual_product_ingredients (${statements.length} statements)`);
}

/* ───────── main ───────── */

async function main(): Promise<void> {
  const args = parseCli();
  const fileName = path.basename(args.file);
  log(`[import manual INCI] mode=${args.apply ? "APPLY" : "DRY-RUN"} file=${args.file}${args.brand ? ` brand=${args.brand}` : ""}`);

  const prisma = getPrisma();

  /* ── проверяем наличие dm.norm_ingredients ── */
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT dm.norm_ingredients('aqua, glycerin')`);
  } catch {
    console.error("FATAL: функция dm.norm_ingredients не найдена. Примените sql/dm/10_dm_functions.sql:");
    console.error('  psql "$DATABASE_URL" -f sql/dm/10_dm_functions.sql');
    process.exit(1);
  }

  /* ── читаем Excel ── */
  const { all, withRaw, filteredOutByBrand } = readExcel(args.file, args.brand);
  log(`[excel] строк: ${all}, с ingredients_raw: ${withRaw.length}${filteredOutByBrand ? `, отфильтровано по --brand: ${filteredOutByBrand}` : ""}`);

  /* ── резолвим Product (по id, затем по barcode) + dm.norm_ingredients ── */
  const resolved: Resolved[] = [];
  let skippedNoProduct = 0;
  let skippedNoTokens = 0;

  for (const row of withRaw) {
    let product: { id: string; name: string } | null = null;
    if (row.productId) {
      product = await prisma.product.findUnique({
        where: { id: row.productId },
        select: { id: true, name: true },
      });
    }
    if (!product) {
      product = await prisma.product.findUnique({
        where: { barcode: row.barcode },
        select: { id: true, name: true },
      });
    }
    if (!product) {
      skippedNoProduct++;
      log(`[SKIP] ${row.barcode} | ${trunc(row.name ?? "—", 50)} reason=no-product`);
      continue;
    }

    // ТОТ ЖЕ нормализатор, что и весь каталог → согласованные inci-ключи
    const cleaned = stripSegmentLabels(row.ingredientsRaw);
    const t = await prisma.$queryRaw<{ tokens: string[] | null }[]>(
      Prisma.sql`SELECT dm.norm_ingredients(${cleaned}) AS tokens`,
    );
    const tokens = (t[0]?.tokens ?? [])
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && x.length <= 200);
    if (tokens.length === 0) {
      skippedNoTokens++;
      log(`[SKIP] ${row.barcode} reason=no-tokens-after-norm`);
      continue;
    }

    resolved.push({ ...row, resolvedProductId: product.id, tokens });
  }

  /* ── staging upsert (только в APPLY: dry-run ничего не пишет) ── */
  let stagingUpserted = 0;
  if (args.apply) {
    await ensureSchema();
    for (const r of resolved) {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO scrape.manual_product_ingredients
          (product_id, barcode, brand, name, ingredients_raw, ingredients_normalized,
           source_name, source_url, confidence, file_name)
        VALUES
          (${r.resolvedProductId}, ${r.barcode}, ${r.brand}, ${r.name}, ${r.ingredientsRaw},
           ${r.tokens}::text[], ${r.sourceName}, ${r.sourceUrl}, ${r.confidence}, ${fileName})
        ON CONFLICT (file_name, barcode) DO UPDATE SET
          product_id             = EXCLUDED.product_id,
          brand                  = EXCLUDED.brand,
          name                   = EXCLUDED.name,
          ingredients_raw        = EXCLUDED.ingredients_raw,
          ingredients_normalized = EXCLUDED.ingredients_normalized,
          source_name            = EXCLUDED.source_name,
          source_url             = EXCLUDED.source_url,
          confidence             = EXCLUDED.confidence,
          updated_at             = now()
      `);
      stagingUpserted++;
    }
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
  const productIds = [...new Set(resolved.map((r) => r.resolvedProductId))];
  const existingLinks = new Set<string>();
  for (const batch of chunk(productIds, 500)) {
    const links = await prisma.productIngredient.findMany({
      where: { productId: { in: batch } },
      select: { productId: true, ingredientId: true },
    });
    for (const l of links) existingLinks.add(`${l.productId}|${l.ingredientId}`);
  }
  const preexistingLinkCount = existingLinks.size;

  let piCreated = 0;
  let piReused = 0;
  const toCreate: { productId: string; ingredientId: string; position: number }[] = [];
  const perProductNew = new Map<string, number>();

  for (const r of resolved) {
    let nw = 0;
    for (let i = 0; i < r.tokens.length; i++) {
      const ingId = inciToId.get(r.tokens[i]); // dry-run: новые Ingredient без id
      const identity = ingId ?? `new:${r.tokens[i]}`;
      const key = `${r.resolvedProductId}|${identity}`;
      if (existingLinks.has(key)) {
        piReused++;
        continue;
      }
      existingLinks.add(key);
      piCreated++;
      nw++;
      // порядок ингредиентов сохраняется: position = i + 1
      if (ingId) toCreate.push({ productId: r.resolvedProductId, ingredientId: ingId, position: i + 1 });
    }
    if (nw > 0) perProductNew.set(r.resolvedProductId, nw);
  }

  if (args.apply && toCreate.length) {
    for (const batch of chunk(toCreate, 1000)) {
      await prisma.productIngredient.createMany({ data: batch, skipDuplicates: true });
    }
  }

  /* ── отчёт ── */
  const totalTokens = resolved.reduce((s, r) => s + r.tokens.length, 0);
  log("");
  log(`══════════ manual INCI import · ${fileName} ══════════`);
  log(`режим:                          ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log(`rows in Excel:                  ${all}`);
  log(`rows with ingredients_raw:      ${withRaw.length}`);
  if (filteredOutByBrand) log(`rows filtered out by --brand:   ${filteredOutByBrand}`);
  log(`products found:                 ${resolved.length}`);
  log(`products skipped:               ${skippedNoProduct + skippedNoTokens}`);
  log(`  ├ no Product (id/barcode):    ${skippedNoProduct}`);
  log(`  └ no tokens after norm:       ${skippedNoTokens}`);
  log(`total normalized tokens:        ${totalTokens}`);
  log("------------------------------------------------------");
  log(`Ingredient existing (reused):   ${ingredientsReused}`);
  log(`Ingredient new (created):       ${ingredientsCreated}`);
  log(`ProductIngredient existing:     ${preexistingLinkCount}`);
  log(`ProductIngredient reused:       ${piReused}`);
  log(`ProductIngredient new:          ${piCreated}`);
  if (args.apply) {
    log("------------------------------------------------------");
    log(`staging rows upserted:          ${stagingUpserted} (scrape.manual_product_ingredients)`);
  }
  log("------------------------------------------------------");
  log(`примеры (до ${args.examples}):`);
  for (const r of resolved.slice(0, args.examples)) {
    log(`  • ${r.barcode} | ${trunc(r.name ?? "—", 44)} | conf=${r.confidence ?? "—"} | tokens=${r.tokens.length} | new links=${perProductNew.get(r.resolvedProductId) ?? 0}`);
  }
  log("");
  if (!args.apply) log("DRY-RUN: ничего не записано. Запись: -- --apply");
  log("БЕЗОПАСНОСТЬ: записаны ТОЛЬКО Ingredient + ProductIngredient (+ staging). Product не тронут.");
  log("══════════════════════════════════════════════════════");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
