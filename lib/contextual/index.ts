/**
 * Contextual recommendations — barrel.
 *
 * Public API:
 *   - greetingPart(now?)      → "morning" | "day" | "evening" | "night"
 *   - greetingPartFromHour(h)
 *   - greetingI18nKey(part)   → i18n key для перевода
 *   - requestGeolocation()    → coords | null
 *   - fetchWeatherSnapshot()  → WeatherSnapshot | null
 *   - readCachedWeather() / cacheWeather()
 *   - weatherCondition(code)  → "clear" | "rain" | ...
 *   - pickRecommendation(ctx) → RecommendationDef
 */

export {
  greetingPart,
  greetingPartFromHour,
  greetingI18nKey,
} from "./greeting";

export {
  requestGeolocation,
  fetchWeatherSnapshot,
  readCachedWeather,
  cacheWeather,
  weatherCondition,
} from "./weather";
export type { GeoCoords } from "./weather";

export {
  pickRecommendation,
  RECOMMENDATION_RULES,
} from "./recommendations";
export type { RecommendationContext } from "./recommendations";

export type {
  DayPart,
  WeatherSnapshot,
  WeatherCondition,
  ContextualProfile,
  RecommendationDef,
} from "./types";
