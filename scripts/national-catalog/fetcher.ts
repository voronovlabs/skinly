/**
 * HTTP fetcher с rate-limit, retries и exponential backoff.
 *
 * Использует native Node 18+ fetch — никаких axios/got.
 */

import {
  BASE_BACKOFF_MS,
  FETCH_TIMEOUT_MS,
  MAX_RETRIES,
  MIN_INTERVAL_BETWEEN_REQUESTS_MS,
  REQUEST_HEADERS,
} from "./config";

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_BETWEEN_REQUESTS_MS) {
    await sleep(MIN_INTERVAL_BETWEEN_REQUESTS_MS - elapsed);
  }
  lastRequestAt = Date.now();
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

/**
 * Скачивает HTML страницу. На 429/5xx/timeouts делает до MAX_RETRIES повторов
 * с экспоненциальной задержкой. На 4xx (кроме 429) — фатал, не ретраим.
 */
export async function fetchHtml(
  url: string,
  log: (msg: string) => void,
): Promise<string> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await rateLimit();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timer);

      if (res.status === 429) {
        throw new FetchError(`HTTP 429 Too Many Requests`, url, 429);
      }
      if (res.status >= 500) {
        throw new FetchError(`HTTP ${res.status} server error`, url, res.status);
      }
      if (!res.ok) {
        // 4xx (кроме 429) — обычно невалидный URL, ретрай не поможет.
        throw new FetchError(
          `HTTP ${res.status} ${res.statusText}`,
          url,
          res.status,
        );
      }

      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;

      const isAbort = (e as { name?: string })?.name === "AbortError";
      const status =
        e instanceof FetchError ? e.status : isAbort ? "timeout" : "network";

      // 4xx (кроме 429) — не ретраим
      if (
        e instanceof FetchError &&
        e.status &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 429
      ) {
        throw e;
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        log(
          `[fetcher] ${url} fail (status=${status}), retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new FetchError(`Failed after ${MAX_RETRIES} attempts`, url);
}
