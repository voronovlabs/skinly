"use client";

import { useTransition } from "react";
import { logoutAction } from "@/app/actions/auth";
import { buttonClassName } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * LogoutButton — client wrapper над `logoutAction`.
 * См. комментарий в guest-button.tsx.
 */

export interface LogoutButtonProps {
  label: string;
  className?: string;
}

export function LogoutButton({ label, className }: LogoutButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={() =>
        startTransition(async () => {
          await logoutAction();
        })
      }
      className="w-full"
      data-cta="logout"
    >
      <button
        type="submit"
        disabled={pending}
        className={cn(
          buttonClassName({ variant: "secondary" }),
          "!text-error-deep !border-error-blush hover:!bg-error-blush/30",
          className,
        )}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}
