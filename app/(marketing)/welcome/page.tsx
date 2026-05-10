import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  GuestButton,
  StartOnboardingButton,
} from "@/components/auth";
import { buttonClassName } from "@/components/ui";
import { getCurrentSession } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("welcome");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

const VALUE_STEP_KEYS = ["scan", "analyze", "match"] as const;
const STEP_ICONS: Record<(typeof VALUE_STEP_KEYS)[number], string> = {
  scan: "📷",
  analyze: "✨",
  match: "🎯",
};

export default async function WelcomePage() {
  // Phase 11: уже залогиненного пользователя сразу пускаем в приложение —
  // welcome ему не нужен, и он точно не должен повторно попасть в onboarding.
  const session = await getCurrentSession();
  if (session?.type === "user") {
    redirect("/dashboard");
  }

  const t = await getTranslations("welcome");

  return (
    <main
      className="
        relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col
        justify-between bg-gradient-to-br from-warm-white via-soft-beige to-soft-lavender
        px-6 py-12 text-center animate-fade-in
      "
    >
      <header>
        <div className="text-2xl font-medium tracking-tight text-graphite">
          {t("logo")}
        </div>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-6">
        <p className="text-caption text-muted-graphite">{t("caption")}</p>
        <h1 className="text-display text-graphite">{t("title")}</h1>
        <p className="text-body text-muted-graphite">{t("subtitle")}</p>

        <div className="mt-2 flex flex-col gap-3">
          {VALUE_STEP_KEYS.map((key) => (
            <div
              key={key}
              className="
                flex items-center gap-4 rounded-lg bg-pure-white/60 p-4 text-left
                backdrop-blur-md
              "
            >
              <div
                aria-hidden
                className="
                  flex h-10 w-10 flex-shrink-0 items-center justify-center
                  rounded-md bg-soft-lavender text-xl
                "
              >
                {STEP_ICONS[key]}
              </div>
              <div className="min-w-0">
                <div className="text-h3 text-graphite">
                  {t(`steps.${key}.title`)}
                </div>
                <div className="text-body-sm text-muted-graphite">
                  {t(`steps.${key}.desc`)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/*
        Phase 11 — иерархия CTA:
          PRIMARY:   "Начать бесплатно"   → guest session + onboarding
          SECONDARY: "Войти"                → /login
          TERTIARY:  "Продолжить как гость" → guest session + /dashboard
      */}
      <footer className="space-y-3">
        <StartOnboardingButton label={t("ctaStart")} />
        <Link
          href="/login"
          className={buttonClassName({ variant: "secondary" })}
        >
          {t("ctaLogin")}
        </Link>
        <GuestButton label={t("ctaGuest")} />
        <p className="pt-2 text-[11px] text-muted-graphite">{t("trustBar")}</p>
      </footer>
    </main>
  );
}
