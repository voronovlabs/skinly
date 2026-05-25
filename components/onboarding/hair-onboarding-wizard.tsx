"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Button, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";
import type { DemoHairProfile } from "@/lib/demo-store";
import { upsertHairProfileAction } from "@/app/actions/hair-profile";
import type { HairConcern, HairType, HaircareGoal, ScalpType, OnboardingQuestionDef } from "@/lib/types";

type Answers = Record<string, string[]>;

export interface HairOnboardingWizardProps {
  questions: OnboardingQuestionDef[];
  finishHref?: string;
  exitHref?: string;
}

export function HairOnboardingWizard({
  questions,
  finishHref = "/profile",
  exitHref = "/profile",
}: HairOnboardingWizardProps) {
  const router = useRouter();
  const t = useTranslations("hairOnboarding");
  const { setHairProfile } = useDemoStore();
  const [pending, startTransition] = useTransition();

  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});

  const totalSteps = questions.length;
  const question = questions[stepIdx];
  const stepNumber = stepIdx + 1;
  const progressPct = (stepNumber / totalSteps) * 100;

  const selected = useMemo(
    () => answers[question.id] ?? [],
    [answers, question.id],
  );

  const canContinue = selected.length > 0;

  const handleSelect = (optionId: string) => {
    setAnswers((prev) => {
      const current = prev[question.id] ?? [];
      const isSelected = current.includes(optionId);
      if (question.kind === "single") {
        return { ...prev, [question.id]: isSelected ? [] : [optionId] };
      }
      return {
        ...prev,
        [question.id]: isSelected
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      };
    });
  };

  const persistAndExit = (target: string) => {
    const profile = answersToHairProfile(answers, totalSteps);
    setHairProfile(profile);

    if (profile.hairType && profile.scalpType && profile.goal) {
      const dbInput = {
        hairType: profile.hairType.toUpperCase() as HairType_DB,
        scalpType: profile.scalpType.toUpperCase() as ScalpType_DB,
        concerns: profile.concerns.map((c) => c.toUpperCase()) as HairConcern_DB[],
        goal: profile.goal.toUpperCase() as HaircareGoal_DB,
        completion: profile.completion,
      };
      startTransition(async () => {
        await upsertHairProfileAction(dbInput);
      });
    }

    router.push(target);
  };

  const handleContinue = () => {
    if (stepIdx < totalSteps - 1) {
      setStepIdx((s) => s + 1);
      return;
    }
    persistAndExit(finishHref);
  };

  const handleSkip = () => persistAndExit(finishHref);

  const handleBack = () => {
    if (stepIdx === 0) {
      router.push(exitHref);
      return;
    }
    setStepIdx((s) => s - 1);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 bg-warm-white px-6 py-6">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            aria-label={t("skip")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </button>
          <span className="text-caption text-light-graphite">
            {t("step", { current: stepNumber, total: totalSteps })}
          </span>
          <button
            type="button"
            onClick={handleSkip}
            className="text-body-sm text-muted-graphite hover:text-graphite"
          >
            {t("skip")}
          </button>
        </div>
        <ProgressBar
          value={progressPct}
          aria-label={t("step", { current: stepNumber, total: totalSteps })}
        />
      </header>

      <section className="flex-1 px-6 pb-32 pt-2">
        <h2 className="text-h1 text-graphite">
          {t(`questions.${question.id}.title`)}
        </h2>
        <p className="text-body-sm text-muted-graphite mt-2">
          {t(`questions.${question.id}.subtitle`)}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {question.options.map((opt) => {
            const isSelected = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelect(opt.id)}
                aria-pressed={isSelected}
                className={cn(
                  "rounded-lg border-2 p-5 text-center transition",
                  isSelected
                    ? "border-lavender-deep bg-soft-lavender"
                    : "border-transparent bg-pure-white hover:border-soft-lavender",
                )}
              >
                <div
                  className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md bg-soft-beige text-2xl"
                  aria-hidden
                >
                  {opt.emoji}
                </div>
                <div className="text-h3 text-graphite">
                  {t(`questions.${question.id}.options.${opt.id}`)}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="fixed bottom-0 left-1/2 w-full max-w-[480px] -translate-x-1/2 bg-warm-white px-6 pt-4 pb-6">
        <Button
          variant="primary"
          onClick={handleContinue}
          disabled={!canContinue || pending}
        >
          {stepIdx === totalSteps - 1 ? t("complete") : t("continue")}
        </Button>
      </footer>
    </div>
  );
}

function answersToHairProfile(answers: Answers, totalSteps: number): DemoHairProfile {
  const filled = Object.values(answers).filter((arr) => arr.length > 0).length;
  return {
    hairType: (answers.hairType?.[0] as HairType) ?? null,
    scalpType: (answers.scalpType?.[0] as ScalpType) ?? null,
    concerns: (answers.concerns ?? []) as HairConcern[],
    goal: (answers.goal?.[0] as HaircareGoal) ?? null,
    completion: Math.round((filled / totalSteps) * 100),
  };
}

type HairType_DB = "STRAIGHT" | "WAVY" | "CURLY" | "COILY";
type ScalpType_DB = "NORMAL" | "DRY" | "OILY" | "SENSITIVE";
type HairConcern_DB =
  | "FRIZZ" | "DAMAGE" | "HAIR_LOSS" | "DANDRUFF" | "DULLNESS" | "SPLIT_ENDS";
type HaircareGoal_DB =
  | "HYDRATION" | "VOLUME" | "REPAIR" | "GROWTH" | "COLOR_PROTECTION" | "ANTI_FRIZZ";
