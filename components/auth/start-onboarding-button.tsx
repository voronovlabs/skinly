"use client";

import { useTransition } from "react";
import { startOnboardingAction } from "@/app/actions/auth";
import { buttonClassName } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * StartOnboardingButton — client wrapper над `startOnboardingAction`.
 * См. комментарий в guest-button.tsx — почему client.
 */

export interface StartOnboardingButtonProps {
  label: string;
  className?: string;
}

export function StartOnboardingButton({
  label,
  className,
}: StartOnboardingButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={() =>
        startTransition(async () => {
          await startOnboardingAction();
        })
      }
      className="w-full"
      data-cta="start-onboarding"
    >
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonClassName({ variant: "primary" }), className)}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}
