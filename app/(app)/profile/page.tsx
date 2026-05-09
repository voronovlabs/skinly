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
import { getCurrentUser } from "@/lib/auth";
import { getBeautyProfileByUserId } from "@/lib/db/repositories/beauty-profile";
import {
  averageMatchScoreByUser,
  countDistinctProductsByUser,
  countScansByUser,
} from "@/lib/db/repositories/scan-history";
import type { SkinProfileSummary } from "@/components/profile/skin-profile-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("metaTitle") };
}

export default async function ProfilePage() {
  const t = await getTranslations("profile");
  const dbUser = await getCurrentUser();

  // Профиль шапки — DB User или mock (для guest)
  const headerUser = dbUser
    ? {
        name: dbUser.name,
        email: dbUser.email,
        avatarEmoji: MOCK_USER.avatarEmoji, // emoji-аватар пока не храним
        plan: "free" as const,
      }
    : {
        name: MOCK_USER.name,
        email: MOCK_USER.email,
        avatarEmoji: MOCK_USER.avatarEmoji,
        plan: MOCK_USER.plan,
      };

  // Server-side: BeautyProfile + stats для user; null/undefined — guest fallback
  let skinProfile: SkinProfileSummary | null | undefined = undefined;
  let stats: { scans: number; products: number; avgMatch: number } | undefined =
    undefined;

  if (dbUser) {
    try {
      const bp = await getBeautyProfileByUserId(dbUser.id);
      skinProfile = bp
        ? {
            skinType: bp.skinType.toLowerCase(),
            sensitivity: bp.sensitivity.toLowerCase(),
            concerns: bp.concerns.map((c) => c.toLowerCase()),
            avoidedList: bp.avoidedList.map((a) => a.toLowerCase()),
            goal: bp.goal.toLowerCase(),
            completion: bp.completion,
          }
        : null;

      const [scans, products, avgMatch] = await Promise.all([
        countScansByUser(dbUser.id),
        countDistinctProductsByUser(dbUser.id),
        averageMatchScoreByUser(dbUser.id),
      ]);
      stats = { scans, products, avgMatch };
    } catch (e) {
      console.error("[profile/page] DB load failed:", e);
      // skinProfile/stats остаются undefined → клиент возьмёт demo store
    }
  }

  return (
    <ScreenContainer withBottomNav>
      <ProfileHeader user={headerUser} />

      {/* Skin profile (server-data для user, demo store для guest) */}
      <section className="border-b border-soft-beige px-6 py-6">
        <h3 className="text-h3 text-graphite mb-3">{t("skinProfileTitle")}</h3>
        <SkinProfileCard profile={skinProfile} className="mb-3" />
        <Link
          href="/onboarding"
          className={buttonClassName({ variant: "secondary" })}
        >
          {t("editSkinProfile")}
        </Link>
      </section>

      {/* Stats */}
      <section className="border-b border-soft-beige px-6 py-6">
        <h3 className="text-h3 text-graphite mb-3">{t("statistics")}</h3>
        <StatsRow stats={stats} />
      </section>

      {/* Preferences */}
      <section className="border-b border-soft-beige px-6 py-6">
        <h3 className="text-h3 text-graphite mb-3">{t("preferences")}</h3>
        <PreferencesSection />
      </section>

      {/* Demo controls (полезно и для user'а — стереть локальный кэш) */}
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
      </section>
    </ScreenContainer>
  );
}
