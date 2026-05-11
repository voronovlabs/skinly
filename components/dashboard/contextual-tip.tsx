"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDemoStore } from "@/lib/demo-store";
import {
  cacheWeather,
  fetchWeatherSnapshot,
  greetingPart,
  pickRecommendation,
  readCachedWeather,
  requestGeolocation,
  type ContextualProfile,
  type RecommendationDef,
  type WeatherSnapshot,
} from "@/lib/contextual";
import type { SkinProfileSummary } from "@/components/profile/skin-profile-card";

/**
 * ContextualTip — небольшой premium-tip над scan-card.
 *
 * Mobile-first и graceful по всем измерениям:
 *   - SSR: сразу рендерим базовый «welcome» tip (нет hydration mismatch).
 *   - Client mount:
 *       1) подменяем tip на time/profile-based (без запроса геолокации);
 *       2) пробуем cached weather → если есть, обновляем tip;
 *       3) спрашиваем geolocation; если разрешено — fetch + cache + update.
 *   - Любая ошибка (denied / fail / network) → остаёмся на time/profile tip.
 *
 * Заменяет старый `dashboard.weatherTip` — но визуально остаётся в той же
 * premium-peach зоне, чтобы header не «прыгал».
 */

export interface ContextualTipProps {
  mode: "user" | "guest";
  serverProfile?: SkinProfileSummary | null;
}

export function ContextualTip({ mode, serverProfile }: ContextualTipProps) {
  const t = useTranslations() as unknown as (
    key: string,
    args?: Record<string, string | number>,
  ) => string;
  const { state, hydrated } = useDemoStore();
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [mounted, setMounted] = useState(false);
  const askedGeo = useRef(false);

  const profile = useMemo<ContextualProfile>(() => {
    if (mode === "user") {
      return toContextualProfile(serverProfile);
    }
    return toContextualProfile(state.skinProfile);
  }, [mode, serverProfile, state.skinProfile]);

  /* ── Weather pipeline ── */
  useEffect(() => {
    if (mode === "guest" && !hydrated) return;
    setMounted(true);

    // 1. Прочитать кэш — мгновенно.
    const cached = readCachedWeather();
    if (cached) setWeather(cached);

    // 2. Запросить geolocation один раз. На отказ — тихо живём без погоды.
    if (askedGeo.current) return;
    askedGeo.current = true;

    void (async () => {
      const coords = await requestGeolocation();
      if (!coords) return;
      const snap = await fetchWeatherSnapshot(coords);
      if (!snap) return;
      cacheWeather(snap);
      setWeather(snap);
    })();
  }, [mode, hydrated]);

  /* ── Рекомендация ── */
  const rec = useMemo<RecommendationDef>(() => {
    // На SSR / pre-hydration — нейтральный welcome.
    if (!mounted) {
      return {
        id: "welcome",
        key: "dashboard.tips.welcome",
        icon: "💡",
        priority: 0,
      };
    }
    return pickRecommendation({
      dayPart: greetingPart(),
      weather,
      profile,
    });
  }, [mounted, weather, profile]);

  return (
    <div
      className="
        inline-flex max-w-full items-start gap-2 rounded-full
        bg-premium-peach/80 px-3 py-1.5 text-graphite
        text-[12px] leading-snug
      "
      role="status"
      aria-live="polite"
    >
      <span aria-hidden className="text-[14px] leading-none">
        {rec.icon}
      </span>
      <span className="font-medium">{t(rec.key, rec.args)}</span>
    </div>
  );
}

/* ───────── helpers ───────── */

function toContextualProfile(
  p: SkinProfileSummary | { skinType: string | null; sensitivity: string | null; concerns: string[]; avoidedList: string[]; goal: string | null } | null | undefined,
): ContextualProfile {
  if (!p) {
    return {
      skinType: null,
      sensitivity: null,
      concerns: [],
      avoidedList: [],
      goal: null,
    };
  }
  return {
    skinType: (p.skinType ?? null) as ContextualProfile["skinType"],
    sensitivity: (p.sensitivity ?? null) as ContextualProfile["sensitivity"],
    concerns: (p.concerns ?? []) as ContextualProfile["concerns"],
    avoidedList: (p.avoidedList ?? []) as ContextualProfile["avoidedList"],
    goal: (p.goal ?? null) as ContextualProfile["goal"],
  };
}
