"use server";

import { Prisma } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import {
  getLastScan,
  recordScan,
} from "@/lib/db/repositories/scan-history";

/** 30 секунд — окно дедупа повторных просмотров одного и того же продукта. */
const DEDUPE_WINDOW_MS = 30_000;

/**
 * Записать скан/просмотр продукта. Симметричен demo-store `addScan`:
 *   - guest → no-op (demo store сам пишет в localStorage),
 *   - user  → INSERT в ScanHistory + дедуп 30 сек.
 *
 * `matchScore` — snapshot в момент скана. Пока compatibility-engine не готов
 * (Phase 10), ставим 0 по умолчанию.
 */
export async function recordScanAction(
  productId: string,
  matchScore = 0,
): Promise<
  | { ok: true; persisted: true; deduped: boolean }
  | { ok: true; persisted: false; reason: "guest" | "anonymous" }
  | { ok: false; reason: "db_unavailable" | "validation" }
> {
  if (!productId || typeof productId !== "string") {
    return { ok: false, reason: "validation" };
  }
  const session = await getCurrentSession();
  if (!session) return { ok: true, persisted: false, reason: "anonymous" };
  if (session.type !== "user") {
    return { ok: true, persisted: false, reason: "guest" };
  }

  try {
    const last = await getLastScan(session.userId, productId);
    if (last) {
      const ageMs = Date.now() - last.scannedAt.getTime();
      if (ageMs < DEDUPE_WINDOW_MS) {
        return { ok: true, persisted: true, deduped: true };
      }
    }
    await recordScan(session.userId, productId, matchScore);
    return { ok: true, persisted: true, deduped: false };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      return { ok: false, reason: "validation" };
    }
    console.error("[scans] record failed:", e);
    return { ok: false, reason: "db_unavailable" };
  }
}
