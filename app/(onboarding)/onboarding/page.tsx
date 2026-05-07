import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OnboardingWizard } from "@/components/onboarding";
import { ScreenContainer } from "@/components/layout";
import { ONBOARDING_QUESTIONS } from "@/lib/mock";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

export default function OnboardingPage() {
  return (
    <ScreenContainer>
      <OnboardingWizard
        questions={ONBOARDING_QUESTIONS}
        finishHref="/dashboard"
        exitHref="/welcome"
      />
    </ScreenContainer>
  );
}
