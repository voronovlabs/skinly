import type { NextRequest } from "next/server";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import {
  createEvent,
  findRecentEvent,
} from "@/lib/db/repositories/user-product-event";
import { apiError, apiJson, apiPreflight, serverError, validation } from "@/lib/api/respond";

/**
 * POST /api/v1/events — единый лог поведенческих событий (Step 3).
 *
 * Subject:
 *   - Bearer access-token → userId (logged-in);
 *   - иначе header `X-Anon-Id` → anonymousId (guest/mobile deviceId);
 *   - нет ни того, ни другого → 400.
 *
 * Body: { barcode, eventType, source?, metadata? }
 * Weight проставляется сервером по eventType (клиент его не задаёт).
 * Dedup (30с) для view/open/scan по subject+barcode+eventType.
 *
 * НЕ трогает recommendations / mobile / web UI.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

/** Серверный источник правды для веса события. */
const EVENT_WEIGHTS: Record<string, number> = {
  view: 1,
  open: 1,
  scan: 2,
  favorite: 3,
  like: 3,
  unfavorite: -2,
  dislike: -3,
  dismiss: -1,
  open_recommendation: 2,
};

const DEDUP_TYPES = new Set(["view", "open", "scan"]);
const DEDUP_WINDOW_MS = 30_000;
const SOURCES = new Set(["web", "mobile", "scan", "reco"]);
const MAX_BARCODE_LEN = 64;
const MAX_METADATA_CHARS = 5000;

export async function POST(req: NextRequest) {
  // ── Subject ──
  const session = await getSessionFromAuthorizationHeader(req);
  const userId = session?.type === "user" ? session.userId : null;
  const anonymousId = userId
    ? null
    : req.headers.get("x-anon-id")?.trim() || null;

  if (!userId && !anonymousId) {
    return apiError(
      "validation",
      "Missing subject: provide Bearer token or X-Anon-Id header",
      400,
    );
  }

  // ── Body ──
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validation("Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // barcode: required; принимаем и нестандартные id (не только 8–14 цифр),
  // лишь ограничиваем длину, чтобы не ломать существующие ключи.
  const barcode = typeof b.barcode === "string" ? b.barcode.trim() : "";
  if (!barcode || barcode.length > MAX_BARCODE_LEN) {
    return validation("barcode is required");
  }

  const eventType = typeof b.eventType === "string" ? b.eventType : "";
  const weight = EVENT_WEIGHTS[eventType];
  if (weight === undefined) {
    return validation("Invalid eventType");
  }

  let source: string | null = null;
  if (b.source != null) {
    if (typeof b.source !== "string" || !SOURCES.has(b.source)) {
      return validation("Invalid source");
    }
    source = b.source;
  }

  let metadata: Record<string, unknown> | null = null;
  if (b.metadata != null) {
    if (typeof b.metadata !== "object" || Array.isArray(b.metadata)) {
      return validation("metadata must be an object");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(b.metadata);
    } catch {
      return validation("metadata is not serializable");
    }
    if (serialized.length > MAX_METADATA_CHARS) {
      return validation("metadata too large");
    }
    metadata = b.metadata as Record<string, unknown>;
  }

  try {
    // Dedup для дешёвых событий.
    if (DEDUP_TYPES.has(eventType)) {
      const recent = await findRecentEvent({
        userId,
        anonymousId,
        barcode,
        eventType,
        sinceMs: DEDUP_WINDOW_MS,
      });
      if (recent) {
        return apiJson({ ok: true, deduped: true }, { cache: "no-store" });
      }
    }

    const { id } = await createEvent({
      userId,
      anonymousId,
      barcode,
      eventType,
      weight,
      source,
      metadata,
    });
    return apiJson({ ok: true, eventId: id, deduped: false }, { cache: "no-store" });
  } catch (e) {
    console.error("[api/v1/events] POST failed:", e);
    return serverError();
  }
}
