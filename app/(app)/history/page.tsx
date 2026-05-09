import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listFavoriteProductIdsByUser,
} from "@/lib/db/repositories/favorite";
import { listScansByUser } from "@/lib/db/repositories/scan-history";
import { dbScanToScanRecord } from "@/lib/db/display";
import type { ScanRecord } from "@/lib/types";
import { HistoryContent } from "./history-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("history");
  return { title: t("metaTitle") };
}

const HISTORY_LIMIT = 200;

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <HistoryContent mode="guest" />;
  }

  let serverScans: ScanRecord[] = [];
  let serverFavoriteIds: string[] = [];
  try {
    const [scans, favIds] = await Promise.all([
      listScansByUser(user.id, { limit: HISTORY_LIMIT }),
      listFavoriteProductIdsByUser(user.id),
    ]);
    serverScans = scans.map(dbScanToScanRecord);
    serverFavoriteIds = favIds;
  } catch (e) {
    console.error("[history/page] DB load failed:", e);
    return <HistoryContent mode="guest" />;
  }

  return (
    <HistoryContent
      mode="user"
      serverScans={serverScans}
      serverFavoriteIds={serverFavoriteIds}
    />
  );
}
