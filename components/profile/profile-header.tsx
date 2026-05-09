import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui";

/**
 * ProfileHeader — верх /profile: avatar, имя, email, бейдж плана.
 *
 * Phase 9: упрощён до серверо-нейтральной формы — принимает минимальный
 * объект без зависимостей от mock-типов. Подходит как для DB-User, так и
 * для гостевого MOCK_USER.
 */

export interface ProfileHeaderProps {
  user: {
    name: string | null;
    email: string;
    avatarEmoji: string;
    plan: "free" | "pro";
  };
  className?: string;
}

export function ProfileHeader({ user, className }: ProfileHeaderProps) {
  const t = useTranslations("profile");

  return (
    <header
      className={cn(
        "px-6 pt-12 pb-6 text-center",
        "bg-gradient-to-b from-soft-lavender to-warm-white",
        className,
      )}
    >
      <div
        aria-hidden
        className="
          mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full
          bg-pure-white text-[32px] shadow-soft-md
        "
      >
        {user.avatarEmoji}
      </div>
      <h2 className="text-h2 text-graphite">{user.name ?? user.email}</h2>
      <p className="text-body-sm text-muted-graphite">{user.email}</p>
      <Tag tone="active" className="mt-4">
        {user.plan === "free" ? t("freePlan") : t("proPlan")}
      </Tag>
    </header>
  );
}
