/**
 * Skinly · FARERA barcode enrichment · клиент + парсер barcode-list.ru
 *
 * ⚠️  ВАЖНО: это enrichment-КАНДИДАТЫ, а НЕ источник истины. barcode-list.ru —
 * краудсорс-каталог штрихкодов; совпадение по названию ≠ гарантия, что это тот
 * самый SKU. Поэтому каждый матч несёт `score` и `status`, а downstream должен
 * относиться к нему как к гипотезе (ручная/полуавтоматическая верификация).
 *
 * Здесь НЕ переиспользуется national-catalog/fetcher: у того свой User-Agent
 * (SkinlyStagingScraper) и интервал 750мс. По требованию задачи для
 * barcode-list.ru нужен обычный браузерный UA и медленный темп 1 запрос /
 * 2–3 секунды, retry 2. Поэтому — отдельный аккуратный fetch.
 *
 * Никаких SDK: native fetch + cheerio.
 */

import * as cheerio from "cheerio";

export const BARCODE_LIST_SEARCH_URL =
  "https://barcode-list.ru/barcode/RU/Поиск.htm";

/** Браузерный User-Agent (по требованию задачи). */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

/** Темп: 1 запрос в 2–3 секунды. */
const MIN_INTERVAL_MS = 2000;
const JITTER_MS = 1000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2; // 2 повтора (итого до 3 попыток)
const BASE_BACKOFF_MS = 1500;

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimit(): Promise<void> {
  const wait = MIN_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
  lastRequestAt = Date.now();
}

export function buildSearchUrl(query: string): string {
  return `${BARCODE_LIST_SEARCH_URL}?barcode=${encodeURIComponent(query)}`;
}

/**
 * GET страницы поиска. Rate-limit + retry (2 повтора) + timeout.
 * Бросает на финальном провале — caller помечает товар как failed.
 */
