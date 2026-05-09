import { prisma } from "@/lib/prisma";

/**
 * ScanHistory repository.
 * Каждый просмотр продукта (через сканер ИЛИ через клик на карточку) =
 * одна запись. Дедуп 30 секунд (как в demo store) делается на стороне
 * server action, не в репо — репо просто insert'ит.
 */

export async function listScansByUser(
  userId: string,
  opts: { limit?: number } = {},
) {
  return prisma.scanHistory.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { scannedAt: "desc" },
    take: opts.limit,
  });
}

export async function recordScan(
  userId: string,
  productId: string,
  matchScore = 0,
): Promise<void> {
  await prisma.scanHistory.create({
    data: { userId, productId, matchScore },
  });
}

/** Последний скан этого продукта пользователем — для дедупа. */
export async function getLastScan(userId: string, productId: string) {
  return prisma.scanHistory.findFirst({
    where: { userId, productId },
    orderBy: { scannedAt: "desc" },
  });
}

export async function countDistinctProductsByUser(
  userId: string,
): Promise<number> {
  const rows = await prisma.scanHistory.findMany({
    where: { userId },
    select: { productId: true },
    distinct: ["productId"],
  });
  return rows.length;
}

export async function countScansByUser(userId: string): Promise<number> {
  return prisma.scanHistory.count({ where: { userId } });
}

/** Среднее matchScore по уникальным продуктам. */
export async function averageMatchScoreByUser(
  userId: string,
): Promise<number> {
  // Берём по одной записи на product (последнюю), затем усредняем matchScore.
  // Для MVP simple — group by productId on application layer.
  const rows = await prisma.scanHistory.findMany({
    where: { userId },
    select: { productId: true, matchScore: true, scannedAt: true },
    orderBy: { scannedAt: "desc" },
  });
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!seen.has(r.productId)) seen.set(r.productId, r.matchScore);
  }
  const scores = [...seen.values()].filter((s) => s > 0);
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
