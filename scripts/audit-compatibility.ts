/**
 * Аудит КАЧЕСТВА алгоритма совместимости (read-only, бизнес-логика не меняется).
 *
 * Прогоняет репрезентативную выборку товаров (стратификация категория ×
 * размер состава × recognizedRatio, детерминированный порядок md5(barcode·seed))
 * через фиксированную матрицу из 30 профильных сценариев и автоматически ищет
 * аномалии скоринга:
 *   A. Profile insensitivity   — concerns/goals не влияют на результат;
 *   B. Score contradiction     — excellent при warnings, high score без
 *                                profile-specific positives, low score без warnings;
 *   C. Avoided inconsistency   — avoided-флаг найден, а verdict/score не реагируют;
 *   D. Explanation quality     — пустые/дублирующиеся/generic-only объяснения;
 *   E. Monotonicity            — направленные пары сценариев (sensitivity ↑,
 *                                +avoided, +concern, +goal) не должны ПОВЫШАТЬ score;
 *   F. Distribution            — статистика по verdict/score/reason keys.
 *
 * Режимы:
 *   service-level (по умолчанию) — напрямую через resolveCompatibility
 *     (полные RuleHit/facts; DM-вход грузится 1 раз на товар);
 *   --url http://localhost:3000 — через GET /api/v1/products/:b/compatibility
 *     (контрактный прогон; positives/warnings там усечены top-4, поэтому
 *     фактозависимые проверки помечаются как ограниченные).
 *
 * Запуск:
 *   npm run audit:compat
 *   npm run audit:compat -- --url http://localhost:3000
 *   npm run audit:compat -- --limit 100 --runs 1 --seed skinly-audit-v1
 *
 * Выход: reports/compat-audit-{summary.md, results.csv, anomalies.csv, results.json}
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveCompatibility } from "@/lib/compatibility/resolve-compatibility";
import { getDmCompatibilityInput } from "@/lib/db/repositories/dm-products";
import { isDmCompatibilityEnabled } from "@/lib/flags";
import {
  emptyProfile,
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import type { RuleHit } from "@/lib/compatibility/types";

/* ───────────────────────── CLI ───────────────────────── */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const ARG_URL = arg("url");
const LIMIT = Math.max(20, Number(arg("limit") ?? 120));
const RUNS = Math.max(1, Number(arg("runs") ?? 1));
const SEED = arg("seed") ?? "skinly-audit-v1";
const SPECIAL_BARCODE = "3700203746817";
const REPORTS_DIR = path.join(process.cwd(), "reports");

/* ───────────────────── Сценарии профилей ───────────────────── */

interface Scenario {
  id: string;
  label: string;
  profile: SkinProfileSummaryLike | null;
  /** База для сравнения (моно-пары A/C/E). */
  anchorId?: string;
  /** Что добавлено относительно якоря. */
  delta?: { kind: "sensitivity" | "concern" | "goal" | "avoided"; value: string };
  /** Vocabulary probe: значение вне словаря движка — ожидаем no-op. */
  probe?: boolean;
}

function prof(
  skinType: string | null,
  sensitivity: string | null,
  concerns: string[] = [],
  avoidedList: string[] = [],
  goal: string | null = null,
): SkinProfileSummaryLike {
  return { skinType, sensitivity, concerns, avoidedList, goal };
}

