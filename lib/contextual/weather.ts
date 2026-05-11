/**
 * Open-Meteo client — lightweight, без SDK, без зависимостей.
 *
 * Open-Meteo:
 *   - бесплатный, без ключа
 *   - https://api.open-meteo.com/v1/forecast
 *   - mobile-friendly: маленький JSON, быстрый ответ
 *
 * Использование:
 *   - `requestGeolocation()` — promise с координатами или null.
 *   - `fetchWeatherSnapshot({lat,lon})` — promise с WeatherSnapshot или null.
 *   - `readCachedWeather()` / `cacheWeather()` — sessionStorage cache на 1 час
 *     (см. WEATHER_CACHE_MS).
 *
 * Все client-only функции — безопасны для SSR через guard'ы (`typeof window`).
 */

import type { WeatherCondition, WeatherSnapshot } from "./types";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CACHE_KEY = "skinly:weather:v1";
/** 1 час — большего нам не нужно, погода редко меняется в этом окне. */
const WEATHER_CACHE_MS = 60 * 60 * 1000;
/** Тайм-аут на fetch — мобильные сети могут «висеть». */
const FETCH_TIMEOUT_MS = 5000;
/** Тайм-аут на geolocation prompt. */
const GEO_TIMEOUT_MS = 6000;
/** Принимаем «свежую» координату до 10 минут давностью. */
const GEO_MAX_AGE_MS = 10 * 60 * 1000;

/* ───────── Geolocation ───────── */

export interface GeoCoords {
  lat: number;
  lon: number;
}

/**
 * Спросить у браузера геолокацию. Возвращает `null`, если:
 *   - API недоступен (SSR / старый браузер),
 *   - пользователь отказал,
 *   - тайм-аут / ошибка.
 *
 * Никогда не бросает наружу.
 */
export function requestGeolocation(): Promise<GeoCoords | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (!("geolocation" in navigator)) return resolve(null);

    let settled = false;
    const settle = (v: GeoCoords | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    // Safety timer — на iOS / WebKit geolocation иногда не зовёт коллбеки.
    const safety = setTimeout(() => settle(null), GEO_TIMEOUT_MS + 1500);

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(safety);
          settle({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
        },
        () => {
          clearTimeout(safety);
          settle(null);
        },
        {
          enableHighAccuracy: false,
          timeout: GEO_TIMEOUT_MS,
          maximumAge: GEO_MAX_AGE_MS,
        },
      );
    } catch {
      clearTimeout(safety);
      settle(null);
    }
  });
}

/* ───────── Fetch ───────── */

interface OpenMeteoCurrent {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  uv_index?: number;
  wind_speed_10m?: number;
  weather_code?: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

/**
 * Запросить погоду у Open-Meteo. Возвращает `null` при любых ошибках сети /
 * парсинга / тайм-аута — UI должен корректно деградировать.
 */
export async function fetchWeatherSnapshot(
  coords: GeoCoords,
): Promise<WeatherSnapshot | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", coords.lat.toFixed(3));
  url.searchParams.set("longitude", coords.lon.toFixed(3));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,uv_index,wind_speed_10m,weather_code",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      // Open-Meteo not authed; cache по умолчанию ок.
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = (await res.json()) as OpenMeteoResponse;
    const c = json.current;
    if (!c) return null;

    return {
      temperatureC: typeof c.temperature_2m === "number" ? c.temperature_2m : 18,
      humidity:
        typeof c.relative_humidity_2m === "number"
          ? c.relative_humidity_2m
          : 50,
      uvIndex: typeof c.uv_index === "number" ? c.uv_index : null,
      windSpeedMs:
        typeof c.wind_speed_10m === "number" ? c.wind_speed_10m : 0,
      weatherCode:
        typeof c.weather_code === "number" ? c.weather_code : 0,
      fetchedAt: Date.now(),
      lat: coords.lat,
      lon: coords.lon,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ───────── Cache (sessionStorage) ───────── */

export function readCachedWeather(): WeatherSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeatherSnapshot;
    if (Date.now() - parsed.fetchedAt > WEATHER_CACHE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function cacheWeather(snap: WeatherSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    /* private mode / disabled storage — silently ignore */
  }
}

/* ───────── WMO weather_code helpers ───────── */

/** Простая категоризация WMO-кодов. */
export function weatherCondition(code: number): WeatherCondition {
  // см. https://open-meteo.com/en/docs (Weather codes)
  if (code === 0) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 57) || (code >= 80 && code <= 82)) return "rain";
  if (code === 61 || code === 63 || code === 65) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  if (code === 95 || code === 96 || code === 99) return "thunderstorm";
  return "cloudy";
}
