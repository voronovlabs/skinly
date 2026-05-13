/**
 * Skinly · merge per-category JSONL → один файл с product-level dedup.
 *
 * Зачем:
 *   После Phase 13.1 каждый scraper-процесс пишет в свой per-category JSONL
 *   (`data/raw/national-catalog-products-<slug>.jsonl`). Если кому-то нужен
 *   единый legacy-формат для downstream tools (jq, ad-hoc анализ), наивный
 *   `cat ... | sort -u` НЕ работает: он дедупит строки, а не товары —
 *   timestamps / порядок ключей / случайные whitespace ломают dedup.
 *
 *   Этот скрипт дедупит по `sourceUrl` (fallback — `barcode`), парсит каждую
 *   строку как JSON, сохраняет САМЫЙ СВЕЖИЙ snapshot товара по `scrapedAt`.
 *
 * Запуск:
 *   npm run merge:national-jsonl
 *
 *   npm run merge:national-jsonl -- \
 *     --input-glob "data/raw/national-catalog-products.jsonl" \
 *     --output data/raw/national-catalog-products-merged.jsonl
 *
 *   # явный список input'ов (повторяя --input):
 *   npm run merge:national-jsonl -- \
 *     --input data/raw/national-catalog-products.jsonl \
 *     --input data/raw/national-catalog-products-parfyumeriya.jsonl \
 *     --output data/raw/national-catalog-products-merged.jsonl
 *
 * Принципы:
 *   - line-by-line парсинг (без `JSON.parse` всего файла);
 *   - dedup index в памяти (Map sourceUrl → freshest payload) — это
 *     неизбежно, потому что нужно выбирать самый свежий snapshot.
 *     Для масштаба skinly (десятки тысяч продуктов) это ок;
 *   - битые строки тихо пропускаются (с подсчётом);
 *   - без external deps — только Node stdlib + локальные модули.
 *   - НЕ трогает Postgres, НЕ трогает scraper, НЕ трогает frontend.
 */

import { promises as fs, createReadStream } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

interface CliArgs {
  inputs: string[];
  inputGlob: string | null;
  output: string;
  dryRun: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      input: { type: "string", multiple: true },
      "input-glob": { type: "string" },
      output: {
        type: "string",
        default: "data/raw/national-catalog-products-merged.jsonl",
      },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const explicit = Array.isArray(values.input) ? values.input.filter(Boolean) : [];
  const inputGlob =
    typeof values["input-glob"] === "string" ? values["input-glob"] : null;
  const output = String(values.output);

  if (explicit.length === 0 && !inputGlob) {
    throw new Error(
      "merge:national-jsonl needs at least one --input or --input-glob",
    );
  }

  return {
    inputs: explicit,
    inputGlob,
    output,
    dryRun: Boolean(values["dry-run"]),
  };
}

/**
 * Расширить простой glob вида `data/raw/national-catalog-products*.jsonl`
 * в реальный список файлов. Поддерживаем `*` внутри basename и точное совпадение —
 * этого достаточно для нашего случая, ставить minimatch не хочется.
 */
async function expandGlob(pattern: string): Promise<string[]> {
  const abs = path.resolve(pattern);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  if (!base.includes("*")) {
    // Точное совпадение — просто проверяем существование.
    try {
      await fs.access(abs);
      return [abs];
    } catch {
      return [];
    }
  }
  const re = new RegExp(
    "^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => re.test(e)).map((e) => path.join(dir, e));
}

interface MergedRow {
  /** Сырая строка для записи (компактный JSON). */
  raw: string;
  /** Время snapshot'а (UNIX ms) — для выбора самого свежего. */
  scrapedAtMs: number;
}

interface ScrapedShape {
  sourceUrl?: string;
  barcode?: string | null;
  scrapedAt?: string;
}

async function ingestFile(
  file: string,
  index: Map<string, MergedRow>,
  stats: { rowsRead: number; rowsKept: number; rowsReplaced: number; rowsBroken: number },
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.rowsRead++;

    let obj: ScrapedShape;
    try {
      obj = JSON.parse(line);
    } catch {
      stats.rowsBroken++;
      continue;
    }

    const key = pickKey(obj);
    if (!key) {
      // Без sourceUrl И без barcode — выкинуть в общий «без-ключа» bucket.
      // Чтобы не терять, ставим uuid-style временный ключ.
      const k = `__no-key__:${stats.rowsRead}`;
      index.set(k, {
        raw: JSON.stringify(obj),
        scrapedAtMs: Date.parse(obj.scrapedAt ?? "") || 0,
      });
      stats.rowsKept++;
      continue;
    }

    const ts = Date.parse(obj.scrapedAt ?? "") || 0;
    const prev = index.get(key);
    if (!prev) {
      index.set(key, { raw: JSON.stringify(obj), scrapedAtMs: ts });
      stats.rowsKept++;
    } else if (ts >= prev.scrapedAtMs) {
      // более свежий snapshot вытесняет старый
      index.set(key, { raw: JSON.stringify(obj), scrapedAtMs: ts });
      stats.rowsReplaced++;
    }
    // иначе — старее, игнорируем
  }
}

function pickKey(obj: ScrapedShape): string | null {
  if (obj.sourceUrl) {
    // нормализуем до pathname — это и есть стабильный ID на сайте
    try {
      const u = new URL(obj.sourceUrl);
      return `url:${u.pathname}`;
    } catch {
      return `url:${obj.sourceUrl}`;
    }
  }
  if (obj.barcode) return `barcode:${obj.barcode}`;
  return null;
}

async function main(): Promise<void> {
  const args = parseCli();

  const fromExplicit = args.inputs.map((p) => path.resolve(p));
  const fromGlob = args.inputGlob ? await expandGlob(args.inputGlob) : [];
  const files = Array.from(new Set([...fromExplicit, ...fromGlob])).sort();

  if (files.length === 0) {
    throw new Error("no input files matched");
  }

  log(`Merging ${files.length} JSONL file(s) → ${args.output}`);
  for (const f of files) log(`  in:  ${f}`);

  const index = new Map<string, MergedRow>();
  const stats = {
    rowsRead: 0,
    rowsKept: 0,
    rowsReplaced: 0,
    rowsBroken: 0,
  };

  for (const file of files) {
    try {
      const before = stats.rowsRead;
      await ingestFile(file, index, stats);
      log(`  read ${stats.rowsRead - before} rows from ${path.basename(file)}`);
    } catch (e) {
      log(`  SKIP ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log(
    `Index built: ${index.size} unique keys; rowsRead=${stats.rowsRead} ` +
      `kept=${stats.rowsKept} replaced=${stats.rowsReplaced} broken=${stats.rowsBroken}`,
  );

  if (args.dryRun) {
    log("--dry-run: not writing output");
    return;
  }

  const outAbs = path.resolve(args.output);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });

  // Atomic-ish write: пишем во временный файл, потом rename.
  const tmp = outAbs + ".tmp";
  const fd = await fs.open(tmp, "w");
  try {
    // Стабильный порядок: сортируем ключи — diff'ы и `wc -l` будут понятнее.
    const keys = Array.from(index.keys()).sort();
    for (const k of keys) {
      const r = index.get(k);
      if (!r) continue;
      await fd.write(r.raw + "\n");
    }
  } finally {
    await fd.close();
  }
  await fs.rename(tmp, outAbs);
  log(`Wrote ${index.size} rows → ${outAbs}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