const SCENARIOS: Scenario[] = [
  // ── Якоря (baseline: только skinType + sensitivity) ──
  { id: "a_dry_none", label: "dry / sens=none", profile: prof("dry", "none") },
  { id: "a_dry_high", label: "dry / sens=high", profile: prof("dry", "high"), anchorId: "a_dry_none", delta: { kind: "sensitivity", value: "high" } },
  { id: "a_normal_none", label: "normal / none", profile: prof("normal", "none") },
  { id: "a_normal_mild", label: "normal / mild", profile: prof("normal", "mild"), anchorId: "a_normal_none", delta: { kind: "sensitivity", value: "mild" } },
  { id: "a_comb_none", label: "combination / none", profile: prof("combination", "none") },
  { id: "a_oily_none", label: "oily / none", profile: prof("oily", "none") },
  { id: "a_oily_high", label: "oily / high", profile: prof("oily", "high"), anchorId: "a_oily_none", delta: { kind: "sensitivity", value: "high" } },

  // ── Concern-дельты ──
  { id: "c_dry_acne", label: "dry+acne", profile: prof("dry", "none", ["acne"]), anchorId: "a_dry_none", delta: { kind: "concern", value: "acne" } },
  { id: "c_dry_redness", label: "dry+redness", profile: prof("dry", "none", ["redness"]), anchorId: "a_dry_none", delta: { kind: "concern", value: "redness" } },
  { id: "c_oily_acne", label: "oily+acne", profile: prof("oily", "none", ["acne"]), anchorId: "a_oily_none", delta: { kind: "concern", value: "acne" } },
  { id: "c_oily_pigment", label: "oily+pigmentation", profile: prof("oily", "none", ["pigmentation"]), anchorId: "a_oily_none", delta: { kind: "concern", value: "pigmentation" } },
  { id: "c_normal_aging", label: "normal+aging", profile: prof("normal", "none", ["aging"]), anchorId: "a_normal_none", delta: { kind: "concern", value: "aging" } },
  { id: "c_normal_pores", label: "normal+pores", profile: prof("normal", "none", ["pores"]), anchorId: "a_normal_none", delta: { kind: "concern", value: "pores" } },
  { id: "c_comb_blackheads", label: "combination+blackheads", profile: prof("combination", "none", ["blackheads"]), anchorId: "a_comb_none", delta: { kind: "concern", value: "blackheads" } },

  // ── Goal-дельты ──
  { id: "g_dry_hydration", label: "dry+goal=hydration", profile: prof("dry", "none", [], [], "hydration"), anchorId: "a_dry_none", delta: { kind: "goal", value: "hydration" } },
  { id: "g_oily_clear", label: "oily+goal=clear_skin (≈oilControl)", profile: prof("oily", "none", [], [], "clear_skin"), anchorId: "a_oily_none", delta: { kind: "goal", value: "clear_skin" } },
  { id: "g_normal_eventone", label: "normal+goal=even_tone (≈brightening)", profile: prof("normal", "none", [], [], "even_tone"), anchorId: "a_normal_none", delta: { kind: "goal", value: "even_tone" } },
  { id: "g_normal_antiaging", label: "normal+goal=anti_aging", profile: prof("normal", "none", [], [], "anti_aging"), anchorId: "a_normal_none", delta: { kind: "goal", value: "anti_aging" } },

  // ── Avoided-дельты (якорь: чувствительная сухая кожа) ──
  { id: "v_fragrance", label: "dry/high +avoid fragrance", profile: prof("dry", "high", [], ["fragrance"]), anchorId: "a_dry_high", delta: { kind: "avoided", value: "fragrance" } },
  { id: "v_alcohol", label: "dry/high +avoid alcohol", profile: prof("dry", "high", [], ["alcohol"]), anchorId: "a_dry_high", delta: { kind: "avoided", value: "alcohol" } },
  { id: "v_sulfates", label: "dry/high +avoid sulfates", profile: prof("dry", "high", [], ["sulfates"]), anchorId: "a_dry_high", delta: { kind: "avoided", value: "sulfates" } },
  { id: "v_parabens", label: "dry/high +avoid parabens", profile: prof("dry", "high", [], ["parabens"]), anchorId: "a_dry_high", delta: { kind: "avoided", value: "parabens" } },
  { id: "v_essential_oils", label: "dry/high +avoid essential_oils", profile: prof("dry", "high", [], ["essential_oils"]), anchorId: "a_dry_high", delta: { kind: "avoided", value: "essential_oils" } },

  // ── Комбинированные ──
  { id: "x_user_case", label: "dry/high+redness,acne+hydration", profile: prof("dry", "high", ["redness", "acne"], [], "hydration"), anchorId: "a_dry_high" },
  { id: "x_user_case_avoided", label: "…то же +avoid fragrance", profile: prof("dry", "high", ["redness", "acne"], ["fragrance"], "hydration"), anchorId: "x_user_case", delta: { kind: "avoided", value: "fragrance" } },
  { id: "x_oily_combo", label: "oily+acne,pores+clear_skin", profile: prof("oily", "none", ["acne", "pores"], [], "clear_skin"), anchorId: "a_oily_none" },
  { id: "x_empty", label: "пустой профиль (контроль)", profile: null },

  // ── Vocabulary probes (вне словаря движка — ожидаем no-op) ──
  { id: "p_concern_dryness", label: "PROBE concern=dryness", profile: prof("dry", "none", ["dryness"]), anchorId: "a_dry_none", delta: { kind: "concern", value: "dryness" }, probe: true },
  { id: "p_concern_oiliness", label: "PROBE concern=oiliness", profile: prof("oily", "none", ["oiliness"]), anchorId: "a_oily_none", delta: { kind: "concern", value: "oiliness" }, probe: true },
  { id: "p_avoided_silicones", label: "PROBE avoided=silicones", profile: prof("dry", "high", [], ["silicones"]), anchorId: "a_dry_high", delta: { kind: "avoided", value: "silicones" }, probe: true },
];

const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

/** Profile-specific positives; всё остальное считаем generic. */
const PROFILE_SPECIFIC_POSITIVE = new Set(["helpsConcern", "goalAlignment"]);
const IRRITANT_TAGS = new Set(["fragrance", "essential_oil", "alcohol_drying"]);

function shortKey(k: string): string {
  return k.replace(/^compatibility\.reasons\./, "").replace(/^compatibility\./, "");
}

/**
 * Нормализация для детекторов: после Phase 1 reasons могут приходить
 * сгруппированными (`dryFriendlyMany`) — при сравнении с warning/positive
 * keys срезаем суффикс Many, чтобы не плодить ложные C3/A1.
 */
function baseKey(k: string): string {
  return k.replace(/Many$/, "").replace(/:.*$/, "");
}

/* ───────────────────── Типы записей ───────────────────── */

interface ProductInfo {
  barcode: string;
  productId: string;
  category: string;
  brand: string;
  ingredientCount: number;
  recognizedRatio: number;
  /** Из facts (service-mode): множества для фактозависимых проверок. */
  benefitConcerns: string[];
  flagsInComposition: string[];
  hasIrritants: boolean;
  factsCount: number;
  special: boolean;
}

interface EvalRecord {
  barcode: string;
  scenarioId: string;
  score: number;
  verdict: string;
  lowConfidence: boolean;
  source: string;
  positivesCount: number;
  warningsCount: number;
  reasonKeys: string[];
  positiveKeys: string[];
  warningKeys: string[];
  positiveInci: string[];
  warningInci: string[];
  triggeredAvoided: string[];
  matchedConcerns: string[];
  latencyMs: number;
}

interface Anomaly {
  type: string;
  severity: "high" | "medium" | "low";
  barcode: string;
  category: string;
  scenarioId: string;
  anchorScenarioId: string;
  scoreBefore: number | null;
  scoreAfter: number;
  verdict: string;
  details: string;
}

/* ───────────────────── Выборка товаров ───────────────────── */

interface CandidateRow {
  barcode: string;
  product_id: string;
  category: string;
  brand: string;
  total_ingredients: number;
  recognized_ratio: number;
}

