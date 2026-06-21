import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * UserProductEvent repository (Step 3 персонализации).
 *
 * Запись поведенческих событий + дедуп-проверка для «дешёвых» событий
 * (view/open/scan). Subject — userId ИЛИ anonymousId (валидируется в API).
 */

export interface RecordEventInput {
  userId: string | null;
  anonymousId: string | null;
  barcode: string;
  eventType: string;
  weight: number;
  source: string | null;
  metadata: Record<string, unknown> | null;
}

/** Subject-фильтр: по userId, если он есть, иначе по anonymousId. */
function subjectWhere(
  userId: string | null,
  anonymousId: string | null,
): Prisma.UserProductEventWhereInput {
  return userId ? { userId } : { anonymousId };
}

/** Последнее событие того же subject+barcode+eventType за окно `sinceMs`. */
export async function findRecentEvent(params: {
  userId: string | null;
  anonymousId: string | null;
  barcode: string;
  eventType: string;
  sinceMs: number;
}): Promise<{ id: string } | null> {
  const since = new Date(Date.now() - params.sinceMs);
  return prisma.userProductEvent.findFirst({
    where: {
      ...subjectWhere(params.userId, params.anonymousId),
      barcode: params.barcode,
      eventType: params.eventType,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

export async function createEvent(
  input: RecordEventInput,
): Promise<{ id: string }> {
  return prisma.userProductEvent.create({
    data: {
      userId: input.userId,
      anonymousId: input.anonymousId,
      barcode: input.barcode,
      eventType: input.eventType,
      weight: input.weight,
      source: input.source,
      metadata:
        input.metadata === null
          ? Prisma.JsonNull
          : (input.metadata as Prisma.InputJsonValue),
    },
    select: { id: true },
  });
}
