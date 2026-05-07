"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock, Heart, Home, ScanLine, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * BottomNav — фиксированная нижняя навигация (`.bottom-nav` в прототипе).
 *
 * 5 слотов:
 *   [Home] [History]  «FAB Scanner»  [Favorites] [Profile]
 *
 * Phase 3: лейблы вкладок берутся из messages/*.json (`nav.*`).
 */

export type BottomNavTab = "dashboard" | "history" | "favorites" | "profile";

export interface BottomNavProps {
  active: BottomNavTab;
  className?: string;
}

interface NavLinkConfig {
  tab: BottomNavTab;
  href: string;
  Icon: LucideIcon;
  /** Ключ перевода в namespace `nav`. */
  i18nKey: "home" | "history" | "favorites" | "profile";
}

const LEFT_LINKS: ReadonlyArray<NavLinkConfig> = [
  { tab: "dashboard", href: "/dashboard", Icon: Home, i18nKey: "home" },
  { tab: "history", href: "/history", Icon: Clock, i18nKey: "history" },
];

const RIGHT_LINKS: ReadonlyArray<NavLinkConfig> = [
  { tab: "favorites", href: "/favorites", Icon: Heart, i18nKey: "favorites" },
  { tab: "profile", href: "/profile", Icon: User, i18nKey: "profile" },
];

export function BottomNav({ active, className }: BottomNavProps) {
  const t = useTranslations("nav");

  return (
    <nav
      aria-label={t("home")}
      className={cn(
        "fixed bottom-0 left-1/2 z-50 -translate-x-1/2",
        "flex w-full max-w-[480px] items-center justify-around",
        "border-t border-black/5 bg-pure-white/90 px-2 pb-6 pt-3 backdrop-blur-xl",
        className,
      )}
    >
      {LEFT_LINKS.map((link) => (
        <NavItem
          key={link.tab}
          {...link}
          label={t(link.i18nKey)}
          active={link.tab === active}
        />
      ))}

      {/* Center FAB — scanner */}
      <div className="relative -top-5">
        <Link
          href="/scan"
          aria-label={t("scan")}
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full",
            "bg-graphite text-pure-white shadow-soft-lg",
            "transition active:scale-95 animate-skinly-pulse",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender-deep/50 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-white",
          )}
        >
          <ScanLine className="h-6 w-6" strokeWidth={2.5} />
        </Link>
      </div>

      {RIGHT_LINKS.map((link) => (
        <NavItem
          key={link.tab}
          {...link}
          label={t(link.i18nKey)}
          active={link.tab === active}
        />
      ))}
    </nav>
  );
}

interface NavItemProps {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
}

function NavItem({ href, label, Icon, active }: NavItemProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-[60px] flex-col items-center gap-1 text-[10px] font-medium tracking-wide",
        "transition-colors duration-150 ease-out",
        active ? "text-lavender-deep" : "text-light-graphite hover:text-graphite",
      )}
    >
      <Icon className="h-6 w-6" strokeWidth={2} />
      <span>{label}</span>
    </Link>
  );
}
