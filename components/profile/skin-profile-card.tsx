"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";

/**
 * SkinProfileCard — компактная сводка профиля кожи на /profile.
 *
 * Phase 5: данные из demo store. Если профиль не заполнен — показываем
 * соответствующий placeholder.
 */

export interface SkinProfileCardProps {
  className?: string;
}

export function SkinProfileCard({ className }: SkinProfileCardProps) {
  const t = useTranslations("profile");
  const tDash = useTranslations("dashboard");
  const { state, hydrated } = useDemoStore();
  const profile = state.skinProfile;

  if (!hydrated) {
    return <Card className={cn("h-[140px]", className)} aria-busy />;
  }

  if (!profile?.skinType) {
    return (
      <Card className={cn(className)}>
        <p className="text-body-sm text-muted-graphite">
          {tDash("skinProfileEmpty")}
        </p>
      </Card>
    );
  }

  const concernsValue =
    profile.concerns.length === 0
      ? "—"
      : profile.concerns.map((c) => t(`concernLabels.${c}`)).join(", ");

  const avoidedValue =
    profile.avoidedList.length === 0
      ? "—"
      : profile.avoidedList.map((a) => t(`avoidedLabels.${a}`)).join(", ");

  return (
    <Card className={cn("space-y-2", className)}>
      <Row
        label={t("skinType")}
        value={t(`skinTypes.${profile.skinType}`)}
      />
      {profile.sensitivity && (
        <Row
          label={t("sensitivity")}
          value={t(`sensitivities.${profile.sensitivity}`)}
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
