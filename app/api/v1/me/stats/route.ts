import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionFromAuthorizationHeader } from "@/lib/auth/bearer";
import { apiJson, apiPreflight, serverError, unauthorized } from "@/lib/api/respond";

/**
 * GET /api/v1/me/stats — метрики профиля (Bearer). Считаются on-the-fly.
 *
 *   scans    = count UserProductEvent (eventType='scan')
 *   products = distinct barcode по scan/favorite/open_recommendation
 *   avgMatch = средний matchScore из ScanHistory (если есть), иначе 0
 *
 * События читаем raw SQL (модель UserProductEvent — без зависимости от
 * сгенерированного клиента). ScanHistory — через Prisma aggregate.
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromAuthorizationHeader(req);
  if (!session || session.type !== "user") {
    return unauthorized();
  }
  const userId = session.userId;

  try {
    const [scansRow] = await prisma.$queryRaw<{ scans: number }[]>(Prisma.sql`
      SELECT count(*)::int AS scans
      FROM "UserProductEvent"
      WHERE "userId" = ${userId} AND "eventType" = 'scan'
    `);
    const [productsRow] = await prisma.$queryRaw<{ products: number }[]>(Prisma.sql`
      SELECT count(DISTINCT barcode)::int AS products
      FROM "UserProductEvent"
      WHERE "userId" = ${userId}
        AND "eventType" IN ('scan', 'favorite', 'open_recommendation')
    `);

    const agg = await prisma.scanHistory.aggregate({
      where: { userId, matchScore: { gt: 0 } },
      _avg: { matchScore: true },
    });

    return apiJson(
      {
        scans: scansRow?.scans ?? 0,
        products: productsRow?.products ?? 0,
        avgMatch: Math.round(agg._avg.matchScore ?? 0),
      },
      { cache: "no-store" },
    );
  } catch (e) {
    console.error("[api/v1/me/stats] GET failed:", e);
    return serverError();
  }
}
