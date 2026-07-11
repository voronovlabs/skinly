/**
 * In-memory TTL-кэш ответа GET /api/v1/products/:id/compatibility.
 *
 * Ключ: idOrBarcode :: locale :: profile-fingerprint. Результат детерминирован
 * между refresh'ами DM-слоя (dm.* обновляется редко) и изменениями каталога,
 * поэтому короткий TTL безопасен. Модель — копия reco-кэша:
 *   - процесс-локальный, MAX_ENTRIES с LRU-вытеснением (hit = delete+set);
 *   - записи Object.freeze — случайная мутация громко падает, а не портит кэш;
 *   - TTL 10 мин по умолчанию, override COMPAT_CACHE_TTL_MS;
 *   - отключение целиком: COMPAT_CACHE=0.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const store = new Map<string, CacheEntry<unknown>>();

function ttlMs(): number {
  const raw = Number(process.env.COMPAT_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function enabled(): boolean {
  return process.env.COMPAT_CACHE !== "0";
}

/** Стабильный fingerprint профиля из query (порядок массивов нормализуем). */
export function profileFingerprint(p: {
  skinType?: string | null;
  sensitivity?: string | null;
  goal?: string | null;
  concerns?: readonly string[];
  avoidedList?: readonly string[];
} | null): string {
  if (!p) return "none";
  return [
    p.skinType ?? "",
    p.sensitivity ?? "",
    p.goal ?? "",
    [...(p.concerns ?? [])].sort().join(","),
    [...(p.avoidedList ?? [])].sort().join(","),
  ].join("|");
}

export function compatCacheKey(
  idOrBarcode: string,
  locale: string,
  fingerprint: string,
): string {
  return `${idOrBarcode}::${locale}::${fingerprint}`;
}

export function compatCacheGet<T>(key: string): T | null {
  if (!enabled()) return null;
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  // LRU touch.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

export function compatCacheSet<T extends object>(key: string, value: T): void {
  if (!enabled()) return;
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
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
  store.set(key, { expiresAt: Date.now() + ttlMs(), value: Object.freeze(value) });
}
