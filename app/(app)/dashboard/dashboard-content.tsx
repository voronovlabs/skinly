"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { Card, ProgressBar, Tag } from "@/components/ui";
import { ScreenContainer } from "@/components/layout";
import { ScanCard, SectionHeader } from "@/components/dashboard";
import { ProductCard, HistoryItem } from "@/components/product";
import { demoScansToScanRecords, useDemoStore } from "@/lib/demo-store";
import {
  MOCK_PRODUCTS,
  MOCK_RECOMMENDATION_IDS,
  MOCK_USER,
} from "@/lib/mock";
import type { ScanRecord } from "@/lib/types";
import type { SkinProfileSummary } from "@/components/profile/skin-profile-card";

/**
 * DashboardContent — клиент.
 *
 * Phase 9: dual-mode.
 *   - mode="user" → читает props (server-fetched из ScanHistory + BeautyProfile).
 *   - mode="guest" → читает demo store (Phase 5 — localStorage).
 *
 * Recommendations пока остаются мокаными — это маркетинговый блок
 * (Phase 10 заменит на персонализированные рекомендации из engine).
 */

const DASHBOARD_RECENT_LIMIT = 3;

export interface DashboardContentProps {
  mode: "user" | "guest";
  serverScans?: ScanRecord[];
  serverProfile?: SkinProfileSummary | null;
  greetingName?: string | null;
}

export function DashboardContent({
  mode,
  serverScans,
  serverProfile,
  greetingName,
}: DashboardContentProps) {
  const t = useTranslations("dashboard");
  const { state, hydrated } = useDemoStore();

  const recommendations = MOCK_PRODUCTS.filter((p) =>
    MOCK_RECOMMENDATION_IDS.includes(p.id),
  );

  // Источники данных
  const recent = useMemo<ScanRecord[]>(() => {
    if (mode === "user") return (serverScans ?? []).slice(0, DASHBOARD_RECENT_LIMIT);
    return demoScansToScanRecords(state.history).slice(0, DASHBOARD_RECENT_LIMIT);
  }, [mode, serverScans, state.history]);

  const profile = mode === "user" ? serverProfile : state.skinProfile;
  const hasProfile = Boolean(profile?.skinType);
  const completion = profile?.completion ?? 0;

  // Когда показывать empty state. Для user — серверные данные уже есть;
  // для guest — ждём гидратации demo store, чтобы не мигало.
  const ready = mode === "user" || hydrated;

  return (
    <ScreenContainer withBottomNav>
      <header className="px-6 pt-6 pb-2 bg-gradient-to-b from-warm-white to-transparent">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-caption text-muted-graphite">{t("greeting")}</p>
            <h1 className="text-h1 text-graphite mt-1">
              {greetingName ?? t("yourOverview")}
            </h1>
          </div>
          <Link
            href="/profile"
            aria-label={t("openProfile")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-soft-beige text-xl text-graphite"
          >
            {MOCK_USER.avatarEmoji}
          </Link>
        </div>
        <Tag tone="premium">💡 {t("weatherTip")}</Tag>
      </header>

      <div className="px-6 mt-4 mb-6">
        <ScanCard />
      </div>

      <SectionHeader
        title={t("recommendations")}
        actionHref="/favorites"
        actionLabel={t("seeAll")}
      />
      <div className="flex gap-4 overflow-x-auto px-6 pb-1 no-scrollbar">
        {recommendations.map((p) => (
          <ProductCard key={p.id} product={p} layout="fixed" />
        ))}
      </div>

      <SectionHeader
        title={t("recentScans")}
        actionHref="/history"
        actionLabel={t("historyLink")}
        className="mt-8"
      />
      <div className="px-6 space-y-3">
        {ready && recent.length === 0 && <RecentScansEmpty />}
        {recent.map((scan) => (
          <Card
            key={scan.id}
            interactive
            padding="default"
            className="!p-0 overflow-hidden"
          >
            <HistoryItem scan={scan} />
          </Card>
        ))}
      </div>

      <SectionHeader title={t("yourProfile")} className="mt-8" />
      <div className="px-6">
        <Card>
          {hasProfile ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-body-sm text-graphite">
                  {t("profileSummary")}
                </span>
                <Link
                  href="/onboarding"
                  className="text-body-sm font-medium text-lavender-deep hover:underline"
                >
                  {t("edit")}
                </Link>
              </div>
              <ProgressBar
                value={completion}
                aria-label={t("profileCompletion", { percent: completion })}
              />
              <p className="text-caption text-muted-graphite mt-2">
                {t("profileCompletion", { percent: completion })}
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-body-sm text-muted-graphite">
                {t("skinProfileEmpty")}
              </span>
              <Link
                href="/onboarding"
                className="text-body-sm font-medium text-lavender-deep hover:underline"
              >
                {t("skinProfileEmptyAction")}
              </Link>
            </div>
          )}
        </Card>
      </div>
    </ScreenContainer>
  );
}

function RecentScansEmpty() {
  const t = useTranslations("dashboard");
  return (
    <Card padding="default" className="text-center">
      <div
        aria-hidden
        className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-soft-lavender text-lavender-deep"
      >
        <Camera className="h-5 w-5" strokeWidth={2} />
      </div>
      <p className="text-body-sm text-graphite">{t("noScans")}</p>
      <p className="text-caption text-muted-graphite mt-1">{t("noScansHint")}</p>
    </Card>
  );
}
