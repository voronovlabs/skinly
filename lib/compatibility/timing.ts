/**
 * Timing-инструментация для блока «Подходимость товара» (SERVER-ONLY по
 * использованию, но модуль pure — без БД/env-side-effects кроме чтения флага).
 *
 * Включается ТОЛЬКО через env COMPAT_TIMING=1. Выключено → zero-cost noop.
 *
 * Отличие от reco-таймера: кроме этапов пишет ОБЪЁМНЫЕ метрики (count) —
 * число ингредиентов, canonical facts, property rows, байты ответа и т.п.
 *
 * Формат лога (одна строка на запрос/страницу):
 *   [compat-timing] <scope> total=48.1ms auth=1.2ms productLoad=12.3ms ...
 *     | n: ingredients=32 facts=27 bytes=1840 | meta
 */

export interface CompatTimer {
  readonly enabled: boolean;
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  timeSync<T>(label: string, fn: () => T): T;
  /** Записать уже измеренную длительность (мс). */
  mark(label: string, ms: number): void;
  /** Объёмная метрика (число ингредиентов, байты, строки и т.п.). */
  count(label: string, n: number): void;
  /** Meta-строка (barcode, source, cache hit/miss …). */
  note(meta: string): void;
  /** Одна строка: total + этапы + counts + meta. */
  flush(scope?: string): void;
}

const NOOP: CompatTimer = {
  enabled: false,
  time: (_l, fn) => fn(),
  timeSync: (_l, fn) => fn(),
  mark: () => {},
  count: () => {},
  note: () => {},
  flush: () => {},
};

class EnabledCompatTimer implements CompatTimer {
  readonly enabled = true;
  private readonly startedAt = performance.now();
  /** Кумулятивно по label (batch зовёт один этап N раз → одна строка). */
  private readonly stages = new Map<string, number>();
  private readonly counts = new Map<string, number>();
  private metas: string[] = [];

  private add(label: string, ms: number): void {
    this.stages.set(label, (this.stages.get(label) ?? 0) + ms);
  }

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.add(label, performance.now() - t0);
    }
  }

  timeSync<T>(label: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.add(label, performance.now() - t0);
    }
  }

  mark(label: string, ms: number): void {
    this.add(label, ms);
  }

  count(label: string, n: number): void {
    this.counts.set(label, (this.counts.get(label) ?? 0) + n);
  }

  note(meta: string): void {
    // Дедуп + мягкий cap: batch-путь может звать note на каждый item.
    if (this.metas.length >= 10 || this.metas.includes(meta)) return;
    this.metas.push(meta);
  }

  flush(scope = "compat"): void {
    const total = performance.now() - this.startedAt;
    const stages = [...this.stages]
      .map(([l, ms]) => `${l}=${ms.toFixed(1)}ms`)
      .join(" ");
    const counts = this.counts.size
      ? ` | n: ${[...this.counts].map(([l, n]) => `${l}=${n}`).join(" ")}`
      : "";
    const meta = this.metas.length ? ` | ${this.metas.join(" ")}` : "";
    // eslint-disable-next-line no-console
    console.log(
      `[compat-timing] ${scope} total=${total.toFixed(1)}ms ${stages}${counts}${meta}`,
    );
  }
}

export function createCompatTimer(): CompatTimer {
  return process.env.COMPAT_TIMING === "1" ? new EnabledCompatTimer() : NOOP;
}

/** Noop-инстанс для дефолтных параметров (не аллоцируем на каждый вызов). */
export const NOOP_COMPAT_TIMER: CompatTimer = NOOP;
