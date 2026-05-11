/**
 * Contextual recommendations — types.
 *
 * Phase 12: lightweight domain для дашборд-header'а. Без UI, без I/O в самой
 * этой папке (кроме fetch'а в weather.ts).
 *
 * Все строки наружу — i18n keys + args, перевод делает компонент.
 */

import type {
  AvoidedIngredient,
  SensitivityLevel,
  SkinConcern,
  SkinType,
  SkincareGoal,
} from "@/lib/types";

/** Время дня — для greeting'а и для контекстных правил. */
export type DayPart = "morning" | "day" | "evening" | "night";

/**
 * Lightweight snapshot погоды. Достаточно для рекомендаций — больше нам
 * хранить не нужно, и больше не запрашиваем у Open-Meteo.
 */
export interface WeatherSnapshot {
  /** °C */
  temperatureC: number;
  /** 0..100 */
  humidity: number;
  /** Open-Meteo UV-index в часе. Может отсутствовать (ночью). */
  uvIndex: number | null;
  /** м/с */
  windSpeedMs: number;
  /**
   * Open-Meteo weather_code (WMO). Упрощённый набор кодов; см. {@link weatherCondition}.
   */
  weatherCode: number;
  /** UNIX ms — когда снимок снят. Для cache-stale проверки. */
  fetchedAt: number;
  /** Координаты для отладки, не хранятся. */
  lat: number;
  lon: number;
}

/** Обобщённые категории погоды, на которых ловят правила. */
export type WeatherCondition =
  | "clear"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";

/**
 * «Минимальный» профиль для рекомендаций — lowercase id'ы, как в demo store
 * и в compatibility-engine. Все поля nullable.
 */
export interface ContextualProfile {
  skinType: SkinType | null;
  sensitivity: SensitivityLevel | null;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal | null;
}

/**
 * Готовая рекомендация. Возвращается из `pickRecommendation(...)`.
 * UI рендерит `<icon> {t(key, args)}`.
 */
export interface RecommendationDef {
  /** Стабильный id для отладки и (в будущем) telemetry. */
  id: string;
  /** i18n key, например `dashboard.tips.highUv`. */
  key: string;
  /** Аргументы для ICU. Обычно нет. */
  args?: Record<string, string | number>;
  /**
   * Простой эмодзи-марк перед текстом. Сохраняем стиль 💡, но позволяем
   * правилам выбирать более точный значок (🌞, 🌬️, 🌙, ❄️).
   */
  icon: string;
  /**
   * Приоритет (для отладки). Чем больше — тем выше. Pick всегда берёт
   * первый matched по порядку — поле справочное.
   */
  priority: number;
}
