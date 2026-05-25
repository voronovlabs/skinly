"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

export function PremiumUpgradeButton() {
  const t = useTranslations("profile");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          text-xs font-semibold tracking-wide text-lavender-deep
          underline underline-offset-2 hover:opacity-70 transition-opacity
        "
      >
        {t("upgradePremium")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-graphite/40 backdrop-blur-sm px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="
              w-full max-w-[480px] rounded-xl bg-warm-white shadow-soft-xl
              p-6 flex flex-col gap-4
            "
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-h3 text-graphite">{t("premiumModalTitle")}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-graphite hover:text-graphite transition-colors"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <p className="text-body-sm text-muted-graphite leading-relaxed">
              {t("premiumModalBody")}
            </p>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="
                w-full rounded-full bg-graphite text-pure-white
                px-7 py-4 text-sm font-semibold tracking-wide
                shadow-soft-md hover:scale-[1.02] hover:shadow-soft-lg
                active:scale-[0.98] transition-[transform,box-shadow] duration-200
              "
            >
              {t("premiumModalClose")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
