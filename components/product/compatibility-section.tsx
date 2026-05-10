"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, type TagTone } from "@/components/ui";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";
import {
  evaluateCompatibility,
  demoProfileToEngine,
  summaryProfileToEngine,
  type CompatibilityResult,
  type CompatibilityRowStatus,
  type IngredientFact,
  type IngredientSafety,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import { VerdictCard } from "./verdict-card";
import { CompatibilityTable } from "./compatibility-table";
import type {
  CompatibilityRow,
  CompatibilityStatus,
  VerdictTone,
} from "@/lib/types";

/**
 * ProductCompatibilitySection — клиентский компонент.
 *
 * Принимает массив ingredient facts (INCI + position) уже подготовленный на
 * сервере (из БД или mock'а) и сам определяет profile:
 *   - mode="user"  → server передал serverProfile (нормализованный summary).
 *   - mode="guest" → читает demo store.
 *
 * Считает result локально через `evaluateCompatibility` (pure-функция).
 * Если профиль пуст → отображает CTA «Заполнить анкету», без VerdictCard.
 *
 * Поверх engine result рендерит:
 *   - VerdictCard (score + verdict subtitle)
 *   - CompatibilityTable (rows из engine)
 *   - reasons block (топ позитивов + топ предупреждений)
 *
 * Сами IngredientCard'ы рендерит вызывающая страница, но мы экспортируем
 * `mapFindingToSafety` чтобы страница могла подсветить ингредиенты по итогам
 * engine'а (см. ниже).
 */

type T = (key: string, args?: Record<string, string | number>) => string;

export interface ProductCompatibilitySectionProps {
  mode: "user" | "guest";
  /** Ингредиенты продукта (INCI + позиция). Сервер уже подготовил. */
  facts: ReadonlyArray<IngredientFact>;
  /** Только для mode=user; null = у user нет профиля. */
  serverProfile?: SkinProfileSummaryLike | null;
  className?: string;
}

export function ProductCompatibilitySection({
  mode,
  facts,
  serverProfile,
  className,
}: ProductCompatibilitySectionProps) {
  const tRaw = useTranslations("compatibility");
  // next-intl типизирует `t` сильно (узкие keys); внутренние helpers
  // принимают общую сигнатуру, поэтому кастуем один раз сверху.
  const t = tRaw as unknown as T;
  const tProduct = useTranslations("product");
  const { state, hydrated } = useDemoStore();

  const profile = useMemo(() => {
    if (mode === "user") return summaryProfileToEngine(serverProfile);
    return demoProfileToEngine(state.skinProfile);
  }, [mode, serverProfile, state.skinProfile]);

  const ready = mode === "user" || hydrated;

  const result = useMemo<CompatibilityResult | null>(() => {
    if (!ready) return null;
    return evaluateCompatibility(profile, facts);
  }, [ready, profile, facts]);

  if (!ready) {
    return (
      <Card className={cn("h-[140px]", className)} aria-busy>
        <span className="sr-only">{t("loading")}</span>
      </Card>
    );
  }

  // Профиль пуст или engine не смог посчитать → CTA «Заполнить анкету».
  if (!result || result.score === 0) {
    return (
      <Card className={cn("text-center", className)} padding="default">
        <p className="text-body-sm text-graphite mb-2">{t("noProfile")}</p>
        <a
          href="/onboarding"
          className="text-body-sm font-medium text-lavender-deep hover:underline"
        >
          {t("noProfileCta")}
        </a>
      </Card>
    );
  }

  const tone = verdictToTone(result.verdict);

  // Subtitle для VerdictCard: первая reason (если есть).
  const subtitle =
    result.reasons.length > 0
      ? formatReason(t, result.reasons[0])
      : t(`subtitles.${result.verdict}`);

  return (
    <div className={cn("space-y-6", className)}>
      <VerdictCard
        tone={tone}
        title={t(`verdicts.${result.verdict}`)}
        subtitle={subtitle}
        matchScore={result.score}
      />

      {result.rows.length > 0 && (
        <section>
          <h3 className="text-h3 text-graphite mb-3">
            {tProduct("skinCompatibility")}
          </h3>
          <CompatibilityTable rows={engineRowsToUi(result, t)} />
        </section>
      )}

      {(result.positives.length > 0 || result.warnings.length > 0) && (
        <section>
          <h3 className="text-h3 text-graphite mb-3">{t("breakdown")}</h3>
          <Card
            className="bg-gradient-to-br from-soft-lavender to-pure-white"
            padding="default"
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-lavender-deep text-pure-white"
                aria-hidden
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="space-y-3 min-w-0">
                {result.positives.length > 0 && (
                  <div>
                    <p className="text-caption text-success-deep font-semibold uppercase mb-1">
                      {t("positivesTitle")}
                    </p>
                    <ul className="space-y-1">
                      {dedupeByKey(result.positives)
                        .slice(0, 4)
                        .map((h, i) => (
                          <li
                            key={`${h.key}-${h.inci ?? i}`}
                            className="text-body-sm text-graphite"
                          >
                            ✓ {formatReason(t, h)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {result.warnings.length > 0 && (
                  <div>
                    <p className="text-caption text-warning-deep font-semibold uppercase mb-1">
                      {t("warningsTitle")}
                    </p>
                    <ul className="space-y-1">
                      {dedupeByKey(result.warnings)
                        .slice(0, 4)
                        .map((h, i) => (
                          <li
                            key={`${h.key}-${h.inci ?? i}`}
                            className="text-body-sm text-graphite"
                          >
                            ⚠ {formatReason(t, h)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {result.lowConfidence && (
                  <p className="text-caption text-muted-graphite">
                    {t("lowConfidence")}
                  </p>
                )}
              </div>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

/* ───────── Helpers ───────── */

function dedupeByKey<T extends { key: string; inci?: string }>(
  arr: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of arr) {
    const k = `${h.key}:${h.inci ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

function verdictToTone(
  verdict: CompatibilityResult["verdict"],
): VerdictTone {
  return verdict === "excellent" || verdict === "good" ? "good" : "caution";
}

/**
 * Превратить engine row → UI shape, который ожидает существующий
 * `CompatibilityTable`. Лейблы / caption переводим здесь.
 */

function engineRowsToUi(
  result: CompatibilityResult,
  t: T,
): CompatibilityRow[] {
  return result.rows.map((row) => ({
    label: translateRowLabel(t, row.labelKey, row.labelArgs),
    caption: translateCaption(t, row.captionKey),
    status: row.status as CompatibilityStatus,
  }));
}

function translateRowLabel(
  t: T,
  key: string,
  args?: Record<string, string | number>,
): string {
  // Все engine-ключи начинаются с `compatibility.rows.*`. Срезаем префикс,
  // чтобы передать в `useTranslations("compatibility")`.
  const local = key.replace(/^compatibility\./, "");
  if (local === "rows.skinType" && args?.skinType) {
    return t("rows.skinType", {
      skinType: t(`skinTypes.${args.skinType}`),
    });
  }
  if (local === "rows.concern" && args?.concern) {
    return t("rows.concern", {
      concern: t(`concerns.${args.concern}`),
    });
  }
  if (local === "rows.avoided" && args?.avoided) {
    return t("rows.avoided", {
      avoided: t(`avoided.${args.avoided}`),
    });
  }
  return t(local, args);
}

function translateCaption(t: T, key: string): string {
  const local = key.replace(/^compatibility\./, "");
  return t(local);
}

function formatReason(
  t: T,
  hit: { key: string; args?: Record<string, string | number> },
): string {
  const local = hit.key.replace(/^compatibility\./, "");
  // Локализуем enum'ы внутри args, если они есть.
  const args = { ...(hit.args ?? {}) };
  if (typeof args.concern === "string") {
    args.concern = t(`concerns.${args.concern}`);
  }
  if (typeof args.avoided === "string") {
    args.avoided = t(`avoided.${args.avoided}`);
  }
  if (typeof args.goal === "string") {
    args.goal = t(`goals.${args.goal}`);
  }
  return t(local, args);
}

/* ───────── Helpers used by callers (product page) ───────── */

export function safetyToBorderClass(s: IngredientSafety): string {
  switch (s) {
    case "beneficial":
      return "border-l-success-deep";
    case "caution":
      return "border-l-soft-gold";
    case "danger":
      return "border-l-error-deep";
    default:
      return "border-l-soft-beige";
  }
}

export function safetyToDotClass(s: IngredientSafety): string {
  switch (s) {
    case "beneficial":
      return "bg-success-deep";
    case "caution":
      return "bg-soft-gold";
    case "danger":
      return "bg-error-deep";
    default:
      return "bg-light-graphite";
  }
}

export function safetyToTagTone(s: IngredientSafety): TagTone {
  switch (s) {
    case "beneficial":
      return "success";
    case "caution":
      return "warning";
    case "danger":
      return "danger";
    default:
      return "neutral";
  }
}

/* Re-export for convenience */
export type { CompatibilityRowStatus };
