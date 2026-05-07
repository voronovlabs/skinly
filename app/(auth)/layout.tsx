import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Shared layout для /login и /register.
 * Стиль: тот же тёплый градиент, что и на /welcome — единая атмосфера.
 */

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("auth");

  return (
    <main
      className="
        relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col
        bg-gradient-to-br from-warm-white via-soft-beige to-soft-lavender
        px-6 pt-6 pb-12 animate-fade-in
      "
    >
      <header className="mb-6 flex items-center justify-between">
        <Link
          href="/welcome"
          aria-label={t("back")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-pure-white/40"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </Link>
        <span className="text-2xl font-medium tracking-tight text-graphite">
          Skinly
        </span>
        {/* Симметричный пустой блок для центрирования логотипа */}
        <span aria-hidden className="h-9 w-9" />
      </header>

      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </main>
  );
}
