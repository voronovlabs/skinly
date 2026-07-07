/**
 * Timing-инструментация для recommendations pipeline (SERVER-ONLY).
 *
 * Включается ТОЛЬКО через env RECO_TIMING=1. В выключенном состоянии —
 * zero-cost noop (ни performance.now(), ни аллокаций на этапах).
 *
 * Использование:
 *   const t = createRecoTimer();
 *   const seed = await t.time("getRecoSeed", () => getRecoSeed(barcode));
 *   t.flush("barcode=123 mode=seed");   // одна строка со всеми этапами
 *
 * Формат лога:
 *   [reco-timing] total=142.3ms auth=1.1ms getRecoSeed=18.4ms ... | meta
 */

export interface RecoTimer {
  readonly enabled: boolean;
  /** Замерить async-этап. */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Замерить синхронный этап (JS scoring, serialization). */
  timeSync<T>(label: string, fn: () => T): T;
  /** Записать уже измеренную длительность (мс). */
  mark(label: string, ms: number): void;
  /** Приписать meta-строку к будущему flush (вызывается из service). */
  note(meta: string): void;
  /** Вывести одну строку со всеми этапами + total (от создания таймера). */
  flush(meta?: string): void;
}

const NOOP_TIMER: RecoTimer = {
  enabled: false,
  time: (_label, fn) => fn(),
  timeSync: (_label, fn) => fn(),
  mark: () => {},
  note: () => {},
  flush: () => {},
};

class EnabledTimer implements RecoTimer {
  readonly enabled = true;
  private readonly startedAt = performance.now();
  private readonly stages: [string, number][] = [];
  private meta = "";

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.stages.push([label, performance.now() - t0]);
    }
  }

  timeSync<T>(label: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.stages.push([label, performance.now() - t0]);
    }
  }

  mark(label: string, ms: number): void {
    this.stages.push([label, ms]);
  }

  note(meta: string): void {
    this.meta = meta;
  }

  flush(meta?: string): void {
    const total = performance.now() - this.startedAt;
    const parts = this.stages
      .map(([l, ms]) => `${l}=${ms.toFixed(1)}ms`)
      .join(" ");
    const m = meta ?? this.meta;
    // eslint-disable-next-line no-console
    console.log(
      `[reco-timing] total=${total.toFixed(1)}ms ${parts}${m ? ` | ${m}` : ""}`,
    );
  }
}

export function createRecoTimer(): RecoTimer {
  return process.env.RECO_TIMING === "1" ? new EnabledTimer() : NOOP_TIMER;
}