async function sampleProducts(): Promise<CandidateRow[]> {
  // Детерминированный порядок: md5(barcode || seed). Стратификация в JS.
  const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT p.barcode, p.id AS product_id, p.category::text AS category,
           p.brand, f.total_ingredients::int, f.recognized_ratio::float8
    FROM "Product" p
    JOIN dm.product_ingredient_features f ON f.barcode = p.barcode
    WHERE f.total_ingredients >= 3
    ORDER BY md5(p.barcode || ${SEED})
    LIMIT 3000
  `);

  const bucketOf = (c: CandidateRow): string => {
    const size =
      c.total_ingredients <= 15 ? "S" : c.total_ingredients <= 30 ? "M" : "L";
    const rec = c.recognized_ratio >= 0.5 ? "hi" : "lo";
    return `${c.category}|${size}|${rec}`;
  };

  const buckets = new Map<string, CandidateRow[]>();
  for (const c of candidates) {
    const b = bucketOf(c);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(c);
  }
  // Round-robin по бакетам (порядок бакетов — детерминированный, по ключу).
  const keys = [...buckets.keys()].sort();
  const picked: CandidateRow[] = [];
  const seenBrandCount = new Map<string, number>();
  let idx = 0;
  while (picked.length < LIMIT && keys.length > 0) {
    const key = keys[idx % keys.length];
    const arr = buckets.get(key)!;
    let took = false;
    while (arr.length > 0) {
      const c = arr.shift()!;
      const brandN = seenBrandCount.get(c.brand) ?? 0;
      if (brandN >= 6) continue; // разные бренды: cap 6 на бренд
      seenBrandCount.set(c.brand, brandN + 1);
      picked.push(c);
      took = true;
      break;
    }
    if (!took) {
      keys.splice(idx % keys.length, 1);
      continue;
    }
    idx += 1;
  }

  // Спец-кейс из наблюдения — всегда включаем, если есть в БД.
  if (!picked.some((c) => c.barcode === SPECIAL_BARCODE)) {
    const special = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT p.barcode, p.id AS product_id, p.category::text AS category,
             p.brand, f.total_ingredients::int, f.recognized_ratio::float8
      FROM "Product" p
      JOIN dm.product_ingredient_features f ON f.barcode = p.barcode
      WHERE p.barcode = ${SPECIAL_BARCODE}
      LIMIT 1
    `);
    if (special[0]) picked.unshift(special[0]);
  }
  return picked;
}

/* ───────────────────── Оценка: service / HTTP ───────────────────── */

interface EvalOutcome {
  record: EvalRecord;
}

async function evaluateService(
  cand: CandidateRow,
  scenario: Scenario,
  ctx: {
    legacyIngredients: { inci: string; position: number }[];
    dmInput: Awaited<ReturnType<typeof getDmCompatibilityInput>>;
    useDm: boolean;
  },
): Promise<EvalOutcome> {
  const engineProfile = scenario.profile
    ? summaryProfileToEngine(scenario.profile)
    : emptyProfile();
  let best = Infinity;
  let resolved!: Awaited<ReturnType<typeof resolveCompatibility>>;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    resolved = await resolveCompatibility({
      barcode: cand.barcode,
      legacyIngredients: ctx.legacyIngredients,
      profile: engineProfile,
      forceDm: ctx.useDm,
      dmInput: ctx.useDm ? ctx.dmInput : undefined,
    });
    best = Math.min(best, performance.now() - t0);
  }
  const res = resolved.result;
  const keys = (hits: readonly RuleHit[]) => hits.map((h) => shortKey(h.key));
  const inci = (hits: readonly RuleHit[]) =>
    [...new Set(hits.map((h) => h.inci).filter((x): x is string => !!x))];
  return {
    record: {
      barcode: cand.barcode,
      scenarioId: scenario.id,
      score: res.score,
      verdict: res.verdict,
      lowConfidence: res.lowConfidence,
      source: resolved.source,
      positivesCount: res.positives.length,
      warningsCount: res.warnings.length,
      reasonKeys: keys(res.reasons),
      positiveKeys: keys(res.positives),
      warningKeys: keys(res.warnings),
      positiveInci: inci(res.positives),
      warningInci: inci(res.warnings),
      triggeredAvoided: [...res.triggeredAvoided],
      matchedConcerns: [...res.matchedConcerns],
      latencyMs: Math.round(best * 10) / 10,
    },
  };
}

interface HttpReason {
  key: string;
  text: string;
  kind: string;
}

async function evaluateHttp(
  cand: CandidateRow,
  scenario: Scenario,
): Promise<EvalOutcome> {
  const p = scenario.profile;
  const sp = new URLSearchParams();
  if (p?.skinType) sp.set("skinType", p.skinType);
  if (p?.sensitivity && p.sensitivity !== "none") sp.set("sensitivity", p.sensitivity);
  if (p?.goal) sp.set("goal", p.goal);
  if (p?.concerns?.length) sp.set("concerns", p.concerns.join(","));
  if (p?.avoidedList?.length) sp.set("avoided", p.avoidedList.join(","));
  const url = `${ARG_URL}/api/v1/products/${cand.barcode}/compatibility?${sp}`;

  let best = Infinity;
  let dto: {
    score?: number;
    verdict?: string;
    lowConfidence?: boolean;
    source?: string;
    reasons?: HttpReason[];
    positives?: HttpReason[];
    warnings?: HttpReason[];
  } = {};
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    const res = await fetch(url, { headers: { accept: "application/json" } });
    dto = res.ok ? await res.json() : {};
    best = Math.min(best, performance.now() - t0);
  }
  const keys = (arr?: HttpReason[]) => (arr ?? []).map((r) => r.key);
  return {
    record: {
      barcode: cand.barcode,
      scenarioId: scenario.id,
      score: dto.score ?? 0,
      verdict: dto.verdict ?? "—",
      lowConfidence: Boolean(dto.lowConfidence),
      source: dto.source ?? "http",
      positivesCount: dto.positives?.length ?? 0, // ⚠️ top-4 cap на endpoint'е
      warningsCount: dto.warnings?.length ?? 0,
      reasonKeys: keys(dto.reasons),
      positiveKeys: keys(dto.positives),
      warningKeys: keys(dto.warnings),
      positiveInci: [],
      warningInci: [],
      triggeredAvoided: keys(dto.warnings).includes("avoidedFlag") ? ["<detected>"] : [],
      matchedConcerns: [],
      latencyMs: Math.round(best * 10) / 10,
    },
  };
}

