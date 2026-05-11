/**
 * Greeting helper — определяет, как поздороваться, исходя из локального
 * времени пользователя.
 *
 * Pure-функция: принимает `Date` (или используется `new Date()`), возвращает
 * `DayPart` — UI берёт перевод по i18n key `dashboard.greetings.<part>`.
 *
 * Серверный рендер не знает локального времени → отдаёт нейтральный greeting
 * (`day`). Клиент пересчитывает в `useEffect`, лёгкое визуальное обновление —
 * как у Apple Health / Headspace.
 */

import type { DayPart } from "./types";

/**
 * Возвращает `DayPart` по часу (0..23). По умолчанию использует текущее время.
 */
export function greetingPartFromHour(hour: number): DayPart {
  if (hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 17) return "day";
  if (hour < 22) return "evening";
  return "night";
}

export function greetingPart(now: Date = new Date()): DayPart {
  return greetingPartFromHour(now.getHours());
}

/** i18n key для greeting текста. UI делает `t(greetingKey(...))`. */
export function greetingI18nKey(part: DayPart): string {
  return `dashboard.greetings.${part}`;
}
