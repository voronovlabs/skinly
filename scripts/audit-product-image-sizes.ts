/**
 * Skinly · audit · Product.imageUrl — оценка размеров изображений (READ-ONLY)
 *
 * Запуск:
 *   npm run audit:product-images:size
 *   npm run audit:product-images:size -- --concurrency 20 --limit 500
 *
 * Что делает:
 *   Только SELECT из БД + сетевые HEAD/Range-запросы. Ничего не пишет в БД,
 *   файлы изображений НЕ скачивает.
 *
 *   Для каждого товара с внешним (http/https) imageUrl:
 *     1. HEAD-запрос → Content-Length + Content-Type.
 *     2. Если HEAD не поддерживается (405/501, сетевые ошибки, нет длины) —
 *        GET с "Range: bytes=0-0" → Content-Range: bytes 0-0/TOTAL.
 *     3. Timeout 10 c на попытку, до 2 retry (итого ≤ 3 попыток).
 *
 *   Статистика: доступность, суммарный/средний/медианный размер,
 *   p90/p95/p99, топ-50 самых тяжёлых, разбивка по доменам и форматам
 *   (WebP / JPEG / PNG / AVIF / GIF / прочее).
 *
 * Результат:
 *   reports/product-image-size-audit.json
 *   reports/product-image-size-audit.csv
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const prisma = new PrismaClient({ log: ["error", "warn"] });

/* ───────── CLI ───────── */

interface CliArgs {
  concurrency: number;
  limit: number | null; // null = все
  timeoutMs: number;
  retries: number;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      concurrency: { type: "string", default: "15" },
      limit: { type: "string" },
      timeout: { type: "string", default: "10000" },
      retries: { type: "string", default: "2" },
    },
  });
  const concurrency = parseInt(String(values.concurrency), 10);
  const timeoutMs = parseInt(String(values.timeout), 10);
  const retries = parseInt(String(values.retries), 10);
  const limit = values.limit ? parseInt(String(values.limit), 10) : null;
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 50)
    throw new Error("--concurrency must be 1..50");
  if (limit !== null && (!Number.isFinite(limit) || limit < 1))
    throw new Error("--limit must be a positive integer");
  return { concurrency, limit, timeoutMs, retries };
}

/* ───────── Types ───────── */

type ProbeStatus = "ok" | "ok_no_length" | "unreachable";
type ProbeMethod = "head" | "range_get" | null;

interface ProbeResult {
  productId: string;
  barcode: string;
  brand: string;
  name: string;
  url: string;
  domain: string;
  status: ProbeStatus;
  method: ProbeMethod;
  httpStatus: number | null;
  contentType: string | null;
  format: string; // webp | jpeg | png | avif | gif | svg | unknown
  sizeBytes: number | null;
  error: string | null;
}

/* ───────── Helpers ───────── */

const USER_AGENT =
  "Mozilla/5.0 (compatible; SkinlyImageAudit/1.0; +https://skinly.msvoronov.com)";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "(invalid-url)";
  }
}

/** Формат по Content-Type, fallback — по расширению в URL. */
function detectFormat(contentType: string | null, url: string): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("webp")) return "webp";
  if (ct.includes("avif")) return "avif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpeg";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  const m = url.toLowerCase().match(/\.(webp|avif|jpe?g|png|gif|svg)(?:[?#]|$)/);
  if (m) return m[1] === "jpg" ? "jpeg" : m[1];
  return "unknown";
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    signal: controller.signal,
    redirect: "follow",
    headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
  }).finally(() => clearTimeout(timer));
}

/** Content-Range: "bytes 0-0/123456" → 123456 */
function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = header.match(/\/(\d+)\s*$/);
  if (!m) return null;
  const total = parseInt(m[1], 10);
  return Number.isFinite(total) && total > 0 ? total : null;
}

interface AttemptOutcome {
  httpStatus: number | null;
  contentType: string | null;
  sizeBytes: number | null;
  ok: boolean; // сервер ответил 2xx/206
  error: string | null;
}

async function tryHead(url: string, timeoutMs: number): Promise<AttemptOutcome> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" }, timeoutMs);
    const len = res.headers.get("content-length");
    const size = len ? parseInt(len, 10) : null;
    return {
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      sizeBytes: Number.isFinite(size as number) && (size as number) > 0 ? size : null,
      ok: res.ok,
      error: res.ok ? null : `HEAD ${res.status}`,
    };
  } catch (e) {
    return {
      httpStatus: null,
      contentType: null,
      sizeBytes: null,
      ok: false,
      error: `HEAD ${(e as Error).name}: ${(e as Error).message}`,
    };
  }
}

