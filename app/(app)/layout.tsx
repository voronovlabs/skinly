"use client";

import { usePathname } from "next/navigation";
import { BottomNav, type BottomNavTab } from "@/components/layout";

/**
 * Layout для приватных экранов (Dashboard / History / Favorites / Profile).
 * Автоматически подсвечивает активную вкладку BottomNav на основе pathname.
 *
 * /scan и /product/[barcode] лежат вне этой группы — у них свой UX (фуллскрин,
 * action-bar) и BottomNav им не нужен.
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
    </>
  );
}
