/**
 * Skinly · FARERA barcode enrichment (этап 2, отдельно от парсера)
 *
 * Читает уже собранный `data/raw/farera-products.jsonl`, берёт товары без
 * штрихкода (у farera barcode всегда null) и пытается найти EAN на
 * barcode-list.ru по запросу `brand + title`. Результат — ENRICHMENT-
 * КАНДИДАТЫ, не истина.
 *
 * Полная изоляция:
 *   - НЕ трогает scrape-farera и farera-products.jsonl (только читает);
 *   - НЕ пишет в PostgreSQL;
 *   - пишет ТОЛЬКО в свои файлы:
 *       data/raw/farera-barcode-matches.jsonl
 *       data/state/farera-barcode-checkpoint.json
 *
 * Запуск:
 *   npm run enrich:farera-barcodes -- --limit 100
 *   npm run enrich:farera-barcodes -- --limit 100 --resume
 *   npm run enrich:farera-barcodes -- --limit 20 --dry-run
 *
 * Флаги:
 *   --limit N   сколько товаров обработать за запуск (по умолчанию 100)
 *   --resume    пропустить уже обработанные (по checkpoint + matches.jsonl)
 *   --dry-run   только показать query/URL, без запросов и без записи
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  buildSearchUrl,
  classifyCandidates,
  fetchSearchHtml,
  parseSearchResults,
  type BarcodeCandidate,
  type FareraQueryInput,
  type MatchStatus,
} from "./farera/barcode-list";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const PRODUCTS_JSONL = path.resolve("data/raw/farera-products.jsonl");
const MATCHES_JSONL = path.resolve("data/raw/farera-barcode-matches.jsonl");
const CHECKPOINT_FILE = path.resolve(
  "data/state/farera-barcode-checkpoint.json",
);

const DEFAULT_LIMIT = 100;
/** Сколько кандидатов сохранять в выходной строке. */
const MAX_CANDIDATES_OUT = 8;

/* ───────── типы ───────── */

interface FareraProductLite {
  sourceUrl: string;
  brand: string | null;
  title: string | null;
  volume: string | null;
  barcode: string | null;
}

interface EnrichCheckpoint {
  processed: string[]; // fareraSourceUrl, уже обработанные
  failed: { url: string; reason: string; at: string }[];
  startedAt: string;
  updatedAt: string;
}

interface MatchLine {
  source: "barcode-list";
  fareraSourceUrl: string;
  query: string;
  status: MatchStatus;
  barcode: string | null;
  matchedName: string | null;
  score: number;
  candidates: BarcodeCandidate[];
  enrichedAt: string;
}

/* ───────── CLI ───────── */

interface CliArgs {
  limit: number;
  resume: boolean;
  dryRun: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: String(DEFAULT_LIMIT) },
      resume: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const limit = parseInt(String(values.limit), 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return {
    limit,
    resume: Boolean(values.resume),
    dryRun: Boolean(values["dry-run"]),
  };
}

/* ───────── storage helpers (свои, отдельные от national-catalog) ───────── */

async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.dirname(MATCHES_JSONL), { recursive: true });
  await fs.mkdir(path.dirname(CHECKPOINT_FILE), { recursive: true });
}

async function loadCheckpoint(): Promise<EnrichCheckpoint> {
  try {
    const raw = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(raw) as EnrichCheckpoint;
  } catch {
    const now = new Date().toISOString();
    return { processed: [], failed: [], startedAt: now, updatedAt: now };
  }
}

async function saveCheckpoint(cp: EnrichCheckpoint): Promise<void> {
  cp.updatedAt = new Date().toISOString();
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function appendMatch(line: MatchLine): Promise<void> {
  await fs.appendFile(MATCHES_JSONL, JSON.stringify(line) + "\n");
}

/** URL'ы, уже записанные в matches.jsonl (для resume-дедупа). */
async function loadMatchedUrls(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const raw = await fs.readFile(MATCHES_JSONL, "utf-8");
    for (const ln of raw.split("\n")) {
      if (!ln.trim()) continue;
      try {
        const obj = JSON.parse(ln) as Partial<MatchLine>;
        if (obj.fareraSourceUrl) set.add(obj.fareraSourceUrl);
      } catch {
        /* битая строка — пропускаем */
      }
    }
  } catch {
    /* файла нет — ок */
  }
  return set;
}

