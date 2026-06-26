/**
 * Skinly · кросс-язычный матчер inn-skin (латиница) ↔ внешний EAN-источник (RU)
 *
 * Источник истины по названиям у inn-skin — латиница («BARIEDERM», «Hyseac»),
 * у внешних каталогов (barcode-list и далее) — обычно кириллица. Поэтому
 * сопоставление идёт по приоритету (по убыванию важности):
 *
 *   1. brand          — жёсткий gate (сравниваем только внутри бренда);
 *   2. transliteration — кириллица → латиница (барьедерм → barederm);
 *   3. phonetic norm   — generic-правила (x→ks, w→v, схлопывание дублей),
 *                        чтобы Xemose ↔ Ксемоз и т.п. сходились БЕЗ словаря;
 *   4. bigram-Dice     — строковое сходство токенов;
 *   5. token-overlap   — лучший матч по токенам (взвешенно по длине);
 *   6. volume          — СИЛЬНЫЙ плюс, но НЕ обязателен;
 *   7. aliases         — ТОЛЬКО как override, если всё выше дало мало.
 *
 * Качество важнее покрытия: лучше не записать EAN, чем записать неверный.
 * Каждый кандидат несёт confidence, tier и reasons (почему так).
 */

import { isValidEan } from "../farera/barcode-list";

/* ───────── транслитерация ───────── */

const CYR2LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translit(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => (ch in CYR2LAT ? CYR2LAT[ch] : ch))
    .join("");
}

/**
 * Generic-фонетическая нормализация (БЕЗ словаря брендов). Сглаживает
 * систематические расхождения латиница↔транслит:
 *   x → ks   (Xemose ↔ Ксемоз→ksemoz)
 *   w → v
 *   повторяющиеся буквы схлопываются (ll→l)
 * Этого достаточно, чтобы большинство линеек сходилось без ручных alias.
 */
function phon(token: string): string {
  return token
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1");
}