/* ───────────────────── Детекция аномалий ───────────────────── */

function detectAnomalies(
  info: ProductInfo,
  byScenario: Map<string, EvalRecord>,
  serviceMode: boolean,
): Anomaly[] {
  const out: Anomaly[] = [];
  const push = (
    a: Omit<Anomaly, "barcode" | "category">,
  ) => out.push({ ...a, barcode: info.barcode, category: info.category });

  const nonProbe = SCENARIOS.filter((s) => !s.probe && s.id !== "x_empty");

  // A2: все непробные сценарии дают один и тот же score.
  const scores = new Set(
    nonProbe.map((s) => byScenario.get(s.id)?.score).filter((x) => x != null),
  );
  if (scores.size === 1 && info.factsCount > 0) {
    push({
      type: "A2_identical_across_profiles",
      severity: "high",
      scenarioId: "*",
      anchorScenarioId: "*",
      scoreBefore: null,
      scoreAfter: [...scores][0]!,
      verdict: byScenario.get("a_dry_none")?.verdict ?? "—",
      details: `все ${nonProbe.length} профилей → одинаковый score`,
    });
  }

  for (const sc of SCENARIOS) {
    const rec = byScenario.get(sc.id);
    if (!rec) continue;
    const anchor = sc.anchorId ? byScenario.get(sc.anchorId) : undefined;
    const d = sc.delta;
    const delta = anchor ? rec.score - anchor.score : null;

    if (!sc.probe && sc.id !== "x_empty") {
      // B1 / B2
      if (rec.verdict === "excellent" && rec.warningsCount > 0) {
        push({
          type: "B1_excellent_with_warnings",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId ?? "",
          scoreBefore: anchor?.score ?? null,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `warnings=[${rec.warningKeys.join(";")}]`,
        });
      }
      if (
        (rec.verdict === "excellent" || rec.verdict === "good") &&
        (rec.warningKeys.includes("avoidedFlag") || rec.triggeredAvoided.length > 0)
      ) {
        push({
          type: "B2_good_with_hard_warning",
          severity: "high",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId ?? "",
          scoreBefore: anchor?.score ?? null,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `avoidedFlag triggered=[${rec.triggeredAvoided.join(";")}]`,
        });
      }
      // B3: high score без profile-specific positives (для сценариев с concern/goal).
      const hasConcernOrGoal =
        (sc.profile?.concerns?.length ?? 0) > 0 || sc.profile?.goal;
      if (
        rec.score >= 85 &&
        hasConcernOrGoal &&
        !rec.positiveKeys.some((k) => PROFILE_SPECIFIC_POSITIVE.has(k))
      ) {
        push({
          type: "B3_high_score_generic_only",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId ?? "",
          scoreBefore: anchor?.score ?? null,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `positives=[${rec.positiveKeys.join(";")}] — только generic`,
        });
      }
      // B4
      if (rec.score < 40 && rec.warningsCount === 0 && rec.score > 0) {
        push({
          type: "B4_low_score_no_warnings",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: "",
          scoreBefore: null,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: "score<40 без единого warning",
        });
      }
      // C3
      if (rec.warningsCount > 0 && rec.reasonKeys.length > 0) {
        const warnBase = new Set(rec.warningKeys.map(baseKey));
        const warnInReasons = rec.reasonKeys.some((k) =>
          warnBase.has(baseKey(k)),
        );
        if (!warnInReasons) {
          push({
            type: "C3_warning_not_in_reasons",
            severity: "low",
            scenarioId: sc.id,
            anchorScenarioId: "",
            scoreBefore: null,
            scoreAfter: rec.score,
            verdict: rec.verdict,
            details: `warnings=[${rec.warningKeys.join(";")}] reasons=[${rec.reasonKeys.join(";")}]`,
          });
        }
      }
      // D1 / D2
      if (
        sc.profile &&
        info.factsCount > 0 &&
        rec.score > 0 &&
        rec.reasonKeys.length === 0
      ) {
        push({
          type: "D1_empty_reasons",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: "",
          scoreBefore: null,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: "reasons пустые при непустом составе",
        });
      }
      const dup =
        rec.reasonKeys.length !== new Set(rec.reasonKeys).size;
      if (dup) {
        push({
          type: "D2_duplicate_reasons",
          severity: "low",
          scenarioId: sc.id,
          anchorScenarioId: "",
          scoreBefore: null,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `reasons=[${rec.reasonKeys.join(";")}]`,
        });
      }
    }

    // ── Направленные пары (E/A/C) ──
    if (!anchor || !d) continue;

    if (d.kind === "sensitivity" && !sc.probe) {
      // E1: рост чувствительности при раздражителях в составе не должен
      // ПОВЫШАТЬ score.
      if (delta! > 0 && (info.hasIrritants || !serviceMode)) {
        push({
          type: "E1_sensitivity_raised_score",
          severity: "high",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `sens=${d.value}: ${anchor.score}→${rec.score} при irritants=${info.hasIrritants}`,
        });
      }
    }

    if (d.kind === "avoided") {
      // E2: avoided не должен повышать score (probes отчитываются отдельно
      // как P_vocab_probe_changed_score).
      if (delta! > 0 && !sc.probe) {
        push({
          type: "E2_avoided_raised_score",
          severity: "high",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `+avoid ${d.value}: ${anchor.score}→${rec.score}`,
        });
      }
      if (!sc.probe) {
        const containsFlagged = serviceMode
          ? info.flagsInComposition.includes(d.value)
          : rec.warningKeys.includes("avoidedFlag");
        // C1: флаг в составе, а verdict остался good/excellent.
        if (
          containsFlagged &&
          (rec.verdict === "good" || rec.verdict === "excellent")
        ) {
          push({
            type: "C1_avoided_ignored_verdict",
            severity: "high",
            scenarioId: sc.id,
            anchorScenarioId: sc.anchorId!,
            scoreBefore: anchor.score,
            scoreAfter: rec.score,
            verdict: rec.verdict,
            details: `состав содержит ${d.value}, verdict=${rec.verdict}`,
          });
        }
        // C2: флаг в составе, а score почти не упал.
        if (containsFlagged && delta! > -5) {
          push({
            type: "C2_avoided_no_score_drop",
            severity: "high",
            scenarioId: sc.id,
            anchorScenarioId: sc.anchorId!,
            scoreBefore: anchor.score,
            scoreAfter: rec.score,
            verdict: rec.verdict,
            details: `+avoid ${d.value}: Δ=${delta} (ожидали ≤ −5)`,
          });
        }
      }
    }

    if (d.kind === "concern" && !sc.probe) {
      const hasBenefit = serviceMode
        ? info.benefitConcerns.includes(d.value)
        : rec.positiveKeys.includes("helpsConcern");
      // E3: concern повысил score без benefits-ингредиентов.
      if (delta! > 0 && !hasBenefit && !rec.positiveKeys.includes("helpsConcern")) {
        push({
          type: "E3_concern_raised_score_unjustified",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `+${d.value}: ${anchor.score}→${rec.score} без anti-${d.value} ингредиентов`,
        });
      }
      // A1: concern есть, состав релевантен, но Δ=0 и нет concern-reason.
      const reasonBase = rec.reasonKeys.map(baseKey);
      const concernReason =
        reasonBase.includes("helpsConcern") ||
        reasonBase.includes("cautionForConcern") ||
        reasonBase.includes("concernNotCovered") ||
        rec.positiveKeys.includes("helpsConcern") ||
        rec.warningKeys.includes("cautionForConcern");
      if (delta === 0 && hasBenefit && !concernReason) {
        push({
          type: "A1_concern_insensitive",
          severity: serviceMode ? "high" : "low",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `+${d.value}: Δ=0, состав содержит benefits для ${d.value}, reasons молчат`,
        });
      }
    }

    if (d.kind === "goal" && !sc.probe) {
      // E4: goal повысил score без goalAlignment.
      if (delta! > 0 && !rec.positiveKeys.includes("goalAlignment")) {
        push({
          type: "E4_goal_raised_score_unjustified",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `+goal=${d.value}: ${anchor.score}→${rec.score} без goalAlignment`,
        });
      }
      // A1-goal: goal вообще не влияет и не упоминается.
      if (delta === 0 && !rec.positiveKeys.includes("goalAlignment")) {
        push({
          type: "A1_goal_insensitive",
          severity: "low",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `+goal=${d.value}: Δ=0, goalAlignment отсутствует`,
        });
      }
    }

    // Probes. После Phase 1 (vocabulary adapter) dryness/oiliness ДОЛЖНЫ
    // маппиться на goal-эквиваленты — проверяем соответствие маппингу.
    // silicones остаётся неразмеченным → ожидаем no-op.
    if (sc.probe) {
      const MAPPED: Record<string, string> = {
        p_concern_dryness: "g_dry_hydration",
        p_concern_oiliness: "g_oily_clear",
      };
      const mappedTo = MAPPED[sc.id];
      if (mappedTo) {
        const target = byScenario.get(mappedTo);
        if (target && rec.score !== target.score && rec.score !== anchor.score) {
          // Ни no-op (до Phase 1), ни маппинг (после) — что-то третье.
          push({
            type: "P_vocab_mapping_mismatch",
            severity: "medium",
            scenarioId: sc.id,
            anchorScenarioId: mappedTo,
            scoreBefore: target.score,
            scoreAfter: rec.score,
            verdict: rec.verdict,
            details: `probe ${d?.value}: score=${rec.score}, ожидали как у ${mappedTo} (${target.score}) или якоря (${anchor.score})`,
          });
        }
      } else if (delta !== 0) {
        push({
          type: "P_vocab_probe_changed_score",
          severity: "medium",
          scenarioId: sc.id,
          anchorScenarioId: sc.anchorId!,
          scoreBefore: anchor.score,
          scoreAfter: rec.score,
          verdict: rec.verdict,
          details: `probe ${d?.kind}=${d?.value} изменил score на ${delta}`,
        });
      }
    }
  }
  return out;
}

