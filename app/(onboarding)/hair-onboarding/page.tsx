import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HairOnboardingWizard } from "@/components/onboarding";
import { ScreenContainer } from "@/components/layout";
import { HAIR_ONBOARDING_QUESTIONS } from "@/lib/mock";
import { getCurrentSession } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hairOnboarding");
  return { title: t("metaTitle") };
}

export default async function HairOnboardingPage() {
  const session = await getCurrentSession();
  const finishHref =
    session?.type === "user" ? "/dashboard" : "/onboarding/complete";

  return (
    <ScreenContainer>
      <HairOnboardingWizard
        questions={HAIR_ONBOARDING_QUESTIONS}
        finishHref={finishHref}
        exitHref="/onboarding"
      />
    </ScreenContainer>
  );
}
