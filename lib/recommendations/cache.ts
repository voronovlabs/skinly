/**
 * In-memory TTL cache для НЕперсонализированных рекомендаций (SERVER-ONLY).
 *
 * Кэшируем ТОЛЬКО запросы без subject (нет userId и нет anonymousId):
 * выдача для них детерминирована по (barcode, limit, profile) — persist'ить
 * нечего, а DM-слой обновляется редко (materialized views).
 *
 * Персонализированные запросы (subject != null) НЕ кэшируются вообще:
 * preference меняется после каждого события, а stale-выдача для
 * залогиненного пользователя заметнее, чем лишние 200мс.
 *
 * Ограничения by design:
 *   - процесс-локальный (при нескольких инстансах web у каждого свой кэш — ок);
 *   - MAX_ENTRIES с LRU-вытеснением: hit делает delete+set, поэтому порядок
 *     итерации Map = access-order; перед вытеснением сначала свипаются expired;
 *   - записи иммутабельны (Object.freeze при записи) — кэш шарит один массив
 *     между всеми читателями, случайная мутация ловится сразу, а не портит
 *     выдачу всем на TTL;
 *   - TTL по умолчанию 10 минут, override через RECO_CACHE_TTL_MS;
 *   - отключение целиком: RECO_CACHE=0.
 */

import type { RecommendationItem } from "./types";
import type { SkinProfileSummaryLike } from "@/lib/compatibility";

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 минут
const MAX_ENTRIES = 500;

interface CacheEntry {
  expiresAt: number;
  items: RecommendationItem[];
}

const store = new Map<string, CacheEntry>();

function ttlMs(): number {
  const raw = Number(process.env.RECO_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function cacheEnabled(): boolean {
  return process.env.RECO_CACHE !== "0";
}

/** Стабильный ключ профиля (или "none"). Порядок массивов нормализуем. */
export function profileCacheKey(p: SkinProfileSummaryLike | null): string {
  if (!p) return "none";
  return [
    p.skinType ?? "",
    p.sensitivity ?? "",
    p.goal ?? "",
    [...(p.concerns ?? [])].sort().join(","),
    [...(p.avoidedList ?? [])].sort().join(","),
  ].join("|");
}

export function recoCacheKey(
  barcode: string | null,
  limit: number,
  profile: SkinProfileSummaryLike | null,
): string {
  return `${barcode ?? "-"}::${limit}::${profileCacheKey(profile)}`;
}

export function recoCacheGet(key: string): RecommendationItem[] | null {
  if (!cacheEnabled()) return null;
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  // LRU touch: re-insert переносит ключ в конец порядка итерации Map,
  // так что keys().next() при вытеснении отдаёт least-recently-used.
  store.delete(key);
  store.set(key, entry);
  return entry.items;
}

export function recoCacheSet(key: string, items: RecommendationItem[]): void {
  if (!cacheEnabled()) return;
  // Вытесняем только если добавляем НОВЫЙ ключ при заполненном store
  // (перезапись существующего размер не меняет).
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    // Сначала выкидываем протухшие (иначе живой LRU-ключ вытесняется,
    // пока в store лежат мёртвые записи), затем — least-recently-used.
    const now = Date.now();
    for (const [k, e] of store) {
      if (e.expiresAt < now) store.delete(k);
    }
    while (store.size >= MAX_ENTRIES) {
      const lru = store.keys().next().value;
      if (lru === undefined) break;
      store.delete(lru);
    }
  }
  // Deep-freeze копии: один массив шарится между всеми читателями TTL-окна.
  // Мутация (sort/splice/push в reasons) бросит TypeError в strict mode —
  // громкий баг вместо тихой порчи кэша. Cast обоснован: форма не меняется.
  const frozen = Object.freeze(
    items.map((i) =>
      Object.freeze({ ...i, reasons: Object.freeze([...i.reasons]) }),
    ),
  ) as unknown as RecommendationItem[];
  store.set(key, { expiresAt: Date.now() + ttlMs(), items: frozen });
}