/* ───────────────────── CSV / отчёты ───────────────────── */

function csvEscape(v: string | number | boolean | null): string {
  const s = v == null ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | boolean | null)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

function pctStr(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";
}

/* ───────────────────────── main ───────────────────────── */

async function main(): Promise<void> {
  const mode = ARG_URL ? `HTTP (${ARG_URL})` : "service-level";
  console.log(
    `compat-audit · ${new Date().toISOString()} · mode=${mode} · ` +
      `limit=${LIMIT} runs=${RUNS} seed=${SEED} · scenarios=${SCENARIOS.length}`,
  );
  mkdirSync(REPORTS_DIR, { recursive: true });

  const useDm = isDmCompatibilityEnabled();
  console.log(`USE_DM_COMPATIBILITY=${useDm} (source facts: ${useDm ? "dm" : "legacy KB"})`);

  const sample = await sampleProducts();
  console.log(`Выборка: ${sample.length} товаров (спец-кейс ${SPECIAL_BARCODE}: ${sample.some((s) => s.barcode === SPECIAL_BARCODE) ? "включён" : "НЕ найден в БД"})`);

  const records: EvalRecord[] = [];
  const anomalies: Anomaly[] = [];
  const productInfos: ProductInfo[] = [];

  let done = 0;
  for (const cand of sample) {
    try {
      // Общий контекст товара (1 раз): legacy-состав + DM-вход.
      const product = await prisma.product.findUnique({
        where: { barcode: cand.barcode },
        select: {
          id: true,
          ingredients: {
            select: { position: true, ingredient: { select: { inci: true } } },
            orderBy: { position: "asc" },
          },
        },
      });
      if (!product) continue;
      const legacyIngredients = product.ingredients.map((l) => ({
        inci: l.ingredient.inci,
        position: l.position,
      }));
      const dmInput = useDm ? await getDmCompatibilityInput(cand.barcode) : null;

      // Facts-метаданные (для фактозависимых проверок) — из одного прогона.
      const probeResolve = await resolveCompatibility({
        barcode: cand.barcode,
        legacyIngredients,
        profile: emptyProfile(),
        forceDm: useDm,
        dmInput: useDm ? dmInput : undefined,
      });
      const facts = probeResolve.facts;
      const info: ProductInfo = {
        barcode: cand.barcode,
        productId: cand.product_id,
        category: cand.category,
        brand: cand.brand,
        ingredientCount: cand.total_ingredients,
        recognizedRatio: cand.recognized_ratio,
        benefitConcerns: [...new Set(facts.flatMap((f) => f.benefitsFor))],
        flagsInComposition: [...new Set(facts.flatMap((f) => f.flagsAvoided))],
        hasIrritants: facts.some((f) =>
          f.tags.some((t) => IRRITANT_TAGS.has(t)),
        ),
        factsCount: facts.length,
        special: cand.barcode === SPECIAL_BARCODE,
      };
      productInfos.push(info);

      const byScenario = new Map<string, EvalRecord>();
      for (const sc of SCENARIOS) {
        const { record } = ARG_URL
          ? await evaluateHttp(cand, sc)
          : await evaluateService(cand, sc, { legacyIngredients, dmInput, useDm });
        byScenario.set(sc.id, record);
        records.push(record);
      }
      anomalies.push(...detectAnomalies(info, byScenario, !ARG_URL));
    } catch (e) {
      console.error(`  ⚠️ ${cand.barcode}: ${(e as Error).message.split("\n")[0]}`);
    }
    done += 1;
    if (done % 10 === 0 || done === sample.length) {
      console.log(
        `  прогресс: ${done}/${sample.length} товаров · записей=${records.length} · аномалий=${anomalies.length}`,
      );
    }
  }

  writeReports(productInfos, records, anomalies, mode);
}