export async function fetchSearchHtml(
  query: string,
  log: (msg: string) => void,
): Promise<string> {
  const url = buildSearchUrl(query);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await rateLimit();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        log(
          `[barcode-list] fail "${query}" (${e instanceof Error ? e.message : e}), ` +
            `retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`barcode-list fetch failed: ${query}`);
}

/* ───────── parsing ───────── */

export interface BarcodeCandidate {
  barcode: string;
  name: string;
  unit: string | null;
  rating: number | null;
  /** Заполняется на этапе scoring. */
  score?: number;
}

const EAN_RE = /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/;
const DIGITS_8_14_RE = /\b(\d{8,14})\b/;
// NB: JS \b не работает вокруг кириллицы (\w = ASCII), поэтому матчим
// единицу как самостоятельную ячейку без \b.
const UNIT_CELL_RE = /^(шт|уп|упак|упаковка|кг|г|гр|мл|л|пар|set|компл|комплект|штук)\.?$/i;

function clean(s: string | undefined | null): string {
  if (!s) return "";
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Валидный ли GTIN (EAN-8 / EAN-13 / GTIN-14) по контрольной сумме.
 * EAN-12 (UPC-A) тоже принимаем как валидный GTIN.
 */
export function isValidEan(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // Вес 3/1, начиная с крайней правой цифры данных.
  for (let i = digits.length - 1, pos = 1; i >= 0; i--, pos++) {
    sum += digits[i] * (pos % 2 === 1 ? 3 : 1);
  }
  const computed = (10 - (sum % 10)) % 10;
  return computed === check;
}

/**
 * Распарсить таблицу результатов barcode-list.ru.
 *
 * Толерантно: сканируем все строки таблиц, в каждой ищем ячейку-штрихкод
 * (8–14 цифр), а из остальных ячеек эвристически берём name / unit / rating.
 * Это устойчиво к перестановке колонок и кастомной вёрстке. Строки без
 * штрихкода (шапки, «случайные товары» без EAN) отбрасываются.
 *
 * Дедуп по barcode. Возвращаем в порядке появления.
 */
export function parseSearchResults(html: string): BarcodeCandidate[] {
  const $ = cheerio.load(html);
  const out: BarcodeCandidate[] = [];
  const seen = new Set<string>();

  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .toArray()
      .map((td) => clean($(td).text()));
    if (cells.length < 2) return;

    // 1) barcode — первая ячейка, целиком состоящая из 8–14 цифр.
    let barcode: string | null = null;
    let barcodeIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const onlyDigits = cells[i].replace(/\s/g, "");
      if (EAN_RE.test(onlyDigits) || /^\d{8,14}$/.test(onlyDigits)) {
        barcode = onlyDigits;
        barcodeIdx = i;
        break;
      }
      const m = cells[i].match(DIGITS_8_14_RE);
      if (m && cells[i].replace(/\D/g, "").length === m[1].length) {
        barcode = m[1];
        barcodeIdx = i;
        break;
      }
    }
    if (!barcode) return;
    if (seen.has(barcode)) return;

    // 2) остальные ячейки → name (самая «текстовая»), unit, rating.
    const rest = cells.filter((_, i) => i !== barcodeIdx);
    let name = "";
    let unit: string | null = null;
    const numericCells: number[] = [];

    for (const c of rest) {
      if (!c) continue;
      if (unit == null && UNIT_CELL_RE.test(c)) {
        unit = clean(c);
        continue;
      }
      if (/^\d+(?:[.,]\d+)?$/.test(c) && c.length <= 6) {
        numericCells.push(parseFloat(c.replace(",", ".")));
        continue;
      }
      // name = самая длинная буквосодержащая ячейка
      if (/[A-Za-zА-Яа-яЁё]/.test(c) && c.length > name.length) name = c;
    }
    // rating — последняя числовая ячейка (колонка рейтинга идёт после
    // порядкового номера/единицы). Если числовых нет — null.
    const rating =
      numericCells.length > 0 ? numericCells[numericCells.length - 1] : null;

    if (!name) return; // строка без названия — мусор
    seen.add(barcode);
    out.push({ barcode, name, unit, rating });
  });

  return out;
}

/* ───────── scoring & classification ───────── */

export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface FareraQueryInput {
  brand: string | null;
  title: string | null;
  volume: string | null;
}

/** Порог уверенного матча. */
export const MATCH_THRESHOLD = 0.6;
/** Менее строгий порог, когда результат ровно один. */
const SINGLE_RESULT_THRESHOLD = 0.5;

const STOPWORDS = new Set([
  "для",
  "и",
  "с",
  "в",
  "на",
  "от",
  "по",
  "the",
  "for",
  "and",
  "with",
]);

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Бренд без странового суффикса в скобках: «Aravia (Россия)» → «Aravia». */
function brandCore(brand: string): string {
  return brand.replace(/\(.*?\)/g, " ").trim();
}

interface VolumeParsed {
  n: number;
  unit: string;
}

function parseVolume(s: string | null | undefined): VolumeParsed | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|мг|л|гр|г|g|шт)(?![а-яёa-z])/i);
  if (!m) return null;
  let unit = m[2].toLowerCase();
  if (unit === "ml") unit = "мл";
  if (unit === "g" || unit === "гр") unit = "г";
  return { n: parseFloat(m[1].replace(",", ".")), unit };
}

/**
 * Оценка одного кандидата против товара Farera. Возвращает score 0..1.
 *
 * Веса: brand 0.4, пересечение слов названия 0.4, объём 0.2.
 * Если у товара нет объёма — вес объёма перераспределяется на brand+title.
 */
export function scoreCandidate(
  input: FareraQueryInput,
  cand: BarcodeCandidate,
): number {
  const nameNorm = normalizeText(cand.name);
  const nameTokens = new Set(tokenize(cand.name));

  // brand
  let brandScore = 0;
  if (input.brand) {
    const bTokens = tokenize(brandCore(input.brand));
    if (bTokens.length > 0) {
      const hit = bTokens.filter((t) => nameNorm.includes(t)).length;
      brandScore = hit / bTokens.length;
    }
  }

  // title overlap
  let titleScore = 0;
  if (input.title) {
    const tTokens = tokenize(input.title).filter((t) => !/^\d+$/.test(t));
    if (tTokens.length > 0) {
      const hit = tTokens.filter((t) => nameTokens.has(t)).length;
      titleScore = hit / tTokens.length;
    }
  }

  // volume
  const pv = parseVolume(input.volume ?? input.title);
  const cv = parseVolume(cand.name);
  let volScore = 0;
  let volWeighted = true;
  if (pv && cv) {
    if (pv.n === cv.n && pv.unit === cv.unit) volScore = 1;
    else if (pv.n === cv.n) volScore = 0.6;
    else volScore = 0;
  } else {
    // у товара/кандидата нет объёма — не штрафуем, исключаем вес объёма.
    volWeighted = false;
  }

  if (volWeighted) {
    return round2(brandScore * 0.4 + titleScore * 0.4 + volScore * 0.2);
  }
  // перераспределяем 0.2 поровну между brand и title.
  return round2(brandScore * 0.5 + titleScore * 0.5);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ClassifyResult {
  status: MatchStatus;
  barcode: string | null;
  matchedName: string | null;
  score: number;
  /** Все кандидаты со score, отсортированы по убыванию. */
  candidates: BarcodeCandidate[];
}

/**
 * Классифицировать набор кандидатов в matched / ambiguous / not_found.
 *
 * - matched: ровно один сильный кандидат (score ≥ MATCH_THRESHOLD, валидный
 *   EAN), либо единственный результат с валидным EAN и score ≥ 0.5.
 * - ambiguous: ≥2 сильных кандидата ИЛИ есть кандидаты, но ни один не
 *   уверенный/не валидный EAN.
 * - not_found: кандидатов нет вовсе.
 *
 * matched-barcode возвращается только при status=matched. Это ENRICHMENT-
 * гипотеза, не истина.
 */
export function classifyCandidates(
  input: FareraQueryInput,
  candidates: BarcodeCandidate[],
): ClassifyResult {
  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(input, c) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (scored.length === 0) {
    return { status: "not_found", barcode: null, matchedName: null, score: 0, candidates: [] };
  }

  const strong = scored.filter(
    (c) => (c.score ?? 0) >= MATCH_THRESHOLD && isValidEan(c.barcode),
  );
  const best = scored[0];

  // Единственный результат с валидным EAN и приличным score → matched.
  if (
    scored.length === 1 &&
    isValidEan(best.barcode) &&
    (best.score ?? 0) >= SINGLE_RESULT_THRESHOLD
  ) {
    return {
      status: "matched",
      barcode: best.barcode,
      matchedName: best.name,
      score: best.score ?? 0,
      candidates: scored,
    };
  }

  if (strong.length === 1) {
    return {
      status: "matched",
      barcode: strong[0].barcode,
      matchedName: strong[0].name,
      score: strong[0].score ?? 0,
      candidates: scored,
    };
  }

  if (strong.length >= 2) {
    return {
      status: "ambiguous",
      barcode: null,
      matchedName: null,
      score: best.score ?? 0,
      candidates: scored,
    };
  }

  // Кандидаты есть, но ни один не уверенный → ambiguous.
  return {
    status: "ambiguous",
    barcode: null,
    matchedName: null,
    score: best.score ?? 0,
    candidates: scored,
  };
}
