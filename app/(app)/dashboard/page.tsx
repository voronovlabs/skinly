import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DashboardContent } from "./dashboard-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

export default function DashboardPage() {
  return <DashboardContent />;
}
