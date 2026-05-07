import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { DemoStoreProvider } from "@/lib/demo-store";
import "./globals.css";

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
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="bg-warm-white text-graphite antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DemoStoreProvider>{children}</DemoStoreProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
