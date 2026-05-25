"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";

export interface HairProfileSummary {
  hairType: string | null;
  scalpType: string | null;
  concerns: string[];
  goal: string | null;
  completion: number;
}

export interface HairProfileCardProps {
  profile?: HairProfileSummary | null;
  className?: string;
}

export function HairProfileCard({ profile, className }: HairProfileCardProps) {
  const t = useTranslations("profile");
  const { state, hydrated } = useDemoStore();

  const usingServer = profile !== undefined;
  const source = usingServer ? profile : state.hairProfile;

  if (!usingServer && !hydrated) {
    return <Card className={cn("h-[120px]", className)} aria-busy />;
  }

  if (!source?.hairType) {
    return (
      <Card className={cn(className)}>
        <p className="text-body-sm text-muted-graphite">
          Расскажите о ваших волосах — и мы подберём подходящий уход.
        </p>
      </Card>
    );
  }

  const concernsValue =
    source.concerns.length === 0
      ? "—"
      : source.concerns.map((c) => t(`hairConcernLabels.${c}`)).join(", ");

  return (
    <Card className={cn("space-y-2", className)}>
      <Row label={t("hairType")} value={t(`hairTypes.${source.hairType}`)} />
      {source.scalpType && (
        <Row label={t("scalpType")} value={t(`scalpTypes.${source.scalpType}`)} />
      )}
      <Row label={t("hairConcerns")} value={concernsValue} />
      {source.goal && (
        <Row label={t("hairGoal")} value={t(`hairGoalLabels.${source.goal}`)} />
      )}
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
