import { NextResponse } from "next/server";

/**
 * Хелперы для публичного read-only REST API (`/api/v1/*`), которое потребляет
 * mobile-приложение (Expo).
 *
 * Web-сайт сам по себе использует Server Actions + Prisma напрямую — этот API
 * существует ТОЛЬКО как контракт для внешних клиентов (mobile). Поэтому:
 *   - отдаём JSON c permissive CORS (нативный клиент CORS не проверяет, но
 *     Expo Web / браузерный dev — да);
 *   - кешируем list/detail на CDN-edge короткое время (s-maxage), чтобы 62k
 *     каталог не бил в Postgres на каждый скролл.
 */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,accept,accept-language,content-type",
};

export interface JsonOptions {
  status?: number;
  /** Значение Cache-Control. По умолчанию — короткий edge-cache для GET. */
  cache?: string;
}

const DEFAULT_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export function apiJson<T>(data: T, opts: JsonOptions = {}): NextResponse {
  const res = NextResponse.json(data, { status: opts.status ?? 200 });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  res.headers.set("Cache-Control", opts.cache ?? DEFAULT_CACHE);
  return res;
}

export function apiError(
  code:
    | "validation"
    | "not_found"
    | "server_error"
    | "rate_limited",
  message: string,
  status: number,
): NextResponse {
  const res = NextResponse.json({ error: { code, message } }, { status });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Pre-flight для браузерных клиентов. */
export function apiPreflight(): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}
