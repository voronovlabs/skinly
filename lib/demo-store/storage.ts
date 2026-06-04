import type { DemoState } from "./types";

/**
 * Чтение/запись demo state в localStorage с версионированием и
 * защитой от поломанного JSON.
 */

export const DEMO_STORAGE_KEY = "skinly:demo:v1";
export const DEMO_STATE_VERSION = 1;

export const EMPTY_DEMO_STATE: DemoState = {
  version: DEMO_STATE_VERSION,
  skinProfile: null,
  favoriteIds: [],
  history: [],
  compareIds: [],
};

export function readDemoState(): DemoState {
  if (typeof window === "undefined") return EMPTY_DEMO_STATE;
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return EMPTY_DEMO_STATE;
    const parsed = JSON.parse(raw) as Partial<DemoState> | null;
    if (!parsed || parsed.version !== DEMO_STATE_VERSION) {
      return EMPTY_DEMO_STATE;
    }
    // Defensive defaults — в случае частично сохранённого state.
    return {
      version: DEMO_STATE_VERSION,
      skinProfile: parsed.skinProfile ?? null,
      favoriteIds: Array.isArray(parsed.favoriteIds) ? parsed.favoriteIds : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      compareIds: Array.isArray(parsed.compareIds) ? parsed.compareIds : [],
    };
  } catch {
    return EMPTY_DEMO_STATE;
  }
}

export function writeDemoState(state: DemoState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Quota / private mode и т.п. — логируем, но не падаем.
    console.warn("[skinly/demo-store] localStorage write failed:", e);
  }
}

export function clearDemoState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    /* noop */
  }
}
