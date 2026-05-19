"use client";

import { usePathname } from "next/navigation";
import { BottomNav, type BottomNavTab } from "@/components/layout";
import { GuestMigrator } from "@/components/auth";
import { TutorialOverlay } from "@/components/tutorial";
import { useTutorial } from "@/lib/tutorial/use-tutorial";

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
  const { show, finish } = useTutorial();

  return (
    <>
      {children}
      <BottomNav active={tabFromPath(pathname)} />
      <GuestMigrator />
      {show && <TutorialOverlay onFinish={finish} />}
    </>
  );
}