/* ───────────────────── Отчёты ───────────────────── */

function writeReports(
  infos: ProductInfo[],
  records: EvalRecord[],
  anomalies: Anomaly[],
  mode: string,
): void {
  const infoBy = new Map(infos.map((i) => [i.barcode, i]));

  // ── results.csv ──
  const resultRows: (string | number | boolean | null)[][] = [
    [
      "barcode", "productId", "category", "brand", "ingredientCount",
      "factsCount", "recognizedRatio", "source", "lowConfidence",
      "scenarioId", "scenarioLabel", "score", "verdict",
      "positivesCount", "warningsCount", "reasonKeys",
      "positiveInci", "warningInci", "latencyMs",
    ],
  ];
  for (const r of records) {
    const i = infoBy.get(r.barcode);
    const sc = SCENARIO_BY_ID.get(r.scenarioId);
    resultRows.push([
      r.barcode, i?.productId ?? "", i?.category ?? "", i?.brand ?? "",
      i?.ingredientCount ?? 0, i?.factsCount ?? 0,
      i ? Number(i.recognizedRatio.toFixed(4)) : 0, r.source, r.lowConfidence,
      r.scenarioId, sc?.label ?? "", r.score, r.verdict,
      r.positivesCount, r.warningsCount, r.reasonKeys.join(";"),
      r.positiveInci.join(";"), r.warningInci.join(";"), r.latencyMs,
    ]);
  }
  writeFileSync(path.join(REPORTS_DIR, "compat-audit-results.csv"), toCsv(resultRows));

  // ── anomalies.csv ──
  const anomalyRows: (string | number | boolean | null)[][] = [
    ["type", "severity", "barcode", "category", "scenarioId",
     "anchorScenarioId", "scoreBefore", "scoreAfter", "verdict", "details"],
  ];
  for (const a of anomalies) {
    anomalyRows.push([
      a.type, a.severity, a.barcode, a.category, a.scenarioId,
      a.anchorScenarioId, a.scoreBefore, a.scoreAfter, a.verdict, a.details,
    ]);
  }
  writeFileSync(path.join(REPORTS_DIR, "compat-audit-anomalies.csv"), toCsv(anomalyRows));

  // ── results.json ──
  writeFileSync(
    path.join(REPORTS_DIR, "compat-audit-results.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), mode, seed: SEED, limit: LIMIT,
        scenarios: SCENARIOS.map(({ id, label, anchorId, delta, probe }) =>
          ({ id, label, anchorId, delta, probe })),
        products: infos, records, anomalies },
      null, 2,
    ),
  );

  // ── summary.md ──
  writeFileSync(
    path.join(REPORTS_DIR, "compat-audit-summary.md"),
    buildSummary(infos, records, anomalies, mode),
  );

  console.log(`\nГотово. Файлы в reports/:`);
  console.log(`  compat-audit-summary.md · compat-audit-results.csv (${records.length} строк)`);
  console.log(`  compat-audit-anomalies.csv (${anomalies.length} аномалий) · compat-audit-results.json`);
}

