"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSwitcher, Toggle } from "@/components/ui";
import { setLocaleAction } from "@/app/actions/locale";
import type { AppLocale } from "@/lib/i18n";

/**
 * PreferencesSection — блок "Настройки" на /profile.
 *
 * Phase 3:
 *   - LanguageSwitcher реально меняет язык: setLocaleAction (server) пишет
 *     cookie NEXT_LOCALE, потом router.refresh() пересобирает RSC.
 *   - Остальные тоглы (push / email / dark) пока in-memory; в Phase 4/5
 *     подружим с user settings.
 */

export function PreferencesSection() {
  const t = useTranslations("profile");
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const [pending, startTransition] = useTransition();

  const [push, setPush] = useState(true);
  const [emailNews, setEmailNews] = useState(false);
  const [dark, setDark] = useState(false);

  const handleLocaleChange = (next: AppLocale) => {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  };

  return (
    <div className="space-y-1" aria-busy={pending}>
      <Row label={t("language")}>
        <LanguageSwitcher value={locale} onChange={handleLocaleChange} />
      </Row>

      <Row label={t("pushNotif")}>
        <Toggle
          checked={push}
          onCheckedChange={setPush}
          aria-label={t("pushNotif")}
        />
      </Row>

      <Row label={t("emailUpdates")}>
        <Toggle
          checked={emailNews}
          onCheckedChange={setEmailNews}
          aria-label={t("emailUpdates")}
        />
      </Row>

      <Row label={t("darkMode")}>
        <Toggle
          checked={dark}
          onCheckedChange={setDark}
          aria-label={t("darkMode")}
        />
      </Row>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex cursor-pointer items-center justify-between py-3">
      <span className="text-body-sm text-graphite">{label}</span>
      {children}
    </div>
  );
}
