"use server";

/**
 * Server action: миграция guest demo-state в БД user'а.
 *
 * Запускается клиентом `<GuestMigrator />` на mount после login/register
 * (или если user заходит с уже накопленным гостевым state'ом).
 *
 * Правила merge'а — см. `lib/db/repositories/migration.ts`. Action
 * только проверяет session и тонко оборачивает repo.
 */

import { getCurrentSession } from "@/lib/auth";
import {
  migrateGuestStateToUser,
  type GuestStatePayload,
  type MigrationStats,
} from "@/lib/db/repositories/migration";

export type MigrateGuestResult =
  | { ok: true; userId: string; stats: MigrationStats }
  | { ok: false; reason: "not_user" | "db_error" | "validation" };

function isValidPayload(p: unknown): p is GuestStatePayload {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  if (!Array.isArray(x.favoriteIds)) return false;
  if (!Array.isArray(x.scans)) return false;
  return true;
}

export async function migrateGuestToUserAction(
  payload: GuestStatePayload,
): Promise<MigrateGuestResult> {
  if (!isValidPayload(payload)) {
    return { ok: false, reason: "validation" };
  }

  const session = await getCurrentSession();
  if (!session || session.type !== "user") {
    return { ok: false, reason: "not_user" };
  }

  try {
    const stats = await migrateGuestStateToUser(session.userId, payload);
    console.log(
      `[migrate-guest] user=${session.userId} bp=${stats.beautyProfile} ` +
        `favs +${stats.favoritesAdded}/=${stats.favoritesSkippedExisting}/×${stats.favoritesSkippedInvalidProduct} ` +
        `scans +${stats.scansAdded}/=${stats.scansSkippedExisting}/×${stats.scansSkippedInvalidProduct} ` +
        `locale=${stats.localeUpdated}`,
    );
    return { ok: true, userId: session.userId, stats };
  } catch (e) {
    console.error("[migrate-guest] failed:", e);
    return { ok: false, reason: "db_error" };
  }
}
