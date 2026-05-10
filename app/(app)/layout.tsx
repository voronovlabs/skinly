"use client";

import { usePathname } from "next/navigation";
import { BottomNav, type BottomNavTab } from "@/components/layout";
import { GuestMigrator } from "@/components/auth";

/**
 * Layout для приватных экранов (Dashboard / History / Favorites / Profile).
 * Автоматически подсвечивает активную вкладку BottomNav на основе pathname.
 *
 * /scan и /product/[barcode] лежат вне этой группы — у них свой UX (фуллскрин,
 * action-bar) и BottomNav им не нужен.
 *
 * Phase 11: <GuestMigrator /> сидит здесь невидимым компонентом.
 *   - для guest action no-op'нет, ничего не происходит;
 *   - для user'а на mount переносит demo state в БД и `router.refresh()`.
 */

function tabFromPath(pathname: string): BottomNavTab {
  if (pathname.startsWith("/history")) return "history";
  if (pathname.startsWith("/favorites")) return "favorites";
  if (pathname.startsWith("/profile")) return "profile";
  return "dashboard";
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <>
      {children}
      <BottomNav active={tabFromPath(pathname)} />
      <GuestMigrator />
    </>
  );
}
