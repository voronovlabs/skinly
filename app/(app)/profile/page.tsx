import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button, buttonClassName } from "@/components/ui";
import { ScreenContainer } from "@/components/layout";
import {
  PreferencesSection,
  ProfileHeader,
  ResetDemoButton,
  SkinProfileCard,
  StatsRow,
} from "@/components/profile";
import { LogoutButton } from "@/components/auth";
import { MOCK_USER } from "@/lib/mock";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("metaTitle") };
}

export default async function ProfilePage() {
  const t = await getTranslations("profile");
  const user = MOCK_USER;

  return (
    <ScreenContainer withBottomNav>
      <ProfileHeader user={user} />

      {/* Skin profile (читает demo store) */}
      <section className="border-b border-soft-beige px-6 py-6">
        <h3 className="text-h3 text-graphite mb-3">{t("skinProfileTitle")}</h3>
        <SkinProfileCard className="mb-3" />
        <Link
          href="/onboarding"
          className={buttonClassName({ variant: "secondary" })}
        >
          {t("editSkinProfile")}
        </Link>
      </section>

      {/* Stats (считаются из demo store) */}
      <section className="border-b border-soft-beige px-6 py-6">
        <h3 className="text-h3 text-graphite mb-3">{t("statistics")}</h3>
        <StatsRow />
      </section>

      {/* Preferences */}
      <section className="border-b border-soft-beige px-6 py-6">
        <h3 className="text-h3 text-graphite mb-3">{t("preferences")}</h3>
        <PreferencesSection />
      </section>

      {/* Demo controls */}
      <section className="border-b border-soft-beige px-6 py-6 space-y-3">
        <h3 className="text-h3 text-graphite">{t("demoSection")}</h3>
        <p className="text-body-sm text-muted-graphite">
          {t("demoSectionHint")}
        </p>
        <ResetDemoButton />
      </section>

      {/* Footer actions */}
      <section className="px-6 py-6 space-y-3">
        <Button variant="secondary" disabled>
          {t("help")}
        </Button>
        <Button variant="secondary" disabled>
          {t("privacy")}
        </Button>
        <LogoutButton label={t("logout")} />
        <p className="text-caption text-light-graphite text-center pt-2">
          {t("phaseNote")}
        </p>
      </section>
    </ScreenContainer>
  );
}
