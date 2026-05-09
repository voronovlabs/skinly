"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";

/**
 * SkinProfileCard — компактная сводка профиля кожи на /profile.
 *
 * Phase 9: source-of-truth dual-mode:
 *   - если передан `profile` prop (server-data из BeautyProfile) — рендерим его
 *   - если нет — fallback на demo store (как было в Phase 5)
 *
 * Серверный профиль перед передачей сюда нормализован к lowercase enum
 * keys (skinTypes.dry, sensitivities.high) — те же ключи, что в i18n
 * messages, и совпадает с demo-store-форматом.
 */

export interface SkinProfileSummary {
  skinType: string | null;
  sensitivity: string | null;
  concerns: string[];
  avoidedList: string[];
  goal: string | null;
  completion: number;
}

export interface SkinProfileCardProps {
  /**
   * Если передано (включая `null` = пользователь без профиля) — используем
   * это и игнорируем demo store. Если `undefined` — берём demo store.
   */
  profile?: SkinProfileSummary | null;
  className?: string;
}

export function SkinProfileCard({ profile, className }: SkinProfileCardProps) {
  const t = useTranslations("profile");
  const tDash = useTranslations("dashboard");
  const { state, hydrated } = useDemoStore();

  // Источник: server-prop > demo store
  const usingServer = profile !== undefined;
  const source = usingServer ? profile : state.skinProfile;

  if (!usingServer && !hydrated) {
    return <Card className={cn("h-[140px]", className)} aria-busy />;
  }

  if (!source?.skinType) {
    return (
      <Card className={cn(className)}>
        <p className="text-body-sm text-muted-graphite">
          {tDash("skinProfileEmpty")}
        </p>
      </Card>
    );
  }

  const concernsValue =
    source.concerns.length === 0
      ? "—"
      : source.concerns.map((c) => t(`concernLabels.${c}`)).join(", ");

  const avoidedValue =
    source.avoidedList.length === 0
      ? "—"
      : source.avoidedList.map((a) => t(`avoidedLabels.${a}`)).join(", ");

  return (
    <Card className={cn("space-y-2", className)}>
      <Row label={t("skinType")} value={t(`skinTypes.${source.skinType}`)} />
      {source.sensitivity && (
        <Row
          label={t("sensitivity")}
          value={t(`sensitivities.${source.sensitivity}`)}
        />
      )}
      <Row label={t("concerns")} value={concernsValue} />
      <Row label={t("avoiding")} value={avoidedValue} />
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-body-sm text-muted-graphite">{label}</span>
      <span className="text-body-sm font-semibold text-graphite text-right">
        {value}
      </span>
    </div>
  );
}
