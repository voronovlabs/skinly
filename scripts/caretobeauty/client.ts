/**
 * Care to Beauty HTTP-клиент: rate-limit + retry + timeout, native fetch.
 * Умеет тянуть текст (HTML) и распаковывать gzip-sitemap (.xml.gz).
 */

import { gunzipSync } from "node:zlib";
import {
  BASE_BACKOFF_MS,
  FETCH_TIMEOUT_MS,
  JITTER_MS,
  MAX_RETRIES,
  MIN_INTERVAL_MS,
  REQUEST_HEADERS,
} from "./config";

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimit(): Promise<void> {
  const wait = MIN_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
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

async function fetchRaw(
  url: string,
  log: (m: string) => void,
): Promise<ArrayBuffer> {
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
      if (res.status === 404) {
        throw new FetchError("HTTP 404", url, 404);
      }
      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status} ${res.statusText}`, url, res.status);
      }
      return await res.arrayBuffer();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // 404 — не ретраим (нет такого sitemap-куска / товара).
      if (e instanceof FetchError && e.status === 404) throw e;
      if (attempt < MAX_RETRIES - 1) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        log(`[c2b] ${url} fail (${errMsg(e)}), retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new FetchError("fetch failed", url);
}

export async function fetchHtml(url: string, log: (m: string) => void): Promise<string> {
  const buf = await fetchRaw(url, log);
  return Buffer.from(buf).toString("utf8");
}

/**
 * Тянет gzip-sitemap и распаковывает. Если сервер уже отдал распакованное
 * (Content-Encoding: gzip → undici сам разжал), gunzip кинет ошибку —
 * тогда трактуем буфер как готовый XML.
 */
export async function fetchSitemapXml(
  url: string,
  log: (m: string) => void,
): Promise<string> {
  const buf = Buffer.from(await fetchRaw(url, log));
  try {
    return gunzipSync(buf).toString("utf8");
  } catch {
    return buf.toString("utf8");
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