async function tryRangeGet(url: string, timeoutMs: number): Promise<AttemptOutcome> {
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "GET", headers: { range: "bytes=0-0" } },
      timeoutMs,
    );
    // Тело не читаем: отменяем поток сразу (пришёл максимум 1 байт).
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    let size: number | null = null;
    if (res.status === 206) {
      size = parseContentRangeTotal(res.headers.get("content-range"));
    } else if (res.ok) {
      // Сервер проигнорировал Range и ответил 200 — Content-Length = полный размер.
      const len = res.headers.get("content-length");
      const parsed = len ? parseInt(len, 10) : NaN;
      size = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return {
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      sizeBytes: size,
      ok: res.ok, // res.ok покрывает и 206
      error: res.ok ? null : `GET(range) ${res.status}`,
    };
  } catch (e) {
    return {
      httpStatus: null,
      contentType: null,
      sizeBytes: null,
      ok: false,
      error: `GET(range) ${(e as Error).name}: ${(e as Error).message}`,
    };
  }
}

/**
 * Одна проба URL: HEAD → (fallback) GET Range, с retry.
 * Retry применяется к паре HEAD+Range целиком: до (1 + retries) раундов.
 */
async function probeUrl(
  p: { id: string; barcode: string; brand: string; name: string; imageUrl: string },
  timeoutMs: number,
  retries: number,
): Promise<ProbeResult> {
  const url = p.imageUrl;
  let last: AttemptOutcome = {
    httpStatus: null,
    contentType: null,
    sizeBytes: null,
    ok: false,
    error: "not attempted",
  };
  let method: ProbeMethod = null;

  for (let round = 0; round <= retries; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 300 * round));

    const head = await tryHead(url, timeoutMs);
    if (head.ok && head.sizeBytes !== null) {
      last = head;
      method = "head";
      break;
    }

    const range = await tryRangeGet(url, timeoutMs);
    if (range.ok) {
      last = range;
      method = "range_get";
      break;
    }

    // Если HEAD ответил 2xx, но без длины — фиксируем как лучший из раунда.
    if (head.ok) {
      last = head;
      method = "head";
    } else {
      last = range;
      method = range.httpStatus !== null ? "range_get" : null;
    }
  }

  const status: ProbeStatus = last.ok
    ? last.sizeBytes !== null
      ? "ok"
      : "ok_no_length"
    : "unreachable";

  return {
    productId: p.id,
    barcode: p.barcode,
    brand: p.brand,
    name: p.name,
    url,
    domain: domainOf(url),
    status,
    method: last.ok ? method : method,
    httpStatus: last.httpStatus,
    contentType: last.contentType,
    format: detectFormat(last.contentType, url),
    sizeBytes: last.sizeBytes,
    error: last.error,
  };
}

/* ───────── Concurrency pool ───────── */

async function runPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onProgress: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
      done++;
      onProgress(done, items.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return results;
}

/* ───────── Stats ───────── */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

const fmtBytes = (b: number): string => {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
};

/* ───────── CSV ───────── */

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ───────── Main ───────── */

