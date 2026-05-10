import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { buttonClassName } from "@/components/ui";
import { GuestButton } from "@/components/auth";
import { getCurrentSession } from "@/lib/auth";

/**
 * /onboarding/complete — account gate.
 *
 * Показывается только гостю после прохождения онбординг-анкеты:
 *   wizard finish (guest) → /onboarding/complete → user выбирает:
 *      - Создать аккаунт   → /register → migrator переносит данные
 *      - Войти             → /login    → migrator переносит данные
 *      - Продолжить гостем → /dashboard (профиль остаётся в localStorage)
 *
 * Если на эту страницу попал залогиненный user — редирект на /dashboard
 * (он уже всё имеет, gate ему не нужен).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding.accountGate");
  return { title: t("metaTitle") };
}

export default async function OnboardingCompletePage() {
  const session = await getCurrentSession();
  if (session?.type === "user") {
    redirect("/dashboard");
  }

  const t = await getTranslations("onboarding.accountGate");

  return (
    <main
      className="
        relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col
        justify-between bg-gradient-to-br from-warm-white via-soft-beige to-soft-lavender
        px-6 py-10 text-center animate-fade-in
      "
    >
      <header className="flex items-center justify-center gap-2 text-graphite">
        <span className="text-2xl font-medium tracking-tight">Skinly</span>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div
          aria-hidden
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-soft-lavender text-lavender-deep shadow-soft-md"
        >
          <Sparkles className="h-7 w-7" strokeWidth={1.8} />
        </div>

        <h1 className="text-display text-graphite">{t("title")}</h1>
        <p className="text-body text-muted-graphite">{t("subtitle")}</p>

        <ul className="mx-auto mt-2 flex max-w-[320px] flex-col gap-2 text-left">
          {(["history", "sync", "recommendations"] as const).map((key) => (
            <li
              key={key}
              className="flex items-start gap-3 rounded-md bg-pure-white/70 px-4 py-3 backdrop-blur-md"
            >
              <span aria-hidden className="text-success-deep">
                ✓
              </span>
              <span className="text-body-sm text-graphite">
                {t(`benefits.${key}`)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mx-auto max-w-[320px] rounded-md border border-warning-deep/20 bg-warning-cream/60 px-4 py-3 text-left">
          <p className="text-caption text-warning-deep font-semibold uppercase">
            {t("guestNoticeTitle")}
          </p>
          <p className="text-body-sm text-graphite mt-1">
            {t("guestNoticeBody")}
          </p>
        </div>
      </section>

      <footer className="space-y-3">
        <Link
          href="/register"
          className={buttonClassName({ variant: "primary" })}
        >
          {t("ctaCreate")}
        </Link>
        <Link href="/login" className={buttonClassName({ variant: "secondary" })}>
          {t("ctaLogin")}
        </Link>
        <GuestButton label={t("ctaGuest")} />
      </footer>
    </main>
  );
}
