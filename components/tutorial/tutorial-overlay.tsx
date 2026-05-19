"use client";

import { useState } from "react";
import {
  Camera,
  Sparkles,
  Heart,
  SlidersHorizontal,
  Zap,
  ChevronRight,
  ChevronLeft,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { buttonClassName } from "@/components/ui";

interface StepDef {
  Icon: React.ElementType;
  titleKey: string;
  descKey: string;
  iconBg: string;
  iconColor: string;
}

const STEPS: StepDef[] = [
  {
    Icon: Camera,
    titleKey: "step1Title",
    descKey: "step1Desc",
    iconBg: "bg-soft-lavender",
    iconColor: "text-lavender-deep",
  },
  {
    Icon: Sparkles,
    titleKey: "step2Title",
    descKey: "step2Desc",
    iconBg: "bg-premium-peach",
    iconColor: "text-soft-gold",
  },
  {
    Icon: Heart,
    titleKey: "step3Title",
    descKey: "step3Desc",
    iconBg: "bg-error-blush",
    iconColor: "text-error-deep",
  },
  {
    Icon: SlidersHorizontal,
    titleKey: "step4Title",
    descKey: "step4Desc",
    iconBg: "bg-success-mint",
    iconColor: "text-success-deep",
  },
  {
    Icon: Zap,
    titleKey: "step5Title",
    descKey: "step5Desc",
    iconBg: "bg-soft-lavender",
    iconColor: "text-lavender-deep",
  },
];

export interface TutorialOverlayProps {
  onFinish: () => void;
}

export function TutorialOverlay({ onFinish }: TutorialOverlayProps) {
  const t = useTranslations("tutorial");
  const [step, setStep] = useState(0);
  const [animating, setAnimating] = useState(false);

  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const { Icon, titleKey, descKey, iconBg, iconColor } = STEPS[step];

  function navigate(next: number) {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      setStep(next);
      setAnimating(false);
    }, 180);
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("ariaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/60 backdrop-blur-sm px-4"
    >
      {/* Sheet */}
      <div className="w-full max-w-[420px] animate-fade-in rounded-3xl bg-pure-white shadow-soft-xl">

        {/* Skip row */}
        <div className="flex justify-end px-6 pt-5">
          <button
            type="button"
            onClick={onFinish}
            className="flex items-center gap-1 text-sm text-muted-graphite transition-colors hover:text-graphite"
            aria-label={t("skip")}
          >
            <X className="h-3.5 w-3.5" />
            {t("skip")}
          </button>
        </div>

        {/* Icon illustration */}
        <div className="flex justify-center px-6 pt-4 pb-6">
          <div
            className={cn(
              "flex h-28 w-28 items-center justify-center rounded-full transition-all duration-300",
              animating ? "scale-90 opacity-0" : "scale-100 opacity-100",
              iconBg,
            )}
          >
            <Icon className={cn("h-14 w-14", iconColor)} strokeWidth={1.5} />
          </div>
        </div>

        {/* Text */}
        <div
          className={cn(
            "px-8 pb-6 text-center transition-all duration-300",
            animating ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100",
          )}
        >
          <h2 className="text-h2 text-graphite mb-2">{t(titleKey)}</h2>
          <p className="text-body text-muted-graphite">{t(descKey)}</p>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-2 pb-6" role="tablist" aria-label={t("progress")}>
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={`${t("stepLabel")} ${i + 1}`}
              onClick={() => navigate(i)}
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                i === step
                  ? "w-6 bg-lavender-deep"
                  : "w-2 bg-border hover:bg-light-graphite",
              )}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 px-6 pb-10">
          {!isFirst ? (
            <button
              type="button"
              onClick={() => navigate(step - 1)}
              aria-label={t("back")}
              className={cn(
                buttonClassName({ variant: "secondary", size: "icon", fullWidth: false }),
                "shrink-0",
              )}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={isLast ? onFinish : () => navigate(step + 1)}
            className={cn(buttonClassName({ variant: "primary" }), "flex-1")}
          >
            {isLast ? t("getStarted") : t("next")}
            {!isLast && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