async function main(): Promise<void> {
  const cli = parseCli();
  log(
    `start: concurrency=${cli.concurrency}, timeout=${cli.timeoutMs}ms, retries=${cli.retries}, limit=${cli.limit ?? "all"}`,
  );

  const products = await prisma.product.findMany({
    where: {
      imageUrl: { not: null },
      OR: [
        { imageUrl: { startsWith: "http://" } },
        { imageUrl: { startsWith: "https://" } },
      ],
    },
    select: { id: true, barcode: true, brand: true, name: true, imageUrl: true },
    orderBy: { createdAt: "asc" },
    ...(cli.limit ? { take: cli.limit } : {}),
  });
  await prisma.$disconnect();

  const targets = products.filter(
    (p): p is typeof p & { imageUrl: string } => !!p.imageUrl,
  );
  log(`products with external image URL: ${targets.length}`);
  if (targets.length === 0) {
    log("nothing to audit, exiting");
    return;
  }

  let lastLogged = 0;
  const results = await runPool(
    targets,
    (p) => probeUrl(p, cli.timeoutMs, cli.retries),
    cli.concurrency,
    (done, total) => {
      if (done - lastLogged >= 200 || done === total) {
        lastLogged = done;
        log(`progress: ${done}/${total}`);
      }
    },
  );

  /* ── Aggregation ── */

  const reachable = results.filter((r) => r.status !== "unreachable");
  const unreachable = results.filter((r) => r.status === "unreachable");
  const noLength = results.filter((r) => r.status === "ok_no_length");
  const sized = results.filter(
    (r): r is ProbeResult & { sizeBytes: number } => r.sizeBytes !== null,
  );

  const sizes = sized.map((r) => r.sizeBytes).sort((a, b) => a - b);
  const totalBytes = sizes.reduce((s, v) => s + v, 0);
  const avg = sizes.length ? Math.round(totalBytes / sizes.length) : 0;
  const median = percentile(sizes, 50);
  const p90 = percentile(sizes, 90);
  const p95 = percentile(sizes, 95);
  const p99 = percentile(sizes, 99);

  // Экстраполяция на URL без известного размера — по среднему.
  const estimatedTotalBytes =
    totalBytes + avg * (reachable.length - sized.length);

  const top50 = [...sized]
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 50);

  const byDomain = new Map<
    string,
    { count: number; reachable: number; sizedCount: number; bytes: number }
  >();
  for (const r of results) {
    const d = byDomain.get(r.domain) ?? {
      count: 0,
      reachable: 0,
      sizedCount: 0,
      bytes: 0,
    };
    d.count++;
    if (r.status !== "unreachable") d.reachable++;
    if (r.sizeBytes !== null) {
      d.sizedCount++;
      d.bytes += r.sizeBytes;
    }
    byDomain.set(r.domain, d);
  }
  const domains = [...byDomain.entries()]
    .map(([domain, d]) => ({
      domain,
      count: d.count,
      reachable: d.reachable,
      withSize: d.sizedCount,
      totalBytes: d.bytes,
      avgBytes: d.sizedCount ? Math.round(d.bytes / d.sizedCount) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const byFormat = new Map<string, { count: number; bytes: number }>();
  for (const r of reachable) {
    const f = byFormat.get(r.format) ?? { count: 0, bytes: 0 };
    f.count++;
    f.bytes += r.sizeBytes ?? 0;
    byFormat.set(r.format, f);
  }
  const formats = [...byFormat.entries()]
    .map(([format, f]) => ({ format, count: f.count, totalBytes: f.bytes }))
    .sort((a, b) => b.count - a.count);

  /* ── Report files ── */

  const reportsDir = path.resolve(process.cwd(), "reports");
  mkdirSync(reportsDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    params: cli,
    totals: {
      productsWithImageUrl: targets.length,
      reachable: reachable.length,
      unreachable: unreachable.length,
      withoutContentLength: noLength.length,
      withKnownSize: sized.length,
    },
    sizeStats: {
      knownTotalBytes: totalBytes,
      knownTotalGB: +(totalBytes / 1024 ** 3).toFixed(3),
      estimatedTotalBytes,
      estimatedTotalGB: +(estimatedTotalBytes / 1024 ** 3).toFixed(3),
      avgBytes: avg,
      medianBytes: median,
      p90Bytes: p90,
      p95Bytes: p95,
      p99Bytes: p99,
    },
    formats,
    domains,
    top50Heaviest: top50.map((r) => ({
      productId: r.productId,
      barcode: r.barcode,
      brand: r.brand,
      name: r.name,
      url: r.url,
      sizeBytes: r.sizeBytes,
      sizeHuman: fmtBytes(r.sizeBytes),
      format: r.format,
    })),
    unreachableSample: unreachable.slice(0, 100).map((r) => ({
      productId: r.productId,
      url: r.url,
      httpStatus: r.httpStatus,
      error: r.error,
    })),
  };

  const jsonPath = path.join(reportsDir, "product-image-size-audit.json");
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const csvHeader = [
    "productId",
    "barcode",
    "brand",
    "name",
    "url",
    "domain",
    "status",
    "method",
    "httpStatus",
    "contentType",
    "format",
    "sizeBytes",
    "error",
  ];
  const csvLines = [csvHeader.join(",")];
  for (const r of results) {
    csvLines.push(
      [
        r.productId,
        r.barcode,
        r.brand,
        r.name,
        r.url,
        r.domain,
        r.status,
        r.method ?? "",
        r.httpStatus ?? "",
        r.contentType ?? "",
        r.format,
        r.sizeBytes ?? "",
        r.error ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const csvPath = path.join(reportsDir, "product-image-size-audit.csv");
  writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  /* ── Console summary ── */

  log("──────── SUMMARY ────────");
  log(`products with image URL : ${targets.length}`);
  log(`reachable               : ${reachable.length}`);
  log(`unreachable             : ${unreachable.length}`);
  log(`reachable, no length    : ${noLength.length}`);
  log(`known total size        : ${fmtBytes(totalBytes)}`);
  log(
    `estimated total size    : ${fmtBytes(estimatedTotalBytes)} (${summary.sizeStats.estimatedTotalGB} GB)`,
  );
  log(`avg / median            : ${fmtBytes(avg)} / ${fmtBytes(median)}`);
  log(
    `p90 / p95 / p99         : ${fmtBytes(p90)} / ${fmtBytes(p95)} / ${fmtBytes(p99)}`,
  );
  log("formats:");
  for (const f of formats)
    log(`  ${f.format.padEnd(8)} ${String(f.count).padStart(6)}  ${fmtBytes(f.totalBytes)}`);
  log("top domains:");
  for (const d of domains.slice(0, 15))
    log(
      `  ${d.domain.padEnd(40)} ${String(d.count).padStart(6)}  reachable=${d.reachable}  avg=${fmtBytes(d.avgBytes)}  total=${fmtBytes(d.totalBytes)}`,
    );
  log("top 10 heaviest:");
  for (const r of top50.slice(0, 10))
    log(`  ${fmtBytes(r.sizeBytes).padStart(10)}  [${r.format}] ${r.brand} — ${r.name}`);
  log(`report JSON: ${jsonPath}`);
  log(`report CSV : ${csvPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
