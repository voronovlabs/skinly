/**
 * Contextual recommendations — declarative rule list.
 *
 * Принцип:
 *   - Каждое правило проверяет состояние и возвращает `RecommendationDef`
 *     (либо `null`).
 *   - `pickRecommendation(ctx)` идёт по списку в порядке приоритета и
 *     возвращает первое сработавшее правило. Это даёт детерминированную
 *     понятную fallback-цепочку.
 *   - Все тексты — только i18n keys. Конкретные строки лежат в
 *     `messages/*.json` под `dashboard.tips.*`.
 *
 * Тон: calm, premium, mobile-native. Короткие фразы, без императива «должны»
 * и без жаргона. Хорошо вписывается в стиль Apple Health / Oura / Headspace.
 *
 * Будущая расширяемость: добавление правила = новый объект в `RULES`.
 * Ничего больше менять не нужно.
 */

import type {
  ContextualProfile,
  DayPart,
  RecommendationDef,
  WeatherSnapshot,
} from "./types";
import { weatherCondition } from "./weather";

/** Контекст, который видят правила. */
export interface RecommendationContext {
  /** Локальное время пользователя — для time-based правил. */
  dayPart: DayPart;
  /** Снимок погоды, либо null (геолокация отказана / fetch упал). */
  weather: WeatherSnapshot | null;
  /** Профиль кожи, либо «пустой» для onboarding'нувшегося гостя. */
  profile: ContextualProfile;
}

type Rule = {
  id: string;
  priority: number;
  evaluate: (ctx: RecommendationContext) => RecommendationDef | null;
};

function tip(
  id: string,
  key: string,
  icon: string,
  priority: number,
  args?: Record<string, string | number>,
): RecommendationDef {
  return { id, key, icon, priority, args };
}

/* ───────── Rules ───────── */

