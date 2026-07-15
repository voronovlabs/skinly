/**
 * HTTP fetcher: native fetch + глобальный rate-limit + retry с
 * exponential backoff. Паттерн — scripts/national-catalog/fetcher.ts,
 * плюс джиттер и обработка 403 (мягкий увеличенный backoff, т.к. это
 * может быть временная защита от ботов).
 */

import {
  BASE_BACKOFF_MS,
  FETCH_TIMEOUT_MS,
  JITTER_MS,
  MAX_RETRIES,
  MIN_INTERVAL_BETWEEN_REQUESTS_MS,
  REQUEST_HEADERS,
} from "./config";
import { ts } from "./logger";

let lastRequestAt = 0;
/** Промис-цепочка сериализует выдачу «слотов» между конкурентными воркерами. */
let rateGate: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot(): Promise<void> {
  const prev = rateGate;
  let release!: () => void;
  rateGate = new Promise((r) => (release = r));
  await prev;
  const jitter = Math.floor(Math.random() * JITTER_MS);
  const wait = lastRequestAt + MIN_INTERVAL_BETWEEN_REQUESTS_MS + jitter - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  release();
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Текстовый запрос с retry. Ретраим 429 / 403 / 5xx / timeout / network,
 * остальные 4xx — фатал сразу (ретрай не поможет).
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await acquireSlot();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { ...REQUEST_HEADERS, ...opts.headers },
        body: opts.body,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        throw new FetchError(`HTTP ${res.status}`, url, res.status);
      }
      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status} ${res.statusText}`, url, res.status);
      }
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;

      const isAbort = (e as { name?: string })?.name === "AbortError";
      const status =
        e instanceof FetchError ? e.status : isAbort ? "timeout" : "network";

      // 4xx кроме 429/403 — не ретраим
      if (
        e instanceof FetchError &&
        e.status !== undefined &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 429 &&
        e.status !== 403
      ) {
        throw e;
      }

      if (attempt < MAX_RETRIES - 1) {
        // 429/403 — ждём дольше обычного
        const factor = status === 429 || status === 403 ? 3 : 1;
        const backoff = BASE_BACKOFF_MS * factor * Math.pow(2, attempt);
        ts(`fetch: ${url} fail (${status}), retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new FetchError(`failed after ${MAX_RETRIES} attempts`, url);
}

// ПРИМЕЧАНИЕ: этот HTTP-fetcher больше НЕ используется для карточек —
// сайт за QRATOR блокирует HTTP-клиенты (423/403). Транспорт карточек —
// браузерная сессия (см. browser.ts). Модуль остаётся только для
// экспериментального api.ts (web-gateway).
