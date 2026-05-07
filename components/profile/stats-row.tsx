"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { StatCard } from "./stat-card";
import { computeDemoStats, useDemoStore } from "@/lib/demo-store";

/**
 * StatsRow — три карточки статистики, считаются из demo store.
 *   - Сканов: длина history
 *   - Продуктов: уникальные productId в history
 *   - Средняя совместимость: среднее matchScore по уникальным продуктам
 */
export function StatsRow() {
  const t = useTranslations("profile");
  const { state } = useDemoStore();

  const stats = useMemo(() => computeDemoStats(state), [state]);

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
