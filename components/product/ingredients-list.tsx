"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui";
import { useDemoStore } from "@/lib/demo-store";
import {
  evaluateCompatibility,
  demoProfileToEngine,
  summaryProfileToEngine,
  type IngredientFact,
  type IngredientSafety,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import {
  safetyToBorderClass,
  safetyToDotClass,
  safetyToTagTone,
} from "./compatibility-section";

/**
 * IngredientsList — клиент.
 *
 * Получает «сырые» facts (INCI + position) + опц. серверный display name,
 * и подсвечивает каждый ингредиент по результату compatibility-engine.
 *
 * Когда профиля нет — рендерит ingredient'ы нейтральным safety, без бейджа.
 */

export interface IngredientsListItem {
  /** Уникальный id записи (productIngredient pk или mock-ingredient id). */
  id: string;
  inci: string;
  position: number;
  /** Локализованное отображаемое имя (если уже выбрано на сервере). */
  displayName?: string;
  /** Локализованное описание (если есть на сервере). */
  description?: string;
}

export interface IngredientsListProps {
  mode: "user" | "guest";
  items: ReadonlyArray<IngredientsListItem>;
  /** facts должны соответствовать items 1:1 по индексу. */
  facts: ReadonlyArray<IngredientFact>;
  serverProfile?: SkinProfileSummaryLike | null;
  className?: string;
}

export function IngredientsList({
  mode,
  items,
  facts,
  serverProfile,
  className,
}: IngredientsListProps) {
  const tRaw = useTranslations("compatibility");
  const t = tRaw as unknown as (key: string) => string;
  const { state, hydrated } = useDemoStore();

  const profile = useMemo(() => {
    if (mode === "user") return summaryProfileToEngine(serverProfile);
    return demoProfileToEngine(state.skinProfile);
  }, [mode, serverProfile, state.skinProfile]);

  const ready = mode === "user" || hydrated;

  // Считаем findings ровно один раз per (profile, facts).
  const findings = useMemo(() => {
    if (!ready) return null;
    return evaluateCompatibility(profile, facts).ingredientFindings;
  }, [ready, profile, facts]);

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, i) => {
        const finding = findings?.[i];
        const safety: IngredientSafety = finding?.evaluatedSafety ?? "neutral";
        const tagTone = safetyToTagTone(safety);
        const labelKey = finding?.shortLabelKey;
        const label = labelKey
          ? t(labelKey.replace(/^compatibility\./, ""))
          : null;

        return (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-3 rounded-md bg-pure-white p-4",
              "border-l-[3px]",
              safetyToBorderClass(safety),
            )}
          >
            <span
              className={cn(
                "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                safetyToDotClass(safety),
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-body font-semibold text-graphite truncate">
                  {item.displayName ?? item.inci}
                </span>
                {label && safety !== "neutral" && (
                  <Tag tone={tagTone}>{label}</Tag>
                )}
              </div>
              {item.description && (
                <p className="text-body-sm text-muted-graphite">
                  {item.description}
                </p>
              )}
              <p className="text-caption text-light-graphite mt-1">
                #{item.position} · {item.inci}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
