/**
 * Skinly · migrate · Product.imageUrl — перенос внешних изображений на наш сервер
 *
 * Production-safe, идемпотентный, безопасный для повторного запуска.
 * НИЧЕГО не удаляет из БД. imageUrl обновляется ТОЛЬКО после успешной
 * атомарной записи файла (.part → rename). Оригинальный URL сохраняется в
 * Product.sourceImageUrl перед перезаписью.
 *
 * Запуск (см. также README / комментарии в docker-compose.yml):
 *   npm run migrate:product-images -- --dry-run
 *   npm run migrate:product-images -- --limit 100
 *   npm run migrate:product-images -- --limit 1000 --concurrency 5
 *   npm run migrate:product-images            # полный запуск
 *
 * Флаги:
 *   --limit N            обработать не более N товаров (по умолчанию: все)
 *   --concurrency N      параллельных загрузок (по умолчанию 5)
 *   --timeout MS         таймаут на загрузку (по умолчанию 15000)
 *   --retries N          повторов при ошибке (по умолчанию 2)
 *   --dry-run            ничего не писать (ни файлы, ни БД) — только отчёт
 *   --resume             пропускать товары, у которых уже проставлен
 *                        sourceImageUrl (доп. защита при продолжении)
 *   --storage-dir PATH   куда писать файлы
 *                        (default: $SKINLY_STORAGE_DIR или ./storage/product-images)
 *   --public-base-url U  база для локального URL
 *                        (default: $SKINLY_PUBLIC_BASE_URL или
 *                         https://skinly.msvoronov.com; пусто → относительный URL)
 *   --placeholder-url U  чем заменить заглушки %1x1% (по умолчанию — не трогать)
 *   --min-free-gb N      минимум свободного места, ниже которого стоп (default 8)
 *
 * Формат хранения:
 *   <storage-dir>/ab/cd/<sha256(url)>.<ext>
 *   URL: <public-base>/product-images/ab/cd/<sha256(url)>.<ext>
 *   ext определяется по Content-Type (fallback — по URL). Исходный формат
 *   сохраняется (JPEG/PNG/WebP/AVIF/GIF), без перекодирования.
 */

import { once } from "node:events";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const prisma = new PrismaClient({ log: ["error", "warn"] });

/* ───────── constants ───────── */

const URL_PREFIX = "/product-images"; // публичный path-префикс (Caddy route)
const MAX_BYTES = 25 * 1024 * 1024; // защита от rogue-файла (картинки крошечные)
const MIN_BYTES = 100; // ниже — это не реальное изображение, а стуб/HTML/битый файл
const GB = 1024 ** 3;

/* ───────── CLI ───────── */

interface CliArgs {
  limit: number | null;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  dryRun: boolean;
  resume: boolean;
  storageDir: string;
  publicBaseUrl: string; // "" → относительный URL
  placeholderUrl: string | null;
  minFreeBytes: number;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      concurrency: { type: "string", default: "5" },
      timeout: { type: "string", default: "15000" },
      retries: { type: "string", default: "2" },
      "dry-run": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      "storage-dir": { type: "string" },
      "public-base-url": { type: "string" },
      "placeholder-url": { type: "string" },
      "min-free-gb": { type: "string", default: "8" },
    },
  });

  const concurrency = parseInt(String(values.concurrency), 10);
  const timeoutMs = parseInt(String(values.timeout), 10);
  const retries = parseInt(String(values.retries), 10);
  const limit = values.limit ? parseInt(String(values.limit), 10) : null;
  const minFreeGb = parseFloat(String(values["min-free-gb"]));

  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 50)
    throw new Error("--concurrency must be 1..50");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000)
    throw new Error("--timeout must be >= 1000");
  if (!Number.isFinite(retries) || retries < 0)
    throw new Error("--retries must be >= 0");
  if (limit !== null && (!Number.isFinite(limit) || limit < 1))
    throw new Error("--limit must be a positive integer");

  const storageDir =
    (values["storage-dir"] as string | undefined) ??
    process.env.SKINLY_STORAGE_DIR ??
    path.resolve(process.cwd(), "storage/product-images");

  // public-base-url: явный флаг > env > дефолт. Пустая строка (флаг задан как
  // "") → относительный URL. Убираем хвостовой слэш.
  const rawBase =
    values["public-base-url"] !== undefined
      ? String(values["public-base-url"])
      : (process.env.SKINLY_PUBLIC_BASE_URL ?? "https://skinly.msvoronov.com");
  const publicBaseUrl = rawBase.replace(/\/+$/, "");

  return {
    limit,
    concurrency,
    timeoutMs,
    retries,
    dryRun: Boolean(values["dry-run"]),
    resume: Boolean(values.resume),
    storageDir,
    publicBaseUrl,
    placeholderUrl: (values["placeholder-url"] as string | undefined) ?? null,
    minFreeBytes: Math.round(minFreeGb * GB),
  };
}

