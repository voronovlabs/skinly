/**
 * Хранение данных пайплайна: потоковый JSONL.
 *
 * Принципы:
 *   - data/raw/magnit-cosmetic-products.jsonl — append-only ground truth
 *     этапа 1. Resume выводится ИЗ САМОГО JSONL (readJsonlKeys), никакого
 *     state.json: аварийное завершение теряет максимум одну недописанную
 *     строку, которую streamJsonl молча пропускает.
 *   - Все чтения потоковые (readline), файлы целиком в память не грузятся.
 *   - Перезапись производных файлов (normalized/skipped/failed) — только
 *     атомарно: <file>.part → rename.
 */

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { once } from "node:events";
import * as path from "node:path";
import * as readline from "node:readline";
import { PATHS } from "./config";
import { debug } from "./logger";

async function ensureDir(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

/* ───────── чтение ───────── */

/**
 * Потоковое чтение JSONL. Битые/оборванные строки (аварийное завершение
 * процесса на середине записи) пропускаются с debug-логом — они не должны
 * ронять пайплайн.
 */
export async function* streamJsonl<T>(
  file: string,
): AsyncGenerator<{ value: T; line: number }> {
  try {
    await fs.access(file);
  } catch {
    return; // файла нет — пустой поток
  }
  const rl = readline.createInterface({
    input: createReadStream(file, "utf-8"),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const raw of rl) {
    n++;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      yield { value: JSON.parse(trimmed) as T, line: n };
    } catch {
      debug(`jsonl ${path.basename(file)}: битая строка ${n} — пропускаю`);
    }
  }
}

/**
 * Множество значений поля `key` по всем строкам JSONL (для resume/дедупа).
 * В памяти — только Set строк-идентификаторов, не сами записи.
 */
export async function readJsonlKeys(file: string, key: string): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const { value } of streamJsonl<Record<string, unknown>>(file)) {
    const v = value?.[key];
    if (typeof v === "string" && v) out.add(v);
  }
  return out;
}

/* ───────── запись ───────── */

/** Append одной строки (успех этапа 1, матч этапа 4 и т.п.). */
export async function appendJsonl(file: string, obj: unknown): Promise<void> {
  await ensureDir(file);
  await fs.appendFile(file, JSON.stringify(obj) + "\n", "utf-8");
}

/**
 * Атомарный писатель JSONL: пишет во <file>.part, при commit() переименовывает
 * поверх целевого файла. При падении процесса целевой файл остаётся прежним.
 * Уважает backpressure — память не растёт при больших объёмах.
 */
export class AtomicJsonlWriter {
  private constructor(
    private readonly file: string,
    private readonly tmp: string,
    private readonly ws: WriteStream,
  ) {}

  static async open(file: string): Promise<AtomicJsonlWriter> {
    await ensureDir(file);
    const tmp = `${file}.part`;
    const ws = createWriteStream(tmp, { encoding: "utf-8" });
    return new AtomicJsonlWriter(file, tmp, ws);
  }

  async write(obj: unknown): Promise<void> {
    if (!this.ws.write(JSON.stringify(obj) + "\n")) {
      await once(this.ws, "drain");
    }
  }

  async commit(): Promise<void> {
    this.ws.end();
    await once(this.ws, "close");
    await fs.rename(this.tmp, this.file);
  }

  /** Откат при ошибке: целевой файл не трогаем, .part удаляем. */
  async abort(): Promise<void> {
    this.ws.destroy();
    await fs.unlink(this.tmp).catch(() => undefined);
  }
}

/* ───────── прочее ───────── */

export async function saveJson(file: string, data: unknown): Promise<void> {
  await ensureDir(file);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function saveDebugHtml(externalId: string, html: string): Promise<void> {
  const file = path.join(PATHS.debugDir, `${externalId}.html`);
  await ensureDir(file);
  await fs.writeFile(file, html, "utf-8");
}