/** Любой текст (лат/кир) → латинские токены ≥2 символов. */
export function latinTokens(s: string): string[] {
  return translit(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/* ───────── n-gram Dice ───────── */

function bigrams(s: string): string[] {
  const g: string[] = [];
  for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2));
  return g;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const bag = new Map<string, number>();
  for (const g of B) bag.set(g, (bag.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of A) {
    const c = bag.get(g);
    if (c) {
      inter++;
      bag.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

/** Сходство одного inn-skin токена против токенов кандидата (phon + bigram). */
function tokenBest(it: string, cToks: string[]): number {
  const a = phon(it);
  let best = 0;
  for (const ct of cToks) {
    const b = phon(ct);
    let d: number;
    if (a === b) d = 1;
    else if (a.length >= 4 && (b.includes(a) || a.includes(b))) d = 0.9;
    else d = dice(a, b);
    if (d > best) best = d;
  }
  return best;
}

/**
 * Базовое сходство названий БЕЗ alias-словаря: взвешенное (по длине токена)
 * среднее лучших совпадений inn-skin-токенов против токенов кандидата.
 * Бренд-токены исключаются (бренд уже зафиксирован gate'ом).
 */
export function baseNameSim(
  innName: string,
  candName: string,
  brandQuery: string,
): number {
  const brandToks = new Set(latinTokens(brandQuery).map(phon));
  const iToks = latinTokens(innName).filter(
    (t) => t.length >= 3 && !brandToks.has(phon(t)) && !/^\d+$/.test(t),
  );
  const cToks = latinTokens(candName).filter((t) => !brandToks.has(phon(t)));
  if (iToks.length === 0 || cToks.length === 0) return 0;

  let total = 0;
  let wsum = 0;
  for (const it of iToks) {
    const w = it.length;
    total += tokenBest(it, cToks) * w;
    wsum += w;
  }
  return wsum ? round2(total / wsum) : 0;
}

/* ───────── aliases: ТОЛЬКО override (последний приоритет) ──────────────────
 * Маленький список для нерегулярных транслитов, которые generic-фонетика не
 * вытягивает (выпавшая H, ц→ts vs c). Применяется ТОЛЬКО когда baseNameSim
 * ниже medium-порога. Это не основной механизм, а аварийный.
 */
const ALIAS_OVERRIDES: Record<string, string[]> = {
  hyseac: ["iseak", "giaseak", "hiseak"],
  cicapair: ["tsikaper", "sikaper", "cicaper"],
  cicaplast: ["tsikaplast", "sikaplast"],
};

function aliasHit(innName: string, candName: string): string | null {
  const iToks = latinTokens(innName);
  const cToks = latinTokens(candName).map(phon);
  for (const it of iToks) {
    const variants = ALIAS_OVERRIDES[it];
    if (!variants) continue;
    if (variants.some((v) => cToks.some((ct) => ct === v || ct.includes(v)))) {
      return it;
    }
  }
  return null;
}

/* ───────── объём (бонус, НЕ обязателен) ───────── */

export interface Volume {
  n: number;
  unit: string;
}

export function parseVolume(s: string | null | undefined): Volume | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|мг|mg|л|гр|г|g|шт)(?![а-яёa-z])/i);
  if (!m) return null;
  let unit = m[2].toLowerCase();
  if (unit === "ml") unit = "мл";
  if (unit === "mg") unit = "мг";
  if (unit === "g" || unit === "гр") unit = "г";
  return { n: parseFloat(m[1].replace(",", ".")), unit };
}

/* ───────── классификация ───────── */

export type MatchTier = "high" | "medium" | "low" | "none";

export interface MatchReasons {
  base_sim: number;
  final_sim: number;
  confidence: number;
  volume: "match" | "mismatch" | "unknown";
  inn_volume: Volume | null;
  cand_volume: Volume | null;
  alias_used: string | null;
  brand_query: string;
  source: string;
}

export interface MatchResult {
  tier: MatchTier;
  confidence: number;
  method: string;
  reasons: MatchReasons;
}

// Пороги. Объём НЕ обязателен для high.
export const SIM_HIGH = 0.92;        // только по названию → high
export const SIM_HIGH_WITH_VOL = 0.8; // название + совпавший объём → high
export const CONF_MEDIUM = 0.6;
export const CONF_LOW = 0.4;
const ALIAS_FLOOR = 0.62;            // до чего поднимаем sim при срабатывании alias

/**
 * Оценить одного внешнего кандидата против inn-skin товара.
 * Возвращает tier high/medium/low/none + confidence + объяснение.
 */
export function classifyCandidate(params: {
  innName: string;
  brandQuery: string;
  innVolumeSource: string | null;
  source: string;
  candidateEan: string;
  candidateName: string;
}): MatchResult {
  const {
    innName,
    brandQuery,
    innVolumeSource,
    source,
    candidateEan,
    candidateName,
  } = params;

  const base = baseNameSim(innName, candidateName, brandQuery);
  const iv = parseVolume(innVolumeSource ?? innName);
  const cv = parseVolume(candidateName);
  let volume: "match" | "mismatch" | "unknown" = "unknown";
  if (iv && cv) volume = iv.n === cv.n && iv.unit === cv.unit ? "match" : "mismatch";

  // alias — последний приоритет, только когда базового сходства мало.
  let sim = base;
  let usedAlias: string | null = null;
  if (base < CONF_MEDIUM) {
    const hit = aliasHit(innName, candidateName);
    if (hit) {
      sim = Math.max(base, ALIAS_FLOOR);
      usedAlias = hit;
    }
  }

  // объём: плюс при совпадении, мягкий минус при расхождении, иначе нейтрально.
  const volBonus = volume === "match" ? 0.06 : volume === "mismatch" ? -0.12 : 0;
  const confidence = clamp(round2(sim + volBonus), 0, 0.99);

  const reasons: MatchReasons = {
    base_sim: base,
    final_sim: sim,
    confidence,
    volume,
    inn_volume: iv,
    cand_volume: cv,
    alias_used: usedAlias,
    brand_query: brandQuery,
    source,
  };

  if (!isValidEan(candidateEan)) {
    return { tier: "none", confidence: 0, method: "invalid-ean", reasons };
  }

  const method =
    (usedAlias ? "alias" : "name") + (volume === "match" ? "+volume" : "");

  // high: сильное название само по себе ИЛИ хорошее название + совпавший объём.
  if (sim >= SIM_HIGH || (sim >= SIM_HIGH_WITH_VOL && volume === "match")) {
    return { tier: "high", confidence: Math.max(confidence, sim), method, reasons };
  }
  if (confidence >= CONF_MEDIUM) {
    return { tier: "medium", confidence, method, reasons };
  }
  if (confidence >= CONF_LOW) {
    return { tier: "low", confidence, method, reasons };
  }
  return { tier: "none", confidence, method, reasons };
}

/* ───────── brand gate ───────── */

/**
 * inn-skin бренд (нормализованный) → строка запроса бренда во внешнем
 * источнике. Ключ — упрощённый бренд (translit + только латиница/цифры).
 * Это НЕ alias названий товаров — это сопоставление БРЕНДОВ (их немного).
 */
const BRAND_QUERY_BY_KEY: Record<string, string> = {
  uriage: "Uriage",
  avene: "EAU THERMALE AVENE",
  eauthermaleavene: "EAU THERMALE AVENE",
  ducray: "Ducray",
  aderma: "A-Derma",
  cosrx: "COSRX",
  holikaholika: "Holika Holika",
  missha: "Missha",
  drjart: "Dr.Jart+",
  drjartplus: "Dr.Jart+",
  somebymi: "SOME BY MI",
  hadalabo: "HADA LABO",
  kikomilano: "KIKO MILANO",
  catrice: "Catrice",
  sesderma: "Sesderma",
};

export function brandQueryForInnSkin(
  brandNormalized: string | null,
): string | null {
  if (!brandNormalized) return null;
  const key = translit(brandNormalized).replace(/[^a-z0-9]+/g, "");
  return BRAND_QUERY_BY_KEY[key] ?? null;
}

/* ───────── utils ───────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
