/**
 * Промежуточное хранение: JSONL (append-only ground truth, как у других
 * источников в data/raw/) + JSON-выгрузки этапов + checkpoint для --resume.
 * Всё в git-ignored каталогах.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PATHS } from "./config";
import type { RawMagnitProduct } from "./types";

async function ensureDir(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

export async function appendRawJsonl(p: RawMagnitProduct): Promise<void> {
  await ensureDir(PATHS.rawJsonl);
  await fs.appendFile(PATHS.rawJsonl, JSON.stringify(p) + "\n", "utf-8");
}

export async function saveJson(file: string, data: unknown): Promise<void> {
  await ensureDir(file);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function saveDebugHtml(externalId: string, html: string): Promise<void> {
  const file = path.join(PATHS.debugDir, `${externalId}.html`);
  await ensureDir(file);
  await fs.writeFile(file, html, "utf-8");
}

/* ───────── checkpoint / resume ───────── */

interface State {
  /** externalId → RawMagnitProduct — уже скачанные карточки. */
  details: Record<string, RawMagnitProduct>;
}

export async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(PATHS.stateJson, "utf-8");
    const parsed = JSON.parse(raw) as State;
    if (parsed && typeof parsed.details === "object") return parsed;
  } catch {
    /* нет checkpoint'а — ок */
  }
  return { details: {} };
}

/** Сохранение checkpoint'а — вызывается после КАЖДОГО товара. */
export async function flushState(state: State): Promise<void> {
  await saveJson(PATHS.stateJson, state);
}

export type { State };