/* ───────── helpers ───────── */

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

const isPlaceholder = (url: string): boolean => url.includes("%1x1%");

/** Уже локальный URL (мигрирован ранее) — пропускаем. */
const isLocalUrl = (url: string): boolean => url.includes(`${URL_PREFIX}/`);

/** Content-Type / URL → расширение. null = не изображение. */
function extFromContentType(contentType: string | null, url: string): string | null {
  const ct = (contentType ?? "").toLowerCase().split(";")[0].trim();
  switch (ct) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
  }
  // octet-stream / пусто — пробуем по URL-расширению
  if (ct === "" || ct === "application/octet-stream" || ct === "binary/octet-stream") {
    const m = url.toLowerCase().match(/\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/);
    if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  }
  return null; // html/json/svg/etc — не сохраняем как реальное изображение
}

/**
 * Проверка по «магическим байтам» заголовка файла. Content-Type может врать
 * (CDN/WAF отдают HTML-страницу или стуб с image/*), поэтому источником правды
 * о формате являются реальные байты. null = не распознанное изображение.
 */
function sniffImageFormat(head: Buffer): "jpg" | "png" | "gif" | "webp" | "avif" | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return "jpg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  )
    return "png";
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46)
    return "gif"; // GIF87a / GIF89a
  if (
    head.length >= 12 &&
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  if (head.length >= 12 && head.toString("ascii", 4, 8) === "ftyp") {
    const brand = head.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis" || brand === "mif1" || brand === "msf1")
      return "avif";
  }
  return null;
}

const KNOWN_EXTS = ["jpg", "png", "webp", "avif", "gif"] as const;

/** Относительный путь файла в storage-dir по хешу URL. */
function relPathFor(hash: string, ext: string): string {
  return path.join(hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ext}`);
}

/** Локальный публичный URL. */
function publicUrlFor(base: string, hash: string, ext: string): string {
  const rel = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${ext}`;
  return `${base}${URL_PREFIX}/${rel}`;
}

/** Ищем уже существующий непустой файл hash.<ext> (идемпотентность между запусками). */
function findExistingFile(storageDir: string, hash: string): { ext: string; abs: string } | null {
  for (const ext of KNOWN_EXTS) {
    const abs = path.join(storageDir, relPathFor(hash, ext));
    try {
      if (statSync(abs).size > 0) return { ext, abs };
    } catch {
      /* not found */
    }
  }
  return null;
}

async function freeBytes(dir: string): Promise<number> {
  const s = await statfs(dir);
  return s.bsize * s.bavail;
}

