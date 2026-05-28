import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { DemoStoreProvider } from "@/lib/demo-store";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Skinly — AI beauty assistant",
    template: "%s · Skinly",
  },
  description:
    "Сканируйте косметику. Получайте персональный анализ состава. Понимайте, что вы наносите на кожу.",
  applicationName: "Skinly",
  authors: [{ name: "Skinly" }],
  keywords: [
    "Skinly",
    "косметика",
    "ИИ",
    "анализ состава",
    "штрихкод",
    "skincare",
    "INCI",
  ],
  icons: {
    icon: "/favicon.ico",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#FAF9F7",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="bg-warm-white text-graphite antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DemoStoreProvider>{children}</DemoStoreProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
