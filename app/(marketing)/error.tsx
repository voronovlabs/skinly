"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonClassName } from "@/components/ui";

/**
 * Error boundary для (marketing)-группы (welcome / preview).
 *
 * Назначение: если server action на /welcome (StartOnboardingButton /
 * GuestButton) внезапно упадёт — увидим ошибку, а не молчание. Без этого
 * boundary Next.js по умолчанию покажет generic 500-страницу без деталей.
 */

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // В дев-консоли увидим стек.
    console.error("[skinly/(marketing)] action or render failed:", error);
  }, [error]);

  return (
    <main
      className="
        relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col
        items-center justify-center bg-warm-white px-6 py-12 text-center
      "
    >
      <div className="text-2xl font-medium tracking-tight text-graphite mb-6">
        Skinly
      </div>

      <h1 className="text-h1 text-graphite mb-3">Что-то пошло не так</h1>
      <p className="text-body-sm text-muted-graphite mb-2">
        {error.message || "Неизвестная ошибка"}
      </p>
      {error.digest && (
        <p className="text-caption text-light-graphite mb-6">
          digest: {error.digest}
        </p>
      )}

      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={() => reset()}
          className={buttonClassName({ variant: "primary" })}
        >
          Попробовать снова
        </button>
        <Link href="/welcome" className={buttonClassName({ variant: "secondary" })}>
          Вернуться на главную
        </Link>
      </div>
    </main>
  );
}
