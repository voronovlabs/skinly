/**
 * Phase 13.1 · lightweight active-scrapers tracking.
 *
 * Цель — НЕ строить distributed queue, а просто:
 *   1. Узнавать, сколько scraper-процессов уже бегут на хосте сейчас.
 *   2. Если их слишком много — выдать предупреждение (без crash'а).
 *   3. На выходе — за собой убраться.
 *
 * Реализация:
 *   - Каждый процесс пишет lock-файл в `data/state/active-scrapers/<slug>.lock`
 *     с JSON `{slug, startPath, startedAt, hostname, pid}`.
 *   - На старте — сканируем директорию, отбрасываем stale (старше
 *     `STALE_LOCK_AFTER_HOURS` часов), возвращаем активные.
 *   - На finally (или SIGINT/SIGTERM) — удаляем свой lock.
 *
 * Внутри Docker tools-контейнера `process.pid === 1` для каждого one-off
 * запуска, поэтому liveness по PID ненадёжен. Считаем «живым» любой lock
 * не старше STALE_LOCK_AFTER_HOURS — для warning'а этого достаточно.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PATHS } from "./config";

/**
 * Phase 13.2: snappy stale-timeout.
 *
 * Раньше было 24ч — на практике слишком долго: после crash'а / SIGKILL
 * lock висит почти сутки и накручивает фантом активного процесса. 2 часа —
 * комфортный компромисс: реальный scrape одной категории редко идёт дольше
 * (5000 продуктов × ~1с throttle ≈ 1ч 25 минут).
 */
export const STALE_LOCK_AFTER_HOURS = 2;
const STALE_AFTER_MS = STALE_LOCK_AFTER_HOURS * 60 * 60 * 1000;

export interface ActiveScraperRecord {
  slug: string;
  startPath: string | null;
  startedAt: string;
  hostname: string;
  pid: number;
  /** Полный path до lock-файла (заполняется при чтении). */
  file?: string;
}

function lockDir(): string {
  return path.resolve(PATHS.activeScrapersDir);
}

function lockPath(slug: string): string {
  return path.join(lockDir(), `${slug}.lock`);
}

async function ensureLockDir(): Promise<void> {
  await fs.mkdir(lockDir(), { recursive: true });
}

function isStale(record: ActiveScraperRecord): boolean {
  const ts = Date.parse(record.startedAt);
  if (!Number.isFinite(ts)) return true; // битый файл — считаем устаревшим
  return Date.now() - ts > STALE_AFTER_MS;
}

/**
 * Прочитать список активных scraper'ов. Stale lock'и автоматически
 * удаляются (housekeeping).
 */
export async function listActive(): Promise<ActiveScraperRecord[]> {
  await ensureLockDir();
  let entries: string[];
  try {
    entries = await fs.readdir(lockDir());
  } catch {
    return [];
  }

  const active: ActiveScraperRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".lock")) continue;
    const file = path.join(lockDir(), name);
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as ActiveScraperRecord;
      if (isStale(parsed)) {
        // тихо подметаем устаревшие
        await fs.unlink(file).catch(() => undefined);
        continue;
      }
      active.push({ ...parsed, file });
    } catch {
      // битый файл — удалим
      await fs.unlink(file).catch(() => undefined);
    }
  }
  return active;
}

/**
 * Зарегистрировать себя как активного scraper'а. Возвращает path к
 * своему lock-файлу — caller обязан вызвать `releaseLock(slug)` в finally.
 *
 * Если lock уже существует и НЕ stale — мы поверх него перезаписываем
 * (overlap отсюда допустим, потому что один и тот же slug, возможно,
 * был запущен повторно после crash'а; мы просто восстанавливаем владельца).
 */
export async function acquireLock(
  slug: string,
  startPath: string | null,
): Promise<string> {
  await ensureLockDir();
  const file = lockPath(slug);
  const record: ActiveScraperRecord = {
    slug,
    startPath,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
    pid: process.pid,
  };
  await fs.writeFile(file, JSON.stringify(record, null, 2));
  return file;
}

/** Снять lock. Никогда не бросает — best-effort. */
export async function releaseLock(slug: string): Promise<void> {
  try {
    await fs.unlink(lockPath(slug));
  } catch {
    /* lock уже удалён — ок */
  }
}

/**
 * Подписаться на SIGINT/SIGTERM, чтобы lock убрался при `docker stop`.
 * Возвращает функцию отписки (вызывается из finally, чтобы не дублировать
 * cleanup).
 */
export function setupLockCleanup(slug: string): () => void {
  const handler = () => {
    void releaseLock(slug);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