function buildSummary(
  infos: ProductInfo[],
  records: EvalRecord[],
  anomalies: Anomaly[],
  mode: string,
): string {
  const nonProbeRecords = records.filter((r) => {
    const sc = SCENARIO_BY_ID.get(r.scenarioId);
    return sc && !sc.probe && sc.id !== "x_empty" && r.score > 0;
  });

  // F: распределение verdict.
  const verdicts = new Map<string, number>();
  for (const r of nonProbeRecords) {
    verdicts.set(r.verdict, (verdicts.get(r.verdict) ?? 0) + 1);
  }
  const total = nonProbeRecords.length;

  // Средний score по сценариям.
  const byScenario = new Map<string, number[]>();
  for (const r of nonProbeRecords) {
    if (!byScenario.has(r.scenarioId)) byScenario.set(r.scenarioId, []);
    byScenario.get(r.scenarioId)!.push(r.score);
  }
  const scenarioAvg = [...byScenario]
    .map(([id, arr]) => ({
      id,
      label: SCENARIO_BY_ID.get(id)?.label ?? id,
      avg: arr.reduce((s, x) => s + x, 0) / arr.length,
      n: arr.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  // Доля товаров, где concerns/goals ничего не меняют.
  const concernGoalScenarios = SCENARIOS.filter(
    (s) => !s.probe && (s.delta?.kind === "concern" || s.delta?.kind === "goal"),
  );
  let insensitiveProducts = 0;
  const byBarcode = new Map<string, Map<string, EvalRecord>>();
  for (const r of records) {
    if (!byBarcode.has(r.barcode)) byBarcode.set(r.barcode, new Map());
    byBarcode.get(r.barcode)!.set(r.scenarioId, r);
  }
  for (const [, m] of byBarcode) {
    const allZero = concernGoalScenarios.every((sc) => {
      const rec = m.get(sc.id);
      const anchor = sc.anchorId ? m.get(sc.anchorId) : undefined;
      return rec && anchor && rec.score === anchor.score;
    });
    if (allZero) insensitiveProducts += 1;
  }

  // Топ reason/warning keys.
  const topKeys = (extract: (r: EvalRecord) => string[]): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of nonProbeRecords) {
      for (const k of extract(r)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 10);
  };

  // Аномалии: агрегаты и топ-подозрительные товары.
  const anomaliesByType = new Map<string, number>();
  for (const a of anomalies) {
    anomaliesByType.set(a.type, (anomaliesByType.get(a.type) ?? 0) + 1);
  }
  const sevWeight = { high: 3, medium: 2, low: 1 } as const;
  const productScore = new Map<string, number>();
  for (const a of anomalies) {
    productScore.set(
      a.barcode,
      (productScore.get(a.barcode) ?? 0) + sevWeight[a.severity],
    );
  }
  const top20 = [...productScore]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const example = (type: string, n = 3): Anomaly[] =>
    anomalies.filter((a) => a.type === type).slice(0, n);

  // Кейсы, где avoided работает правильно.
  const avoidedOk: string[] = [];
  for (const [bc, m] of byBarcode) {
    const info = infos.find((i) => i.barcode === bc);
    if (!info) continue;
    for (const sc of SCENARIOS.filter((s) => s.delta?.kind === "avoided" && !s.probe)) {
      const rec = m.get(sc.id);
      const anchor = sc.anchorId ? m.get(sc.anchorId) : undefined;
      if (!rec || !anchor) continue;
      const flagged = info.flagsInComposition.includes(sc.delta!.value);
      if (flagged && rec.score - anchor.score <= -15 && rec.verdict !== "excellent") {
        avoidedOk.push(
          `- ${bc} (${info.category}): +avoid ${sc.delta!.value} → ${anchor.score}→${rec.score}, verdict=${rec.verdict} ✓`,
        );
        break;
      }
    }
    if (avoidedOk.length >= 5) break;
  }

  // Спец-кейс.
  const special = byBarcode.get(SPECIAL_BARCODE);
  let specialSection = "_Товар не найден в выборке/БД._";
  if (special) {
    const rows = SCENARIOS.map((sc) => {
      const r = special.get(sc.id);
      if (!r) return null;
      return `| ${sc.id} | ${sc.label} | ${r.score} | ${r.verdict} | ${r.positivesCount}/${r.warningsCount} | ${r.reasonKeys.join("; ")} |`;
    })
      .filter(Boolean)
      .join("\n");
    const specialAnoms = anomalies.filter((a) => a.barcode === SPECIAL_BARCODE);
    specialSection =
      `| Сценарий | Профиль | Score | Verdict | +/− | Reason keys |\n|---|---|---|---|---|---|\n${rows}\n\n` +
      `Аномалии по этому товару: ${specialAnoms.length}\n` +
      specialAnoms
        .map((a) => `- **${a.type}** (${a.severity}) [${a.scenarioId}]: ${a.details}`)
        .join("\n");
  }

  const identicalShare = (() => {
    // Доля пар «разные профили → одинаковый score» (по якорям).
    const anchors = SCENARIOS.filter((s) => !s.probe && !s.delta && s.id !== "x_empty");
    let same = 0;
    let pairs = 0;
    for (const [, m] of byBarcode) {
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const a = m.get(anchors[i].id);
          const b = m.get(anchors[j].id);
          if (!a || !b || a.score === 0 || b.score === 0) continue;
          pairs += 1;
          if (a.score === b.score) same += 1;
        }
      }
    }
    return pctStr(same, pairs);
  })();

  const md = `# Аудит качества compatibility-скоринга

Дата: ${new Date().toISOString()} · режим: ${mode} · seed: \`${SEED}\` ·
товаров: ${infos.length} · сценариев: ${SCENARIOS.length} · записей: ${records.length}

## 1. Общая статистика (F)

Распределение verdict (по ${total} непробным оценкам с профилем):

${["excellent", "good", "mixed", "risky"]
  .map((v) => `- ${v}: ${verdicts.get(v) ?? 0} (${pctStr(verdicts.get(v) ?? 0, total)})`)
  .join("\n")}

Доля одинаковых score между разными baseline-профилями: **${identicalShare}**
Доля товаров, где concerns/goals ВООБЩЕ не меняют score: **${pctStr(insensitiveProducts, byBarcode.size)}** (${insensitiveProducts}/${byBarcode.size})

Средний score по сценариям (топ/низ):

| Сценарий | Средний score | n |
|---|---|---|
${scenarioAvg.slice(0, 6).map((s) => `| ${s.label} | ${s.avg.toFixed(1)} | ${s.n} |`).join("\n")}
| … | | |
${scenarioAvg.slice(-4).map((s) => `| ${s.label} | ${s.avg.toFixed(1)} | ${s.n} |`).join("\n")}

Топ reason keys: ${topKeys((r) => r.reasonKeys).map(([k, n]) => `\`${k}\`(${n})`).join(", ")}
Топ warning keys: ${topKeys((r) => r.warningKeys).map(([k, n]) => `\`${k}\`(${n})`).join(", ")}
Топ positive keys: ${topKeys((r) => r.positiveKeys).map(([k, n]) => `\`${k}\`(${n})`).join(", ")}

