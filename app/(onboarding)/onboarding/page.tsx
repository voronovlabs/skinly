import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OnboardingWizard } from "@/components/onboarding";
import { ScreenContainer } from "@/components/layout";
import { ONBOARDING_QUESTIONS } from "@/lib/mock";
import { getCurrentSession } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

/**
 * /onboarding — wizard анкеты кожи.
 *
 * Phase 11: после finish'а маршрут зависит от статуса сессии:
 *   - user  → /dashboard (gate ему не нужен)
 *   - guest → /onboarding/complete (account gate)
 */
export default async function OnboardingPage() {
  const session = await getCurrentSession();
  const finishHref =
    session?.type === "user" ? "/dashboard" : "/onboarding/complete";

  return (
    <ScreenContainer>
      <OnboardingWizard
        questions={ONBOARDING_QUESTIONS}
        finishHref={finishHref}
        exitHref="/welcome"
      />
    </ScreenContainer>
  );
}
