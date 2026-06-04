import type {
  AvoidedIngredient,
  SkinConcern,
  SkinType,
  SensitivityLevel,
  SkincareGoal,
} from "@/lib/types";

/**
 * Demo state — то, что хранится в `localStorage` ровно одной cookie-домена.
 * Этот же state провайдится через React Context (см. `store.tsx`).
 *
 * Phase 5: всё локально, без серверного зеркала. Phase 6+: при доступной БД
 * запишем skinProfile/favorites/scans в Postgres и подтянем оттуда.
 */

export interface DemoSkinProfile {
  skinType: SkinType | null;
  sensitivity: SensitivityLevel | null;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal | null;
  /** 0..100 — рассчитывается из числа заполненных шагов анкеты. */
  completion: number;
}

export interface DemoScan {
  /** Уникальный id записи (crypto.randomUUID). */
  id: string;
  productId: string;
  /** UNIX ms. */
  scannedAt: number;
}

export interface DemoState {
  /** Schema version: при разрыве совместимости — мигрируем или сбрасываем. */
  version: number;
  skinProfile: DemoSkinProfile | null;
  favoriteIds: string[];
  /** Свежие записи в начале массива. Лимит 100. */
  history: DemoScan[];
  compareIds: string[];
}

export type DemoAction =
  | { type: "hydrate"; payload: DemoState }
  | { type: "setSkinProfile"; payload: DemoSkinProfile }
  | { type: "toggleFavorite"; payload: string }
  | { type: "addScan"; payload: { productId: string } }
  | { type: "toggleCompare"; payload: string }
  | { type: "reset" };