async function readFareraProducts(): Promise<FareraProductLite[]> {
  let raw: string;
  try {
    raw = await fs.readFile(PRODUCTS_JSONL, "utf-8");
  } catch {
    throw new Error(
      `не найден ${PRODUCTS_JSONL} — сначала запустите npm run scrape:farera`,
    );
  }
  const out: FareraProductLite[] = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try {
      const o = JSON.parse(ln) as Partial<FareraProductLite>;
      if (!o.sourceUrl) continue;
      out.push({
        sourceUrl: o.sourceUrl,
        brand: o.brand ?? null,
        title: o.title ?? null,
        volume: o.volume ?? null,
        barcode: o.barcode ?? null,
      });
    } catch {
      /* битая строка — пропускаем */
    }
  }
  return out;
}

/* ───────── query ───────── */

function buildQuery(p: FareraProductLite): string {
  const brand = (p.brand ?? "").replace(/\(.*?\)/g, " ").trim();
  const title = (p.title ?? "").trim();
  // brand + title; если title уже начинается с бренда — не дублируем.
  const q =
    brand && !title.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} ${title}`
      : title || brand;
  return q.replace(/\s+/g, " ").trim();
}

/* ───────── main ───────── */

async function main(): Promise<void> {
  const args = parseCli();
  await ensureDirs();

  const checkpoint = await loadCheckpoint();
  const processedSet = new Set(checkpoint.processed);
  const matchedSet = args.resume ? await loadMatchedUrls() : new Set<string>();

  const products = await readFareraProducts();
  const noBarcode = products.filter((p) => p.barcode == null);

  log(
    `Starting FARERA barcode enrichment · limit=${args.limit} resume=${args.resume} ` +
      `dryRun=${args.dryRun}`,
  );
  log(
    `Products: ${products.length} total, ${noBarcode.length} without barcode. ` +
      `Already processed (checkpoint): ${processedSet.size}`,
  );
  log(`Output: ${MATCHES_JSONL}`);
  log(`Checkpoint: ${CHECKPOINT_FILE}`);

  // resume: пропускаем уже обработанные/записанные.
  const queue = noBarcode.filter(
    (p) =>
      !(args.resume && (processedSet.has(p.sourceUrl) || matchedSet.has(p.sourceUrl))),
  );
  log(`Queue this run: ${queue.length} (cap ${args.limit})`);

  const stats: Record<MatchStatus, number> & { failures: number } = {
    matched: 0,
    ambiguous: 0,
    not_found: 0,
    failures: 0,
  };

  let done = 0;
  for (const p of queue) {
    if (done >= args.limit) break;
    const query = buildQuery(p);
    if (!query) {
      log(`SKIP empty-query ${p.sourceUrl}`);
      continue;
    }

    if (args.dryRun) {
      log(`[dry-run] ${p.sourceUrl}\n            query="${query}"\n            url=${buildSearchUrl(query)}`);
      done++;
      continue;
    }

    log(`[${done + 1}/${args.limit}] "${query}"`);
    const input: FareraQueryInput = {
      brand: p.brand,
      title: p.title,
      volume: p.volume,
    };

    try {
      const html = await fetchSearchHtml(query, log);
      const candidates = parseSearchResults(html);
      const result = classifyCandidates(input, candidates);

      const line: MatchLine = {
        source: "barcode-list",
        fareraSourceUrl: p.sourceUrl,
        query,
        status: result.status,
        barcode: result.barcode,
        matchedName: result.matchedName,
        score: result.score,
        candidates: result.candidates.slice(0, MAX_CANDIDATES_OUT),
        enrichedAt: new Date().toISOString(),
      };
      await appendMatch(line);

      stats[result.status]++;
      checkpoint.processed.push(p.sourceUrl);
      done++;

      log(
        `  → ${result.status}` +
          (result.barcode ? ` barcode=${result.barcode} score=${result.score}` : ` (candidates=${candidates.length})`),
      );

      if (done % 10 === 0) {
        await saveCheckpoint(checkpoint);
        log(`Checkpoint saved (${done})`);
      }
    } catch (e) {
      stats.failures++;
      const reason = e instanceof Error ? e.message : String(e);
      checkpoint.failed.push({ url: p.sourceUrl, reason, at: new Date().toISOString() });
      log(`FAIL ${p.sourceUrl}: ${reason}`);
    }
  }

  if (!args.dryRun) await saveCheckpoint(checkpoint);

  log("──────────────────────────────────────────────");
  log("DONE (farera barcode enrichment)");
  log(`  processed this run:   ${done}`);
  log(`  matched:              ${stats.matched}`);
  log(`  ambiguous:            ${stats.ambiguous}`);
  log(`  not_found:            ${stats.not_found}`);
  log(`  failures:             ${stats.failures}`);
  log(`  total processed:      ${checkpoint.processed.length}`);
  log("──────────────────────────────────────────────");
  log("⚠️  matched-штрихкоды — это enrichment-кандидаты, НЕ источник истины.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
