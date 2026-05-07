"use client";

import { useTransition } from "react";
import { loginAsGuestAction } from "@/app/actions/auth";
import { buttonClassName } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * GuestButton — client wrapper над server action `loginAsGuestAction`.
 *
 * Почему client + form action (а не серверный компонент с form action):
 *   В Next 15 + React 19 server-rendered формы со ссылкой на server action
 *   надёжно работают только если ВЕСЬ их путь — RSC. На /welcome дерево
 *   обёрнуто в `NextIntlClientProvider` + `DemoStoreProvider` (оба "use client"),
 *   поэтому форма попадает в client-tree, и React 19 ожидает client-side
 *   привязки action. Делаем явный client wrapper с useTransition + form action —
 *   submit гарантированно идёт через React's form-runtime.
 */

export interface GuestButtonProps {
  label: string;
  className?: string;
}

export function GuestButton({ label, className }: GuestButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await loginAsGuestAction();
        })
      }
      className="w-full"
      data-cta="guest"
    >
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonClassName({ variant: "secondary" }), className)}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}
