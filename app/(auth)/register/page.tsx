import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RegisterForm, GuestButton } from "@/components/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("metaTitle") };
}

export default async function RegisterPage() {
  const t = await getTranslations("auth.register");
  const tCommon = await getTranslations("common");
  const tAuth = await getTranslations("auth");

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-h1 text-graphite">{t("title")}</h1>
        <p className="text-body-sm text-muted-graphite mt-2">{t("subtitle")}</p>
      </div>

      <div className="rounded-xl bg-pure-white/70 p-6 shadow-soft-md backdrop-blur-md">
        <RegisterForm />
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-caption text-muted-graphite">
          {tCommon("or")}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <GuestButton label={tAuth("guestCta")} />
    </div>
  );
}