function fmtBytes(b: number): string {
  if (b >= GB) return `${(b / GB).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ───────── download (streamed, атомарно) ───────── */

interface DownloadOutcome {
  ok: boolean;
  localUrl: string | null;
  ext: string | null;
  bytesWritten: number; // >0 только если реально скачали в этот раз
  reusedFromDisk: boolean; // файл уже был на диске
  httpStatus: number | null;
  contentType: string | null;
  error: string | null;
}

/**
 * Скачивает URL в storage атомарно (.part → rename). Стримит, не держит файл
 * целиком в памяти. Идемпотентно: если файл hash.<ext> уже есть и непустой —
 * не качает повторно. dry-run: сеть трогаем только чтобы определить ext? Нет —
 * в dry-run сеть не трогаем вовсе, ext угадываем по URL.
 */
async function downloadOne(
  url: string,
  hash: string,
  cli: CliArgs,
): Promise<DownloadOutcome> {
  // 1) уже на диске?
  const existing = findExistingFile(cli.storageDir, hash);
  if (existing) {
    return {
      ok: true,
      localUrl: publicUrlFor(cli.publicBaseUrl, hash, existing.ext),
      ext: existing.ext,
      bytesWritten: 0,
      reusedFromDisk: true,
      httpStatus: null,
      contentType: null,
      error: null,
    };
  }

  // 2) dry-run — не качаем, оцениваем ext по URL
  if (cli.dryRun) {
    const m = url.toLowerCase().match(/\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/);
    const ext = m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "jpg";
    return {
      ok: true,
      localUrl: publicUrlFor(cli.publicBaseUrl, hash, ext),
      ext,
      bytesWritten: 0,
      reusedFromDisk: false,
      httpStatus: null,
      contentType: null,
      error: null,
    };
  }

  let lastErr: string | null = "not attempted";
  let lastStatus: number | null = null;
  let lastCt: string | null = null;

  for (let attempt = 0; attempt <= cli.retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cli.timeoutMs);
    let partPath: string | null = null;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; SkinlyImageMigrator/1.0; +https://skinly.msvoronov.com)",
        },
      });
      lastStatus = res.status;
      lastCt = res.headers.get("content-type");

      if (!res.ok || !res.body) {
        lastErr = `HTTP ${res.status}`;
        await res.body?.cancel().catch(() => {});
        continue;
      }

      const ext = extFromContentType(lastCt, url);
      if (!ext) {
        lastErr = `unsupported content-type: ${lastCt ?? "(none)"}`;
        await res.body.cancel().catch(() => {});
        break; // не изображение — повтор не поможет
      }

      const cl = res.headers.get("content-length");
      const clNum = cl ? parseInt(cl, 10) : NaN;
      if (Number.isFinite(clNum) && clNum > MAX_BYTES) {
        lastErr = `too large: ${clNum} bytes`;
        await res.body.cancel().catch(() => {});
        break;
      }

      // sharded-директория по хешу (не зависит от расширения — финальный ext
      // определяется по реальным байтам ПОСЛЕ загрузки). .part в той же
      // директории → rename атомарен (один filesystem).
      const shardDir = path.join(cli.storageDir, hash.slice(0, 2), hash.slice(2, 4));
      mkdirSync(shardDir, { recursive: true });
      partPath = path.join(shardDir, `${hash}.${process.pid}.part`);

      // стрим web → node → файл, без буферизации целиком.
      // Параллельно копим первые 12 байт для magic-byte проверки.
      const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
      const out = createWriteStream(partPath);
      let written = 0;
      let head = Buffer.alloc(0);
      try {
        for await (const chunk of nodeStream) {
          const buf = chunk as Buffer;
          if (head.length < 12) {
            head = Buffer.concat([head, buf.subarray(0, 12 - head.length)]);
          }
          written += buf.length;
          if (written > MAX_BYTES) {
            throw new Error(`too large (streamed > ${MAX_BYTES})`);
          }
          if (!out.write(buf)) await once(out, "drain");
        }
        out.end();
        await once(out, "finish");
      } catch (streamErr) {
        out.destroy();
        throw streamErr;
      }

      // Валидация СОДЕРЖИМОГО (не заголовка): защита от пустых/битых файлов и
      // от HTML/стубов, отданных с image/* Content-Type. Детерминированно —
      // без ретраев (повтор даст тот же мусор).
      if (written < MIN_BYTES) {
        lastErr = `too small: ${written} bytes (< ${MIN_BYTES})`;
        break;
      }
      const sniffed = sniffImageFormat(head);
      if (!sniffed) {
        lastErr = `content is not a valid image (magic bytes); ct=${lastCt ?? "(none)"}`;
        break;
      }

      // Расширение — по реальным байтам (точнее, чем Content-Type).
      const finalExt = sniffed;
      const absPath = path.join(shardDir, `${hash}.${finalExt}`);

      // атомарная публикация
      renameSync(partPath, absPath);
      partPath = null;
      clearTimeout(timer);

      return {
        ok: true,
        localUrl: publicUrlFor(cli.publicBaseUrl, hash, finalExt),
        ext: finalExt,
        bytesWritten: written,
        reusedFromDisk: false,
        httpStatus: lastStatus,
        contentType: lastCt,
        error: null,
      };
    } catch (e) {
      lastErr = `${(e as Error).name}: ${(e as Error).message}`;
    } finally {
      clearTimeout(timer);
      if (partPath) {
        try {
          if (existsSync(partPath)) unlinkSync(partPath);
        } catch {
          /* ignore cleanup error */
        }
      }
    }
  }

  return {
    ok: false,
    localUrl: null,
    ext: null,
    bytesWritten: 0,
    reusedFromDisk: false,
    httpStatus: lastStatus,
    contentType: lastCt,
    error: lastErr,
  };
}

/* ───────── concurrency pool ───────── */

async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
}

/* ───────── types ───────── */

interface ProductRow {
  id: string;
  barcode: string;
  brand: string;
  name: string;
  imageUrl: string;
  sourceImageUrl: string | null;
}

type RowStatus =
  | "downloaded"
  | "reused_disk"
  | "deduplicated"
  | "placeholder"
  | "skipped_local"
  | "skipped_resume"
  | "failed";

interface RowResult {
  productId: string;
  barcode: string;
  brand: string;
  name: string;
  sourceUrl: string;
  localUrl: string | null;
  status: RowStatus;
  bytesWritten: number;
  httpStatus: number | null;
  error: string | null;
}

/* ───────── main ───────── */

async function main(): Promise<void> {
  const cli = parseCli();
  const startedAt = Date.now();

  log(
    `start: dryRun=${cli.dryRun} concurrency=${cli.concurrency} timeout=${cli.timeoutMs}ms ` +
      `retries=${cli.retries} limit=${cli.limit ?? "all"} resume=${cli.resume}`,
  );
  log(`storage-dir     : ${cli.storageDir}`);
  log(`public-base-url : ${cli.publicBaseUrl || "(relative)"}`);
  if (!cli.publicBaseUrl) {
    log(
      "WARNING: public-base-url пустой → относительные URL. Web работает, но " +
        "МОБИЛЬНОЕ приложение (RN <Image uri>) не отобразит относительные пути. " +
        "Для прод-релиза используйте абсолютный --public-base-url.",
    );
  }

  // storage-dir должен существовать (в проде — bind mount). Не в dry-run — создадим.
  if (!cli.dryRun) {
    mkdirSync(cli.storageDir, { recursive: true });
  } else if (!existsSync(cli.storageDir)) {
    // для оценки свободного места используем родителя/cwd
    log(`(dry-run) storage-dir не существует, оценка места по: ${process.cwd()}`);
  }

  // защита диска — перед стартом
  const checkDir = existsSync(cli.storageDir) ? cli.storageDir : process.cwd();
  let free = await freeBytes(checkDir);
  log(`free space      : ${fmtBytes(free)} (порог ${fmtBytes(cli.minFreeBytes)})`);
  if (free < cli.minFreeBytes) {
    log(`ABORT: свободно ${fmtBytes(free)} < порога ${fmtBytes(cli.minFreeBytes)}`);
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // выборка товаров с внешним imageUrl
  const rows = (await prisma.product.findMany({
    where: {
      imageUrl: { not: null },
      OR: [
        { imageUrl: { startsWith: "http://" } },
        { imageUrl: { startsWith: "https://" } },
      ],
      ...(cli.resume ? { sourceImageUrl: null } : {}),
    },
    select: {
      id: true,
      barcode: true,
      brand: true,
      name: true,
      imageUrl: true,
      sourceImageUrl: true,
    },
    orderBy: { createdAt: "asc" },
    ...(cli.limit ? { take: cli.limit } : {}),
  })) as ProductRow[];

  const totalProducts = rows.length;
  log(`products with external imageUrl: ${totalProducts}`);

  // уникальные внешние URL (только реальные, без заглушек)
  const uniqueUrls = new Set<string>();
  let placeholderPre = 0;
  for (const r of rows) {
    if (isPlaceholder(r.imageUrl)) placeholderPre++;
    else if (!isLocalUrl(r.imageUrl)) uniqueUrls.add(r.imageUrl);
  }
  log(`unique external URLs (excl. placeholders): ${uniqueUrls.size}`);
  log(`placeholder (%1x1%) URLs               : ${placeholderPre}`);

  // счётчики
  let downloadedFiles = 0;
  let reusedExistingFiles = 0;
  let deduplicatedProducts = 0;
  let placeholders = 0;
  let updatedProducts = 0;
  let failedProducts = 0;
  let bytesWritten = 0;

  const seenHash = new Set<string>(); // hash уже обслужен в этом запуске
  const inflight = new Map<string, Promise<DownloadOutcome>>(); // dedup + анти-гонка .part
  const results: RowResult[] = new Array(totalProducts);

  let processed = 0;
  let diskAborted = false;

  await runPool(
    rows,
    async (p, idx) => {
      if (diskAborted) {
        results[idx] = {
          productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
          sourceUrl: p.imageUrl, localUrl: null, status: "failed",
          bytesWritten: 0, httpStatus: null, error: "aborted: low disk space",
        };
        return;
      }

      const url = p.imageUrl;

      // уже локальный — пропуск
      if (isLocalUrl(url)) {
        results[idx] = {
          productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
          sourceUrl: url, localUrl: url, status: "skipped_local",
          bytesWritten: 0, httpStatus: null, error: null,
        };
        return;
      }

      // resume-guard (доп. к where-фильтру)
      if (cli.resume && p.sourceImageUrl) {
        results[idx] = {
          productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
          sourceUrl: url, localUrl: p.imageUrl, status: "skipped_resume",
          bytesWritten: 0, httpStatus: null, error: null,
        };
        return;
      }

      // заглушка
      if (isPlaceholder(url)) {
        placeholders++;
        if (cli.placeholderUrl && !cli.dryRun) {
          try {
            await prisma.product.update({
              where: { id: p.id },
              data: {
                sourceImageUrl: p.sourceImageUrl ?? url,
                imageUrl: cli.placeholderUrl,
              },
            });
            updatedProducts++;
          } catch (e) {
            failedProducts++;
            results[idx] = {
              productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
              sourceUrl: url, localUrl: null, status: "failed",
              bytesWritten: 0, httpStatus: null,
              error: `db: ${(e as Error).message}`,
            };
            return;
          }
        }
        results[idx] = {
          productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
          sourceUrl: url, localUrl: cli.placeholderUrl ?? url, status: "placeholder",
          bytesWritten: 0, httpStatus: null, error: null,
        };
        return;
      }

      // периодическая проверка диска
      if (!cli.dryRun && processed % 200 === 0) {
        free = await freeBytes(cli.storageDir);
        if (free < cli.minFreeBytes) {
          diskAborted = true;
          log(`ABORT (mid-run): свободно ${fmtBytes(free)} < ${fmtBytes(cli.minFreeBytes)}`);
          results[idx] = {
            productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
            sourceUrl: url, localUrl: null, status: "failed",
            bytesWritten: 0, httpStatus: null, error: "aborted: low disk space",
          };
          return;
        }
      }

      const hash = sha256(url);

      // memoized download (дедуп + защита от гонок по .part)
      let dlPromise = inflight.get(hash);
      const firstForHash = !dlPromise;
      if (!dlPromise) {
        dlPromise = downloadOne(url, hash, cli);
        inflight.set(hash, dlPromise);
      }
      const dl = await dlPromise;

      if (!dl.ok || !dl.localUrl) {
        failedProducts++;
        results[idx] = {
          productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
          sourceUrl: url, localUrl: null, status: "failed",
          bytesWritten: 0, httpStatus: dl.httpStatus, error: dl.error,
        };
        processed++;
        return;
      }

      // учёт скачивания / переиспользования — только для «первого» товара на hash
      let status: RowStatus;
      if (!seenHash.has(hash)) {
        seenHash.add(hash);
        if (dl.reusedFromDisk) {
          reusedExistingFiles++;
          status = "reused_disk";
        } else {
          downloadedFiles++;
          bytesWritten += dl.bytesWritten;
          status = "downloaded";
        }
      } else {
        deduplicatedProducts++;
        status = "deduplicated";
      }
      // если это первый await'ивший, но hash уже был в seen (гонка) — тоже дедуп
      if (!firstForHash && status === "downloaded") {
        // не должно случаться из-за memoize, но на всякий случай не двойной учёт
      }

      // обновляем БД только после успешной записи файла
      if (!cli.dryRun) {
        try {
          await prisma.product.update({
            where: { id: p.id },
            data: {
              sourceImageUrl: p.sourceImageUrl ?? url,
              imageUrl: dl.localUrl,
            },
          });
          updatedProducts++;
        } catch (e) {
          failedProducts++;
          results[idx] = {
            productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
            sourceUrl: url, localUrl: dl.localUrl, status: "failed",
            bytesWritten: dl.bytesWritten, httpStatus: dl.httpStatus,
            error: `db: ${(e as Error).message}`,
          };
          processed++;
          return;
        }
      } else {
        updatedProducts++; // would-be update
      }

      results[idx] = {
        productId: p.id, barcode: p.barcode, brand: p.brand, name: p.name,
        sourceUrl: url, localUrl: dl.localUrl, status,
        bytesWritten: dl.bytesWritten, httpStatus: dl.httpStatus, error: null,
      };

      processed++;
      if (processed % 500 === 0) {
        log(
          `progress: ${processed}/${totalProducts} · dl=${downloadedFiles} ` +
            `reuse=${reusedExistingFiles} dedup=${deduplicatedProducts} ` +
            `ph=${placeholders} fail=${failedProducts} · written=${fmtBytes(bytesWritten)} ` +
            `· free=${fmtBytes(free)}`,
        );
      }
    },
    cli.concurrency,
  );

  /* ── final storage size / free ── */
  let finalStorageSize = 0;
  try {
    // грубая оценка: сумма bytesWritten этого запуска не равна общему размеру
    // хранилища между запусками; отдаём и то, и то. Точный размер — du на хосте.
    finalStorageSize = bytesWritten;
  } catch {
    /* ignore */
  }
  const freeAfter = await freeBytes(existsSync(cli.storageDir) ? cli.storageDir : process.cwd());
  const durationMs = Date.now() - startedAt;

  /* ── reports ── */
  const reportsDir = path.resolve(process.cwd(), "reports");
  mkdirSync(reportsDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    dryRun: cli.dryRun,
    params: {
      limit: cli.limit,
      concurrency: cli.concurrency,
      timeoutMs: cli.timeoutMs,
      retries: cli.retries,
      resume: cli.resume,
      storageDir: cli.storageDir,
      publicBaseUrl: cli.publicBaseUrl || "(relative)",
      placeholderUrl: cli.placeholderUrl,
      minFreeBytes: cli.minFreeBytes,
    },
    totals: {
      totalProducts,
      externalUrls: totalProducts,
      uniqueExternalUrls: uniqueUrls.size,
      placeholders,
      downloadedFiles,
      reusedExistingFiles,
      deduplicatedProducts,
      updatedProducts,
      failedProducts,
      bytesWritten,
      bytesWrittenHuman: fmtBytes(bytesWritten),
      finalStorageSizeThisRun: finalStorageSize,
      freeAfter,
      freeAfterHuman: fmtBytes(freeAfter),
      durationMs,
      durationHuman: `${(durationMs / 1000).toFixed(1)}s`,
    },
  };

  writeFileSync(
    path.join(reportsDir, "product-image-migration.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  // full CSV
  const header = [
    "productId", "barcode", "brand", "name",
    "sourceUrl", "localUrl", "status", "bytesWritten", "httpStatus", "error",
  ];
  const lines = [header.join(",")];
  const errLines = ["productId,barcode,sourceUrl,httpStatus,error"];
  for (const r of results) {
    if (!r) continue;
    lines.push(
      [
        r.productId, r.barcode, r.brand, r.name,
        r.sourceUrl, r.localUrl ?? "", r.status, r.bytesWritten,
        r.httpStatus ?? "", r.error ?? "",
      ].map(csvEscape).join(","),
    );
    if (r.status === "failed") {
      errLines.push(
        [r.productId, r.barcode, r.sourceUrl, r.httpStatus ?? "", r.error ?? ""]
          .map(csvEscape).join(","),
      );
    }
  }
  writeFileSync(path.join(reportsDir, "product-image-migration.csv"), lines.join("\n") + "\n", "utf8");
  writeFileSync(path.join(reportsDir, "product-image-migration-errors.csv"), errLines.join("\n") + "\n", "utf8");

  await prisma.$disconnect();

  /* ── console summary ── */
  log("──────── SUMMARY ────────");
  log(`dry-run             : ${cli.dryRun}`);
  log(`totalProducts       : ${totalProducts}`);
  log(`uniqueExternalUrls  : ${uniqueUrls.size}`);
  log(`placeholders        : ${placeholders}`);
  log(`downloadedFiles     : ${downloadedFiles}`);
  log(`reusedExistingFiles : ${reusedExistingFiles}`);
  log(`deduplicatedProducts: ${deduplicatedProducts}`);
  log(`updatedProducts     : ${updatedProducts}${cli.dryRun ? " (would-be)" : ""}`);
  log(`failedProducts      : ${failedProducts}`);
  log(`bytesWritten        : ${fmtBytes(bytesWritten)}`);
  log(`free space (after)  : ${fmtBytes(freeAfter)}`);
  log(`duration            : ${(durationMs / 1000).toFixed(1)}s`);
  if (diskAborted) log("NOTE: остановлено по нехватке диска — перезапустите после освобождения места.");
  log(`reports: reports/product-image-migration.{json,csv} + -errors.csv`);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
