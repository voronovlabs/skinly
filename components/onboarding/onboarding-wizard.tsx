"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Button, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";
import type { DemoSkinProfile } from "@/lib/demo-store";
import { upsertBeautyProfileAction } from "@/app/actions/profile";
import type {
  AvoidedIngredient,
  OnboardingQuestionDef,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@/lib/types";

/**
 * OnboardingWizard — 9-шаговый wizard профиля кожи.
 *
 * Phase 5: пишем в demo store (localStorage).
 * Phase 9 (server persistence): дополнительно вызываем
 *   upsertBeautyProfileAction(...) — для авторизованного user'а action
 *   запишет в `BeautyProfile`. Для guest'а action возвращает no-op.
 *
 * Phase 12: новый вопросник (9 вопросов), conditional skip, maxSelect,
 *   exclusiveOptionId, list/grid layout, новый маппинг answersToSkinProfile.
 *
 * Сохранение происходит и на «Готово», и на «Пропустить» — то, что уже
 * выбрано, не теряется.
 */

type Answers = Record<string, string[]>;

export interface OnboardingWizardProps {
  questions: OnboardingQuestionDef[];
  finishHref?: string;
  exitHref?: string;
}

/** Проверяет, надо ли пропустить вопрос на основе текущих ответов. */
function isSkipped(question: OnboardingQuestionDef, answers: Answers): boolean {
  if (!question.skipIf) return false;
  const { questionId, values } = question.skipIf;
  const current = answers[questionId] ?? [];
  return values.some((v) => current.includes(v));
}

export function OnboardingWizard({
  questions,
  finishHref = "/dashboard",
  exitHref = "/welcome",
}: OnboardingWizardProps) {
  const router = useRouter();
  const t = useTranslations("onboarding");
  const { setSkinProfile } = useDemoStore();
  const [pending, startTransition] = useTransition();

  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});

  // Фильтруем вопросы по условию skipIf
  const visibleQuestions = useMemo(
    () => questions.filter((q) => !isSkipped(q, answers)),
    [questions, answers],
  );

  const totalSteps = visibleQuestions.length;
  const question = visibleQuestions[stepIdx];
  const stepNumber = stepIdx + 1;
  const progressPct = (stepNumber / totalSteps) * 100;

  const selected = useMemo(
    () => answers[question?.id ?? ""] ?? [],
    [answers, question?.id],
  );

  const canContinue = selected.length > 0;

  const handleSelect = (optionId: string) => {
    if (!question) return;
    setAnswers((prev) => {
      const current = prev[question.id] ?? [];
      const isSelected = current.includes(optionId);

      if (question.kind === "single") {
        return { ...prev, [question.id]: isSelected ? [] : [optionId] };
      }

      // multi: обрабатываем exclusiveOptionId
      if (question.exclusiveOptionId) {
        if (optionId === question.exclusiveOptionId) {
          // Выбор exclusive: снимаем все остальные
          return { ...prev, [question.id]: isSelected ? [] : [optionId] };
        } else {
          // Выбор не-exclusive: снимаем exclusive, если он выбран
          const withoutExclusive = current.filter(
            (id) => id !== question.exclusiveOptionId,
          );
          if (isSelected) {
            return {
              ...prev,
              [question.id]: withoutExclusive.filter((id) => id !== optionId),
            };
          }
          // Проверяем maxSelect
          if (
            question.maxSelect &&
            withoutExclusive.length >= question.maxSelect
          ) {
            return prev; // лимит достигнут
          }
          return { ...prev, [question.id]: [...withoutExclusive, optionId] };
        }
      }

      // multi без exclusive: проверяем maxSelect
      if (question.maxSelect && !isSelected && current.length >= question.maxSelect) {
        return prev; // лимит достигнут
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
    const profile = answersToSkinProfile(answers, visibleQuestions.length);
    // 1. Optimistic — demo store (всегда, и для user, и для guest).
    setSkinProfile(profile);

    // 2. Синхронизация с БД (для guest action — no-op). Не блокирует UX.
    if (profile.skinType) {
      const dbInput = {
        skinType: profile.skinType.toUpperCase() as SkinType_DB,
        sensitivity: (profile.sensitivity ?? "none").toUpperCase() as SensitivityLevel_DB,
        concerns: profile.concerns.map((c) => c.toUpperCase()) as SkinConcern_DB[],
        avoidedList: profile.avoidedList.map((a) =>
          a.toUpperCase(),
        ) as AvoidedIngredient_DB[],
        goal: (profile.goal ?? "hydration").toUpperCase() as SkincareGoal_DB,
        completion: profile.completion,
      };
      startTransition(async () => {
        await upsertBeautyProfileAction(dbInput);
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

  if (!question) return null;

  const titleKey = `questions.${question.id}.title`;
  const subtitleKey = `questions.${question.id}.subtitle`;
  const isListLayout = question.layout === "list";

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
        <h2 className="text-h1 text-graphite">{t(titleKey)}</h2>
        <p className="text-body-sm text-muted-graphite mt-2">{t(subtitleKey)}</p>

        {isListLayout ? (
          // Список: полная ширина, без эмодзи-блока
          <div className="mt-6 flex flex-col gap-3">
            {question.options.map((opt) => {
              const isSelected = selected.includes(opt.id);
              const labelKey = `questions.${question.id}.options.${opt.id}`;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelect(opt.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "w-full rounded-lg border-2 px-4 py-4 text-left transition",
                    isSelected
                      ? "border-lavender-deep bg-soft-lavender"
                      : "border-transparent bg-pure-white hover:border-soft-lavender",
                  )}
                >
                  <span className="text-body text-graphite">{t(labelKey)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          // Сетка: 2 колонки с эмодзи (классический вид)
          <div className="mt-6 grid grid-cols-2 gap-3">
            {question.options.map((opt) => {
              const isSelected = selected.includes(opt.id);
              const labelKey = `questions.${question.id}.options.${opt.id}`;
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
                  <div className="text-h3 text-graphite">{t(labelKey)}</div>
                </button>
              );
            })}
          </div>
        )}
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

/**
 * Маппинг ответов нового вопросника → DemoSkinProfile для compatibility engine.
 *
 * skinBehavior → skinType
 * skinReaction → sensitivity
 * concerns агрегируются из breakouts + skinReaction + pores + goals
 * avoidedList: special.allergy → fragrance + essential_oils
 * goal: первый приоритетный из goals
 * completion: по 6 core вопросам (skinBehavior, breakouts, skinReaction, pores, goals, special)
 */
function answersToSkinProfile(
  answers: Answers,
  _totalVisible: number,
): DemoSkinProfile {
  // ── skinType ──────────────────────────────────────────────────────────────
  const skinBehaviorMap: Record<string, SkinType> = {
    normal: "normal",
    combination: "combination",
    oily: "oily",
    dry: "dry",
  };
  const skinType: SkinType | null =
    skinBehaviorMap[answers.skinBehavior?.[0] ?? ""] ?? null;

  // ── sensitivity ───────────────────────────────────────────────────────────
  const skinReactionMap: Record<string, SensitivityLevel> = {
    calm: "none",
    mild: "mild",
    couperose: "high",
    rosacea: "reactive",
  };
  const sensitivity: SensitivityLevel | null =
    skinReactionMap[answers.skinReaction?.[0] ?? ""] ?? null;

  // ── concerns ──────────────────────────────────────────────────────────────
  const concernsSet = new Set<SkinConcern>();

  const breakouts = answers.breakouts?.[0];
  if (breakouts === "occasional" || breakouts === "frequent") {
    concernsSet.add("acne");
  }

  const skinReaction = answers.skinReaction?.[0];
  if (skinReaction === "couperose" || skinReaction === "rosacea") {
    concernsSet.add("redness");
  }

  const pores = answers.pores?.[0];
  if (pores === "tzone" || pores === "allover") {
    concernsSet.add("pores");
  }
  if (pores === "allover") {
    concernsSet.add("blackheads");
  }

  const goals = answers.goals ?? [];
  if (goals.includes("even_tone")) concernsSet.add("pigmentation");
  if (goals.includes("anti_aging")) concernsSet.add("aging");
  if (goals.includes("calm_skin")) concernsSet.add("redness");

  const concerns = Array.from(concernsSet);

  // ── avoidedList ───────────────────────────────────────────────────────────
  const special = answers.special ?? [];
  const avoidedList: AvoidedIngredient[] = [];
  if (special.includes("allergy")) {
    avoidedList.push("fragrance");
    avoidedList.push("essential_oils");
  }

  // ── goal (primary) ────────────────────────────────────────────────────────
  const goalPriorityMap: { goalKey: string; engineGoal: SkincareGoal }[] = [
    { goalKey: "anti_aging", engineGoal: "anti_aging" },
    { goalKey: "even_tone", engineGoal: "even_tone" },
    { goalKey: "hydration", engineGoal: "hydration" },
    { goalKey: "calm_skin", engineGoal: "hydration" },
    { goalKey: "eye_care", engineGoal: "hydration" },
    { goalKey: "basic", engineGoal: "minimal_routine" },
  ];
  let goal: SkincareGoal | null = null;
  for (const { goalKey, engineGoal } of goalPriorityMap) {
    if (goals.includes(goalKey)) {
      goal = engineGoal;
      break;
    }
  }

  // ── completion ────────────────────────────────────────────────────────────
  // 6 core вопросов: skinBehavior, breakouts, skinReaction, pores, goals, special
  const coreQuestions = [
    "skinBehavior",
    "breakouts",
    "skinReaction",
    "pores",
    "goals",
    "special",
  ];
  const coreAnswered = coreQuestions.filter(
    (q) => (answers[q] ?? []).length > 0,
  ).length;
  const completion = Math.round((coreAnswered / coreQuestions.length) * 100);

  return {
    skinType,
    sensitivity,
    concerns,
    avoidedList,
    goal,
    completion,
  };
}

/* ───────── DB enum aliases ───────── */
// Алиасы Prisma-енумов (uppercase). Не импортим из @prisma/client тут,
// чтобы клиентский бандл не тянул серверные типы; полагаемся на server
// action для типобезопасности fully.
type SkinType_DB = "DRY" | "OILY" | "COMBINATION" | "NORMAL";
type SensitivityLevel_DB = "NONE" | "MILD" | "HIGH" | "REACTIVE";
type SkinConcern_DB =
  | "ACNE"
  | "AGING"
  | "PIGMENTATION"
  | "REDNESS"
  | "PORES"
  | "BLACKHEADS";
type AvoidedIngredient_DB =
  | "FRAGRANCE"
  | "ALCOHOL"
  | "SULFATES"
  | "PARABENS"
  | "ESSENTIAL_OILS";
type SkincareGoal_DB =
  | "CLEAR_SKIN"
  | "ANTI_AGING"
  | "HYDRATION"
  | "EVEN_TONE"
  | "MINIMAL_ROUTINE";
