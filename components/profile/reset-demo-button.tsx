"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { buttonClassName } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";

/**
 * ResetDemoButton — сбрасывает локальный demo state.
 * Использует встроенный `confirm()` — для MVP/инвестора достаточно,
 * красивый custom-modal вынесем на полировке.
 */
export function ResetDemoButton({ className }: { className?: string }) {
  const t = useTranslations("profile");
  const { reset } = useDemoStore();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(t("resetDemoConfirm"));
      if (!ok) return;
    }
    startTransition(() => {
      reset();
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={cn(
        buttonClassName({ variant: "secondary" }),
        "!text-warning-deep !border-warning-cream hover:!bg-warning-cream/40",
        className,
      )}
    >
      <RotateCcw className="h-4 w-4" strokeWidth={2} />
      {t("resetDemo")}
    </button>
  );
}
