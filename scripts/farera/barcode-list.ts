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
 * Слова-«хром» страницы/шапки таблицы, которые НЕ должны попадать в name.
 */
const CHROME_TOKEN_RE =
  /Поиск\s*:|Единица\s+измерения|Наименование|Штрих[\s-]?код|Рейтинг|№/gi;

/** Вырезает футноут «* Рейтинг …» и слова-шапку из сегмента названия. */
function cleanChrome(seg: string): string {
  let s = seg.replace(/ /g, " ");
  // Футноут после таблицы: «* Рейтинг — это …» — отрезаем по маркеру.
  s = s.split(/\*\s*Рейтинг/i)[0];
  s = s.replace(CHROME_TOKEN_RE, " ");
  // Остаточные одиночные звёздочки.
  s = s.replace(/(^|\s)\*+(\s|$)/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

const TRAILING_INT_RE = /^\d{1,5}$/;
const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;

/**
 * Из «хвоста» сегмента (после очистки от хрома) отделяет name / unit / rating.
 *
 * Порядок колонок barcode-list.ru: [№] Штрих-код Наименование Ед.изм Рейтинг.
 * В слитной строке после barcode остаётся: «name [unit] [rating] [№след.строки]».
 *   - если `hasNextRow` — крайний правый int это номер следующей строки → срезаем;
 *   - следующий справа number → rating;
 *   - следующий справа unit-токен → unit;
 *   - остаток → name (ведущий артикул вроде «1020» сохраняется).
 */
function splitTail(
  seg: string,
  hasNextRow: boolean,
): { name: string; unit: string | null; rating: number | null } {
  const tokens = cleanChrome(seg).split(" ").filter(Boolean);
  let unit: string | null = null;
  let rating: number | null = null;

  if (hasNextRow && tokens.length && TRAILING_INT_RE.test(tokens[tokens.length - 1])) {
    tokens.pop(); // номер следующей строки
  }
  if (tokens.length) {
    const last = tokens[tokens.length - 1];
    if (NUMBER_RE.test(last) && last.length <= 6) {
      rating = parseFloat(last.replace(",", "."));
      tokens.pop();
    }
  }
  if (tokens.length && UNIT_CELL_RE.test(tokens[tokens.length - 1])) {
    unit = tokens.pop()!;
  }
  return { name: tokens.join(" ").trim(), unit, rating };
}

/** Эвристика «грязного» имени: содержит шапку/футноут/второй штрихкод/гигантское. */
function looksDirty(name: string): boolean {
  if (!name) return true;
  if (name.length > 180) return true;
  CHROME_TOKEN_RE.lastIndex = 0;
  if (CHROME_TOKEN_RE.test(name)) return true;
  // встроенный второй штрихкод = склейка нескольких строк
  if (/\d{8,14}.*\d{8,14}/.test(name)) return true;
  return false;
}

/**
 * Fallback-парсер для случая, когда таблица «схлопнулась» в одну слитную
 * строку. Сегментируем текст по штрихкодам: имя каждого товара — это текст
 * ПОСЛЕ его barcode и ДО следующего barcode, с обрезкой unit/rating/номера
 * следующей строки и вырезанным хромом.
 */
function segmentByBarcode(text: string): BarcodeCandidate[] {
  const t = text.replace(/ /g, " ").replace(/\s+/g, " ");
  const matches = [...t.matchAll(/\d{8,14}/g)];
  const out: BarcodeCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < matches.length; i++) {
    const bc = matches[i][0];
    const start = (matches[i].index ?? 0) + bc.length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? t.length : t.length;
    const hasNextRow = i + 1 < matches.length;
    if (seen.has(bc)) continue;

    const { name, unit, rating } = splitTail(t.slice(start, end), hasNextRow);
    if (!name || !/[A-Za-zА-Яа-яЁё]/.test(name)) continue; // нет осмысленного названия
    seen.add(bc);
    out.push({ barcode: bc, name, unit, rating });
  }
  return out;
}

/** Структурный парс: по одному <td>-столбцу на колонку (идеальный случай). */
function parseStructuredRows($: cheerio.CheerioAPI): BarcodeCandidate[] {
  const out: BarcodeCandidate[] = [];
  const seen = new Set<string>();

  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .toArray()
      .map((td) => clean($(td).text()));
    if (cells.length < 2) return;

    let barcode: string | null = null;
    let barcodeIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const onlyDigits = cells[i].replace(/\s/g, "");
      if (/^\d{8,14}$/.test(onlyDigits)) {
        barcode = onlyDigits;
        barcodeIdx = i;
        break;
      }
    }
    if (!barcode || seen.has(barcode)) return;

    const rest = cells.filter((_, i) => i !== barcodeIdx);
    let name = "";
    let unit: string | null = null;
    const numbers: number[] = [];
    for (const c of rest) {
      if (!c) continue;
      if (unit == null && UNIT_CELL_RE.test(c)) {
        unit = clean(c);
        continue;
      }
      if (NUMBER_RE.test(c) && c.length <= 6) {
        numbers.push(parseFloat(c.replace(",", ".")));
        continue;
      }
      if (/[A-Za-zА-Яа-яЁё]/.test(c) && c.length > name.length) name = c;
    }
    name = cleanChrome(name);
    if (!name) return;
    seen.add(barcode);
    out.push({
      barcode,
      name,
      unit,
      rating: numbers.length ? numbers[numbers.length - 1] : null,
    });
  });

  return out;
}

/**
 * Распарсить страницу результатов barcode-list.ru → список кандидатов.
 *
 * Стратегия:
 *   1. Структурный парс по <td>-колонкам (чистые unit/rating).
 *   2. Если структурный дал пусто ИЛИ хотя бы одно «грязное» имя (склейка с
 *      шапкой/футноутом/несколькими штрихкодами) — переключаемся на
 *      сегментацию по штрихкодам (вырезаем сегмент после barcode до
 *      unit/rating/следующего barcode).
 *
 * candidate.name содержит ТОЛЬКО наименование товара (без «Поиск:», «№»,
 * «Штрих-код», «Наименование», «Единица измерения», «Рейтинг», футноута).
 * Дедуп по barcode, порядок появления.
 */
export function parseSearchResults(html: string): BarcodeCandidate[] {
  const $ = cheerio.load(html);

  const structured = parseStructuredRows($);
  const structuredOk =
    structured.length > 0 && structured.every((c) => !looksDirty(c.name));
  if (structuredOk) return structured;

  // Fallback: сегментация. Берём текст таблицы с наибольшим числом штрихкодов
  // (это таблица результатов), иначе — весь body.
  let bestText = "";
  let bestCount = -1;
  $("table").each((_, tbl) => {
    const txt = $(tbl).text();
    const cnt = (txt.match(/\d{8,14}/g) ?? []).length;
    if (cnt > bestCount) {
      bestCount = cnt;
      bestText = txt;
    }
  });
  if (bestCount <= 0) bestText = $("body").text() || html;

  const segmented = segmentByBarcode(bestText);

  // Если в структурном были чистые unit/rating — подмешаем их по barcode.
  if (structured.length > 0) {
    const byBc = new Map(structured.map((c) => [c.barcode, c]));
    for (const c of segmented) {
      const s = byBc.get(c.barcode);
      if (s) {
        if (c.unit == null && s.unit != null) c.unit = s.unit;
        if (c.rating == null && s.rating != null) c.rating = s.rating;
        if (looksDirty(c.name) && !looksDirty(s.name)) c.name = s.name;
      }
    }
  }
  return segmented;
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
