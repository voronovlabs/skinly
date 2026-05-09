import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { getBeautyProfileByUserId } from "@/lib/db/repositories/beauty-profile";
import { listScansByUser } from "@/lib/db/repositories/scan-history";
import { dbScanToScanRecord } from "@/lib/db/display";
import type { SkinProfileSummary } from "@/components/profile/skin-profile-card";
import type { ScanRecord } from "@/lib/types";
import { DashboardContent } from "./dashboard-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    // guest — клиент работает только с demo store
    return <DashboardContent mode="guest" />;
  }

  let serverScans: ScanRecord[] = [];
  let serverProfile: SkinProfileSummary | null = null;
  try {
    const [scans, profile] = await Promise.all([
      listScansByUser(user.id, { limit: RECENT_LIMIT }),
      getBeautyProfileByUserId(user.id),
    ]);
    serverScans = scans.map(dbScanToScanRecord);
    serverProfile = profile
      ? {
          skinType: profile.skinType.toLowerCase(),
          sensitivity: profile.sensitivity.toLowerCase(),
          concerns: profile.concerns.map((c) => c.toLowerCase()),
          avoidedList: profile.avoidedList.map((a) => a.toLowerCase()),
          goal: profile.goal.toLowerCase(),
          completion: profile.completion,
        }
      : null;
  } catch (e) {
    console.error("[dashboard/page] DB load failed:", e);
    // fallback в guest-режим клиента
    return <DashboardContent mode="guest" />;
  }

  return (
    <DashboardContent
      mode="user"
      serverScans={serverScans}
      serverProfile={serverProfile}
      greetingName={user.name}
    />
  );
}
