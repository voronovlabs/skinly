import type {
  AvoidedIngredient,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Migration repository: guest demo state → user БД.
 *
 * Правила (см. Phase 11):
 *   - BeautyProfile: импортим только если у user'а профиля нет ИЛИ completion=0.
 *     Заполненный профиль user'а никогда не затирается.
 *   - Favorites: skipDuplicates по (userId, productId). FK к Product
 *     валидируется заранее — невалидные id'шники просто отбрасываются.
 *   - ScanHistory: skipDuplicates по точному (productId + scannedAt sec).
 *     FK тоже валидируется заранее.
 *   - Locale: переносим только если у user'а локаль = дефолт ("ru" или null).
 *
 * Идемпотентно: повторный запуск даёт нули в стат-ах.
 */

export interface GuestProfilePayload {
  skinType: SkinType;
  sensitivity: SensitivityLevel;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal;
  completion: number;
}

export interface GuestScanPayload {
  productId: string;
  /** UNIX ms (как в demo store). */
  scannedAt: number;
}

export interface GuestStatePayload {
  /** Профиль кожи, ИЛИ null если гость не заполнял анкету. */
  skinProfile: GuestProfilePayload | null;
  favoriteIds: string[];
  scans: GuestScanPayload[];
  /** Текущая локаль гостя (cookie value). */
  locale: "ru" | "en" | null;
}

export type BeautyProfileMigrationStatus =
  | "imported"
  | "skipped_existing"
  | "skipped_empty";

export interface MigrationStats {
  beautyProfile: BeautyProfileMigrationStatus;
  favoritesAdded: number;
  favoritesSkippedExisting: number;
  favoritesSkippedInvalidProduct: number;
  scansAdded: number;
  scansSkippedExisting: number;
  scansSkippedInvalidProduct: number;
  localeUpdated: boolean;
}

export async function migrateGuestStateToUser(
  userId: string,
  payload: GuestStatePayload,
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    beautyProfile: "skipped_empty",
    favoritesAdded: 0,
    favoritesSkippedExisting: 0,
    favoritesSkippedInvalidProduct: 0,
    scansAdded: 0,
    scansSkippedExisting: 0,
    scansSkippedInvalidProduct: 0,
    localeUpdated: false,
  };

  /* ── 1) BeautyProfile ─────────────────────────────────── */

  if (
    payload.skinProfile &&
    payload.skinProfile.completion > 0 &&
    payload.skinProfile.skinType &&
    payload.skinProfile.sensitivity &&
    payload.skinProfile.goal
  ) {
    const existing = await prisma.beautyProfile.findUnique({
      where: { userId },
      select: { completion: true },
    });
    if (!existing || existing.completion === 0) {
      await prisma.beautyProfile.upsert({
        where: { userId },
        create: { userId, ...payload.skinProfile },
        update: { ...payload.skinProfile },
      });
      stats.beautyProfile = "imported";
    } else {
      stats.beautyProfile = "skipped_existing";
    }
  }

  /* ── 2) Favorites ─────────────────────────────────────── */

  const incomingFavIds = Array.from(new Set(payload.favoriteIds));
  if (incomingFavIds.length > 0) {
    const validProducts = await prisma.product.findMany({
      where: { id: { in: incomingFavIds } },
      select: { id: true },
    });
    const validIds = new Set(validProducts.map((p) => p.id));
    stats.favoritesSkippedInvalidProduct =
      incomingFavIds.length - validIds.size;

    if (validIds.size > 0) {
      const existing = await prisma.favorite.findMany({
        where: { userId, productId: { in: [...validIds] } },
        select: { productId: true },
      });
      const existingSet = new Set(existing.map((e) => e.productId));
      stats.favoritesSkippedExisting = existingSet.size;

      const toInsert = [...validIds]
        .filter((id) => !existingSet.has(id))
        .map((productId) => ({ userId, productId }));

      if (toInsert.length > 0) {
        const result = await prisma.favorite.createMany({
          data: toInsert,
          skipDuplicates: true,
        });
        stats.favoritesAdded = result.count;
      }
    }
  }

  /* ── 3) ScanHistory ───────────────────────────────────── */

  if (payload.scans.length > 0) {
    const productIds = Array.from(new Set(payload.scans.map((s) => s.productId)));
    const validProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    const validIds = new Set(validProducts.map((p) => p.id));
    stats.scansSkippedInvalidProduct = payload.scans.filter(
      (s) => !validIds.has(s.productId),
    ).length;

    const validScans = payload.scans.filter((s) => validIds.has(s.productId));

    if (validScans.length > 0) {
      const existing = await prisma.scanHistory.findMany({
        where: { userId, productId: { in: [...validIds] } },
        select: { productId: true, scannedAt: true },
      });
      const existingKey = (productId: string, ms: number) =>
        `${productId}_${Math.floor(ms / 1000)}`;
      const existingSet = new Set(
        existing.map((e) => existingKey(e.productId, e.scannedAt.getTime())),
      );

      const toInsert = validScans.filter(
        (s) => !existingSet.has(existingKey(s.productId, s.scannedAt)),
      );

      stats.scansSkippedExisting = validScans.length - toInsert.length;

      if (toInsert.length > 0) {
        const result = await prisma.scanHistory.createMany({
          data: toInsert.map((s) => ({
            userId,
            productId: s.productId,
            scannedAt: new Date(s.scannedAt),
            matchScore: 0,
          })),
        });
        stats.scansAdded = result.count;
      }
    }
  }

  /* ── 4) Locale ────────────────────────────────────────── */

  if (payload.locale && payload.locale !== "ru") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    if (user && (!user.locale || user.locale === "ru")) {
      await prisma.user.update({
        where: { id: userId },
        data: { locale: payload.locale },
      });
      stats.localeUpdated = true;
    }
  }

  return stats;
}
