"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { StatCard } from "./stat-card";
import { computeDemoStats, useDemoStore } from "@/lib/demo-store";

/**
 * StatsRow — три метрики на /profile.
 *
 * Phase 9: dual-mode:
 *   - если переданы `stats` (server-counted из ScanHistory) — берём их
 *   - иначе — считаем из demo store (как Phase 5)
 */

export interface StatsRowStats {
  scans: number;
  products: number;
  avgMatch: number;
}

export interface StatsRowProps {
  stats?: StatsRowStats;
}

export function StatsRow({ stats: serverStats }: StatsRowProps) {
  const t = useTranslations("profile");
  const { state } = useDemoStore();

  const fallback = useMemo(() => computeDemoStats(state), [state]);
  const stats = serverStats ?? fallback;

  return (
    <div className="flex gap-3">
      <StatCard value={stats.scans} label={t("stats.scans")} />
      <StatCard value={stats.products} label={t("stats.products")} />
      <StatCard
        value={stats.avgMatch === 0 ? "—" : `${stats.avgMatch}%`}
        label={t("stats.avgMatch")}
        tone="gold"
      />
    </div>
  );
}