## 2. Аномалии по типам

| Тип | Кол-во |
|---|---|
${[...anomaliesByType].sort((a, b) => b[1] - a[1]).map(([t, n]) => `| ${t} | ${n} |`).join("\n")}

## 3. Топ-20 подозрительных товаров (взвешенно по severity)

| Barcode | Категория | Вес аномалий |
|---|---|---|
${top20.map(([bc, w]) => `| ${bc} | ${infos.find((i) => i.barcode === bc)?.category ?? "—"} | ${w} |`).join("\n")}

## 4. Примеры

### Profile insensitivity (A1/A2)
${[...example("A2_identical_across_profiles"), ...example("A1_concern_insensitive"), ...example("A1_goal_insensitive", 2)]
  .map((a) => `- ${a.barcode} [${a.scenarioId}] (${a.severity}): ${a.details}`)
  .join("\n") || "_не найдено_"}

### Завышенный excellent (B1/B2/B3)
${[...example("B2_good_with_hard_warning"), ...example("B1_excellent_with_warnings"), ...example("B3_high_score_generic_only")]
  .map((a) => `- ${a.barcode} [${a.scenarioId}] score=${a.scoreAfter} verdict=${a.verdict}: ${a.details}`)
  .join("\n") || "_не найдено_"}

### Avoided работает правильно ✓
${avoidedOk.join("\n") || "_примеров не найдено — само по себе тревожный сигнал_"}

### Vocabulary gaps (probes)
Значения \`dryness\`, \`oiliness\` (concerns), \`silicones\` (avoided),
\`oilControl\`/\`soothing\`/\`brightening\` (goals) отсутствуют в словаре движка —
они интерпретируются как no-op. Если анкета/клиент их отправляет, пользователь
думает, что профиль учтён, а движок его игнорирует.
${anomalies.filter((a) => a.type === "P_vocab_probe_changed_score").length > 0
    ? "⚠️ Часть probes ИЗМЕНИЛА score — см. anomalies.csv (P_vocab_probe_changed_score)."
    : "Probes подтвердили no-op (score не менялся)."}

## 5. Кейс barcode ${SPECIAL_BARCODE}

${specialSection}

## 6. Что проверять первым (по данным аудита)

1. **Verdict-пороги vs warnings** (${(anomaliesByType.get("B1_excellent_with_warnings") ?? 0) + (anomaliesByType.get("B2_good_with_hard_warning") ?? 0)} случаев B1+B2):
   \`score.ts\` — excellent при score≥88 не требует warnings==0; один
   \`oilyHeavy\`/\`sensitiveTrigger\` (−10…−18) легко перекрывается стопкой
   generic-позитивов. Кандидаты: (а) не выдавать excellent при warnings>0;
   (б) поднять веса warning-правил.
2. **Generic hydration inflation** (${anomaliesByType.get("B3_high_score_generic_only") ?? 0} случаев B3): \`skin_dry\`/\`oilyLightHydration\`
   (+4…+5 за каждый humectant) суммируются до diminishing-порога +30 —
   нейтральные увлажнители надувают score до excellent без связи с
   concerns/goals. Кандидат: снизить per-ingredient вес или отдельный
   sub-cap для skin-type-правил.
3. **Вес concern/goal-правил** (${(anomaliesByType.get("A1_concern_insensitive") ?? 0) + (anomaliesByType.get("A1_goal_insensitive") ?? 0)} случаев A1):
   \`concern_match\` +6…+12 и \`goal_alignment\` +4 малы относительно baseline 75 —
   проверить веса и полноту \`benefits_for\`/KB-покрытия в
   \`dm.ingredient_properties\` (пустые benefits_for → concern физически не
   может сработать).
4. **Avoided-канал** (${(anomaliesByType.get("C1_avoided_ignored_verdict") ?? 0) + (anomaliesByType.get("C2_avoided_no_score_drop") ?? 0)} случаев C1+C2):
   проверить полноту \`flags_avoided\` в ingredient_properties (флаг не
   размечен → avoided не триггерится) и hard-cap 60.
5. **Словарь анкеты ↔ движка**: добавить маппинг/валидацию
   \`dryness/oiliness/oilControl/soothing/brightening/silicones\` (см. §4).

_Отчёт сгенерирован scripts/audit-compatibility.ts (read-only)._
`;
  return md;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
