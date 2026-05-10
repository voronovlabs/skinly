"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Tag } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";
import {
  evaluateCompatibility,
  demoProfileToEngine,
  inciToFact,
  summaryProfileToEngine,
  type IngredientFact,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";

/**
 * LiveMatchBadge — клиентский бейдж совместимости, считающий score «вживую».
 *
 * Используется на карточках, где нет server-side score-snapshot:
 *   - mock recommendations на dashboard
 *   - favorites grid (cards без ingredients-load на сервере)
 *
 * Если профиль пуст или engine отдал lowConfidence — бейдж не рендерится.
 *
 * Если на карточке нет ингредиентов (например, у DB-продукта без ingredients
 * relation, мы передаём пустой array) — бейдж не рендерится.
 */

export interface LiveMatchBadgeProps {
  /** mode определяет источник профиля. */
  mode: "user" | "guest";
  /** INCI-токены продукта (плюс позиции, опц). */
  inciList: ReadonlyArray<{ inci: string; position?: number }>;
  /** Если mode=user, серверный профиль. Иначе игнорируется. */
  serverProfile?: SkinProfileSummaryLike | null;
  /** Тон бейджа можно подсказать снаружи (по умолчанию success). */
  className?: string;
}

export function LiveMatchBadge({
  mode,
  inciList,
  serverProfile,
  className,
}: LiveMatchBadgeProps) {
  const t = useTranslations("product");
  const { state, hydrated } = useDemoStore();

  const profile = useMemo(() => {
    if (mode === "user") return summaryProfileToEngine(serverProfile);
    return demoProfileToEngine(state.skinProfile);
  }, [mode, serverProfile, state.skinProfile]);

  const ready = mode === "user" || hydrated;

  const result = useMemo(() => {
    if (!ready) return null;
    if (inciList.length === 0) return null;
    const facts: IngredientFact[] = inciList.map((x, i) =>
      inciToFact(x.inci, x.position ?? i + 1),
    );
    return evaluateCompatibility(profile, facts);
  }, [ready, profile, inciList]);

  if (!result || result.score === 0 || result.lowConfidence) return null;

  const tone =
    result.verdict === "excellent" || result.verdict === "good"
      ? "success"
      : result.verdict === "mixed"
        ? "warning"
        : "danger";

  return (
    <Tag tone={tone} className={cn(className)}>
      {result.score}% {t("match")}
    </Tag>
  );
}
