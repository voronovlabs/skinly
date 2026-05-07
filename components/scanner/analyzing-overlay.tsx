"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

/**
 * AnalyzingOverlay — fullscreen-оверлей "Анализируем состав".
 * Соответствует `#analyzing-overlay` в прототипе.
 *
 * Phase 3: подписи шагов берутся из messages/*.json (`scanner.steps.*`).
 */

const STEP_KEYS = [
  "ha",
  "niacinamide",
  "ceramides",
  "compatibility",
  "report",
] as const;

export interface AnalyzingOverlayProps {
  visible: boolean;
}

export function AnalyzingOverlay({ visible }: AnalyzingOverlayProps) {
  const t = useTranslations("scanner");
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!visible) {
      setI(0);
      return;
    }
    const id = setInterval(() => {
      setI((prev) => (prev + 1) % STEP_KEYS.length);
    }, 400);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="
        absolute inset-0 z-20 flex flex-col items-center justify-center
        bg-black/70 backdrop-blur-md
      "
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-6 h-[120px] w-[120px]">
        <div className="absolute inset-0 rounded-full border-[3px] border-lavender-deep/30 animate-skinly-pulse" />
        <div
          className="absolute inset-[10%] rounded-full border-[3px] border-lavender-deep/50 animate-skinly-pulse"
          style={{ animationDelay: "0.3s" }}
        />
        <div
          className="absolute inset-[20%] rounded-full border-[3px] border-lavender-deep/80 animate-skinly-pulse"
          style={{ animationDelay: "0.6s" }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-pure-white" strokeWidth={2} />
        </div>
      </div>
      <p className="text-h3 text-pure-white">{t("analyzing")}</p>
      <p className="text-body-sm text-pure-white/70 mt-2">
        {t(`steps.${STEP_KEYS[i]}`)}
      </p>
    </div>
  );
}
