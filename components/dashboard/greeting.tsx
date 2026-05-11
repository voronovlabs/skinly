"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { greetingPart, greetingI18nKey, type DayPart } from "@/lib/contextual";

/**
 * DashboardGreeting — client.
 *
 * SSR безопасен: первый рендер использует нейтральный `day` greeting
 * (соответствует server output). После mount пересчитываем по реальному
 * локальному времени пользователя — без визуальных «прыжков»:
 *   - тот же тег / типографика
 *   - меняется только текст
 *
 * Тон greetings уровня Apple Health / Headspace — без восклицаний:
 *   "Доброе утро" / "Good morning" / "Добрый день" / "Спокойного вечера" / ...
 */

export interface DashboardGreetingProps {
  /** Имя пользователя — если есть, кладём в headline. */
  name?: string | null;
  /** Fallback-headline (когда имени нет): "yourOverview" key. */
  fallbackHeadline: string;
}

export function DashboardGreeting({
  name,
  fallbackHeadline,
}: DashboardGreetingProps) {
  // next-intl типизирует `t` сильно (узкие keys); мы передаём dotted key
  // как строку, поэтому кастуем к лёгкой сигнатуре.
  const t = useTranslations() as unknown as (key: string) => string;

  // SSR: фиксированный `day` (нейтральный для всех таймзон). Client:
  // пересчитываем при монтировании, чтобы избежать hydration mismatch.
  const [part, setPart] = useState<DayPart>("day");

  useEffect(() => {
    setPart(greetingPart());
    // Не обновляем при ребайнде раз в минуту — мини-обновление при mount'е
    // достаточно. Если страница висит часами, юзер увидит «День» вместо
    // «Утро» — это ок для дашборда. Будет нужно — добавим setInterval.
  }, []);

  const greetingText = t(greetingI18nKey(part));
  const headline = name?.trim() ? name : fallbackHeadline;

  return (
    <div>
      <p className="text-caption text-muted-graphite">{greetingText}</p>
      <h1 className="text-h1 text-graphite mt-1">{headline}</h1>
    </div>
  );
}
