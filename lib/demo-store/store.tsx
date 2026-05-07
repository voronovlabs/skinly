"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import {
  EMPTY_DEMO_STATE,
  readDemoState,
  writeDemoState,
} from "./storage";
import type {
  DemoAction,
  DemoScan,
  DemoSkinProfile,
  DemoState,
} from "./types";

/**
 * React Context для demo state.
 *
 * Жизненный цикл:
 *   1. SSR / первый client render — `EMPTY_DEMO_STATE` (чтобы не было hydration mismatch).
 *   2. После mount — читаем localStorage и dispatch("hydrate"). Поднимаем `hydrated = true`.
 *   3. Любое изменение state — пишется обратно в localStorage эффектом.
 *
 * `hydrated` нужен компонентам, которые хотят показывать skeleton/empty
 * до момента, когда мы знаем, что в localStorage реально лежит.
 */

/* ───────── Reducer ───────── */

const SCAN_DEDUPE_MS = 30_000;
const HISTORY_LIMIT = 100;

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "hydrate":
      return action.payload;

    case "setSkinProfile":
      return { ...state, skinProfile: action.payload };

    case "toggleFavorite": {
      const id = action.payload;
      const exists = state.favoriteIds.includes(id);
      return {
        ...state,
        favoriteIds: exists
          ? state.favoriteIds.filter((x) => x !== id)
          : [...state.favoriteIds, id],
      };
    }

    case "addScan": {
      const last = state.history[0];
      if (
        last &&
        last.productId === action.payload.productId &&
        Date.now() - last.scannedAt < SCAN_DEDUPE_MS
      ) {
        return state;
      }
      const scan: DemoScan = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        productId: action.payload.productId,
        scannedAt: Date.now(),
      };
      return {
        ...state,
        history: [scan, ...state.history].slice(0, HISTORY_LIMIT),
      };
    }

    case "toggleCompare": {
      const id = action.payload;
      const exists = state.compareIds.includes(id);
      return {
        ...state,
        compareIds: exists
          ? state.compareIds.filter((x) => x !== id)
          : [...state.compareIds, id],
      };
    }

    case "reset":
      return EMPTY_DEMO_STATE;
  }
}

/* ───────── Context ───────── */

interface DemoStoreContextValue {
  state: DemoState;
  hydrated: boolean;
  setSkinProfile: (profile: DemoSkinProfile) => void;
  toggleFavorite: (productId: string) => void;
  addScan: (productId: string) => void;
  toggleCompare: (productId: string) => void;
  reset: () => void;
  isFavorite: (productId: string) => boolean;
  isInCompare: (productId: string) => boolean;
}

const DemoStoreContext = createContext<DemoStoreContextValue | null>(null);

/* ───────── Provider ───────── */

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY_DEMO_STATE);
  const [hydrated, setHydrated] = useState(false);

  // 1. Hydrate from localStorage on mount.
  useEffect(() => {
    const initial = readDemoState();
    dispatch({ type: "hydrate", payload: initial });
    setHydrated(true);
  }, []);

  // 2. Persist on every change (only after hydration).
  useEffect(() => {
    if (hydrated) writeDemoState(state);
  }, [state, hydrated]);

  // 3. Cross-tab sync (опционально, но крайне дешёво).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "skinly:demo:v1" && e.newValue) {
        try {
          const next = JSON.parse(e.newValue) as DemoState;
          dispatch({ type: "hydrate", payload: next });
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setSkinProfile = useCallback((profile: DemoSkinProfile) => {
    dispatch({ type: "setSkinProfile", payload: profile });
  }, []);
  const toggleFavorite = useCallback((productId: string) => {
    dispatch({ type: "toggleFavorite", payload: productId });
  }, []);
  const addScan = useCallback((productId: string) => {
    dispatch({ type: "addScan", payload: { productId } });
  }, []);
  const toggleCompare = useCallback((productId: string) => {
    dispatch({ type: "toggleCompare", payload: productId });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  const value = useMemo<DemoStoreContextValue>(
    () => ({
      state,
      hydrated,
      setSkinProfile,
      toggleFavorite,
      addScan,
      toggleCompare,
      reset,
      isFavorite: (id) => state.favoriteIds.includes(id),
      isInCompare: (id) => state.compareIds.includes(id),
    }),
    [
      state,
      hydrated,
      setSkinProfile,
      toggleFavorite,
      addScan,
      toggleCompare,
      reset,
    ],
  );

  return (
    <DemoStoreContext.Provider value={value}>
      {children}
    </DemoStoreContext.Provider>
  );
}

/* ───────── Hooks ───────── */

export function useDemoStore(): DemoStoreContextValue {
  const ctx = useContext(DemoStoreContext);
  if (!ctx) {
    throw new Error("useDemoStore must be used inside <DemoStoreProvider>");
  }
  return ctx;
}
