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
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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

/**
 * Коды ошибок API. Совпадают с mobile `ApiErrorBody["error"]["code"]`
 * (минус `network_error`, который чисто клиентский). Union только расширен —
 * прежние коды (`validation` / `not_found` / `server_error` / `rate_limited`)
 * на месте, существующие вызовы не ломаются.
 */
export type ApiErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server_error";

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  fields?: Record<string, string>,
): NextResponse {
  const res = NextResponse.json(
    { error: fields ? { code, message, fields } : { code, message } },
    { status },
  );
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/* ───────── Convenience helpers ─────────
 * Тонкие обёртки над apiError с правильным HTTP-статусом. apiError /
 * apiJson / apiPreflight не тронуты.
 */

export function unauthorized(message = "Unauthorized"): NextResponse {
  return apiError("unauthorized", message, 401);
}

export function validation(
  message = "Validation failed",
  fields?: Record<string, string>,
): NextResponse {
  return apiError("validation", message, 422, fields);
}

export function conflict(message = "Conflict"): NextResponse {
  return apiError("conflict", message, 409);
}

export function notFound(message = "Not found"): NextResponse {
  return apiError("not_found", message, 404);
}

export function serverError(message = "Internal server error"): NextResponse {
  return apiError("server_error", message, 500);
}

/** Pre-flight для браузерных клиентов. */
export function apiPreflight(): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}