const RULES: readonly Rule[] = [
  /* 1) Экстремальный UV — самый высокий приоритет. */
  {
    id: "very_high_uv",
    priority: 100,
    evaluate: ({ weather, dayPart }) => {
      if (!weather || weather.uvIndex == null) return null;
      if (dayPart === "night") return null;
      if (weather.uvIndex >= 7) {
        return tip(
          "very_high_uv",
          "dashboard.tips.veryHighUv",
          "☀️",
          100,
          { uv: Math.round(weather.uvIndex) },
        );
      }
      return null;
    },
  },

  /* 2) Высокий UV. */
  {
    id: "high_uv",
    priority: 95,
    evaluate: ({ weather, dayPart }) => {
      if (!weather || weather.uvIndex == null) return null;
      if (dayPart === "night") return null;
      if (weather.uvIndex >= 4) {
        return tip("high_uv", "dashboard.tips.highUv", "☀️", 95, {
          uv: Math.round(weather.uvIndex),
        });
      }
      return null;
    },
  },

  /* 3) Жарко + влажно — лёгкие текстуры. */
  {
    id: "hot_humid",
    priority: 80,
    evaluate: ({ weather }) => {
      if (!weather) return null;
      if (weather.temperatureC >= 27 && weather.humidity >= 60) {
        return tip("hot_humid", "dashboard.tips.hotHumid", "💧", 80);
      }
      return null;
    },
  },

  /* 4) Холодно + сухой воздух — барьер. */
  {
    id: "cold_dry",
    priority: 75,
    evaluate: ({ weather }) => {
      if (!weather) return null;
      const cold = weather.temperatureC <= 5;
      const dryAir = weather.humidity <= 40;
      if (cold && dryAir) {
        return tip("cold_dry", "dashboard.tips.coldDry", "❄️", 75);
      }
      return null;
    },
  },

  /* 5) Сухой воздух (без сильного холода) — для сухого/чувствительного типа. */
  {
    id: "dry_air_sensitive",
    priority: 70,
    evaluate: ({ weather, profile }) => {
      if (!weather) return null;
      if (weather.humidity > 35) return null;
      const isDry = profile.skinType === "dry";
      const isSensitive =
        profile.sensitivity === "high" || profile.sensitivity === "reactive";
      if (!isDry && !isSensitive) return null;
      return tip(
        "dry_air_sensitive",
        "dashboard.tips.dryAirBarrier",
        "🌿",
        70,
      );
    },
  },

  /* 6) Сильный ветер. */
  {
    id: "windy",
    priority: 65,
    evaluate: ({ weather }) => {
      if (!weather) return null;
      if (weather.windSpeedMs >= 8) {
        return tip("windy", "dashboard.tips.windy", "🌬️", 65);
      }
      return null;
    },
  },

  /* 7) Снег / зимняя погода. */
  {
    id: "snowy",
    priority: 60,
    evaluate: ({ weather }) => {
      if (!weather) return null;
      const cond = weatherCondition(weather.weatherCode);
      if (cond === "snow") {
        return tip("snowy", "dashboard.tips.snowy", "❄️", 60);
      }
      return null;
    },
  },

  /* 8) Дождь / морось. */
  {
    id: "rainy",
    priority: 55,
    evaluate: ({ weather }) => {
      if (!weather) return null;
      const cond = weatherCondition(weather.weatherCode);
      if (cond === "rain" || cond === "drizzle") {
        return tip("rainy", "dashboard.tips.rainy", "🌧️", 55);
      }
      return null;
    },
  },

  /* 9) Поздний вечер / ночь — восстановление. */
  {
    id: "evening_repair",
    priority: 50,
    evaluate: ({ dayPart }) => {
      if (dayPart === "evening" || dayPart === "night") {
        return tip(
          "evening_repair",
          "dashboard.tips.eveningRepair",
          "🌙",
          50,
        );
      }
      return null;
    },
  },

  /* 10) Утро — мягкое начало. */
  {
    id: "morning_freshness",
    priority: 45,
    evaluate: ({ dayPart }) => {
      if (dayPart === "morning") {
        return tip(
          "morning_freshness",
          "dashboard.tips.morningFreshness",
          "🌅",
          45,
        );
      }
      return null;
    },
  },

  /* 11) Концерн redness → calming. */
  {
    id: "redness_focus",
    priority: 40,
    evaluate: ({ profile }) => {
      if (!profile.concerns.includes("redness")) return null;
      return tip("redness_focus", "dashboard.tips.calmingFocus", "🪷", 40);
    },
  },

  /* 12) Концерн acne → gentle consistency. */
  {
    id: "acne_focus",
    priority: 35,
    evaluate: ({ profile }) => {
      if (!profile.concerns.includes("acne")) return null;
      return tip("acne_focus", "dashboard.tips.gentleConsistency", "✨", 35);
    },
  },

  /* 13) Дневной fallback с профилем — SPF reminder, если уверены, что день. */
  {
    id: "daytime_spf",
    priority: 20,
    evaluate: ({ dayPart, weather }) => {
      if (dayPart !== "day" && dayPart !== "morning") return null;
      // Если погоды нет — мягко напоминаем про SPF.
      if (!weather) {
        return tip("daytime_spf", "dashboard.tips.dailySpf", "☀️", 20);
      }
      // Если облачно — тоже SPF, многие забывают.
      const cond = weatherCondition(weather.weatherCode);
      if (cond === "cloudy" || cond === "clear") {
        return tip("daytime_spf", "dashboard.tips.dailySpf", "☀️", 20);
      }
      return null;
    },
  },

  /* 14) Общий welcome — последний шанс. */
  {
    id: "welcome",
    priority: 0,
    evaluate: () => tip("welcome", "dashboard.tips.welcome", "💡", 0),
  },
];

/* ───────── Public API ───────── */

export function pickRecommendation(
  ctx: RecommendationContext,
): RecommendationDef {
  for (const r of RULES) {
    const hit = r.evaluate(ctx);
    if (hit) return hit;
  }
  // RULES всегда завершается welcome, но TS не знает — добавим safety.
  return tip("welcome", "dashboard.tips.welcome", "💡", 0);
}

/** Список всех правил — экспонируем для тестов / отладки. */
export const RECOMMENDATION_RULES = RULES;
