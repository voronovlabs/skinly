/**
 * ЭТАП 4 — генерация поисковых запросов для barcode-list.ru.
 *
 * Проблема одного «длинного» запроса (brand + полное name): бренд дублируется,
 * название перегружено служебными/маркетинговыми словами → поиск не находит
 * ничего (not_found). Здесь из товара строится ДО 3 УНИКАЛЬНЫХ запросов от
 * строгого к широкому:
 *
 *   1. brand + ядро названия + объём     («Gillette Mach3 Turbo 4 шт»)
 *   2. brand + ядро названия             («Gillette Mach3 Turbo»)
 *   3. brand + укороченное ядро          («Gillette Mach3»)
 *
 * «Ядро» — название без бренда, без объёма/веса/количества, без служебных
 * слов («для», «уход», «кожи»…), без повторов. Если в названии есть токены
 * линейки/модели (латиница/цифры: Mach3, Turbo, SPF50, №7) — ядро сужается
 * до них: русские родовые слова («Кассеты», «бритья») поиску только мешают.
 *
 * Всё pure-функции без I/O — используются stage-barcodes и unit-проверками
 * (query-builder.check.ts).
 */

/** Сколько токенов ядра берём в строгий запрос (защита от «простыней»). */
const CORE_MAX_TOKENS = 6;
/** Максимум запросов на товар. */
export const MAX_QUERIES = 3;

/**
 * Служебные слова, которые мало помогают поиску по штрихкод-каталогу.
 * NB: удаляются только как ОТДЕЛЬНЫЕ токены — «Защита» внутри латинского
 * названия линейки не пострадает (латинские токены в стоп-лист не входят),
 * а сознательно НЕ вносим сюда слова, часто входящие в названия линеек.
 */
const STOP_WORDS = new Set([
  "для",
  "уход",
  "ухода",
  "уходу",
  "средство",
  "средства",
  "женский",
  "женская",
  "женские",
  "женских",
  "мужской",
  "мужская",
  "мужские",
  "мужских",
  "парфюмированный",
  "парфюмированная",
  "парфюмированное",
  "парфюмированные",
  "защита",
  "защиты",
  "кожи",
  "кожей",
  "лица",
  "волос",
  "тела",
  "штук",
]);

/**
 * Фразы вида «для нормальной кожи» / «для всех типов волос» — тип кожи/волос,
 * который в краудсорс-каталоге почти никогда не встречается в названии.
 */
const SKIN_TYPE_PHRASE_RE =
  /для\s+(?:всех\s+типов|нормальн\w*|сух\w*|жирн\w*|чувствительн\w*|комбинированн\w*|проблемн\w*|зрел\w*|тонк\w*|окрашенн\w*|повреж[дё]\w*)(?:\s+(?:кожи|волос|тела|лица))?/gi;

/**
 * Объём/вес/количество: «50 мл» / «50ml» / «0.2 л» / «200 г» / «200гр» /
 * «200g» / «4 шт» / «4шт» / «4 штук». Более длинные единицы — раньше,
 * иначе «штук» распарсится как «шт» + хвост.
 */
const VOLUME_RE =
  /(\d+(?:[.,]\d+)?)\s*(мл|ml|штук|шт|гр|кг|kg|г|g|л|l)\.?(?![а-яёa-z])/gi;

const UNIT_CANON: Record<string, string> = {
  ml: "мл",
  мл: "мл",
  штук: "шт",
  шт: "шт",
  гр: "г",
  г: "г",
  g: "г",
  кг: "кг",
  kg: "кг",
  л: "л",
  l: "л",
};

/**
 * Извлечь из названия объём/вес/количество в нормализованном виде
 * («50 мл», «4 шт», «0.2 л»). Берётся первое вхождение; нет — null.
 */
export function extractVolume(name: string | null | undefined): string | null {
  if (!name) return null;
  VOLUME_RE.lastIndex = 0;
  const m = VOLUME_RE.exec(name);
  if (!m) return null;
  const n = m[1].replace(",", ".");
  const unit = UNIT_CANON[m[2].toLowerCase()] ?? m[2].toLowerCase();
  return `${n} ${unit}`;
}

/** Для сравнения токенов: lowercase + ё→е, без пунктуации по краям. */
function tokenKey(t: string): string {
  return t.toLowerCase().replace(/ё/g, "е");
}

/** Срезать пунктуацию по краям токена; №/%/+/-/. внутри сохраняются. */
function stripPunct(t: string): string {
  return t.replace(/^[«»"'(),.;:!?*]+|[«»"'(),.;:!?*]+$/g, "");
}

/** Токен линейки/модели/маркировки: латиница или цифры (Mach3, SPF50, №7, 03). */
function isLineToken(t: string): boolean {
  return /[a-z0-9]/i.test(t) || /№/.test(t);
}

export interface BuiltQueries {
  /** До MAX_QUERIES уникальных запросов, от строгого к широкому. Минимум 1. */
  queries: string[];
  /** Нормализованный объём/вес/количество («50 мл») или null. */
  volume: string | null;
}

/**
 * Построить поисковые запросы для товара.
 *
 * @param brand p.brand, если не "Unknown"; иначе null.
 * @param name  p.name как есть.
 */
export function buildSearchQueries(
  brand: string | null,
  name: string,
): BuiltQueries {
  const volume = extractVolume(name);

  // Название без объёма и «типовых» фраз.
  let rest = name.replace(SKIN_TYPE_PHRASE_RE, " ");
  VOLUME_RE.lastIndex = 0;
  rest = rest.replace(VOLUME_RE, " ");

  // Токены бренда — для удаления дубликата бренда из названия.
  const brandKeys = new Set(
    (brand ?? "")
      .split(/\s+/)
      .map((t) => tokenKey(stripPunct(t)))
      .filter(Boolean),
  );

  // Ядро: без бренда, без стоп-слов, без повторов.
  const seen = new Set<string>();
  const core: string[] = [];
  for (const raw of rest.split(/\s+/)) {
    const t = stripPunct(raw);
    if (!t) continue;
    const key = tokenKey(t);
    if (brandKeys.has(key)) continue;
    if (STOP_WORDS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    core.push(t);
  }

  // Токены линейки/модели (латиница/цифры). Сужаем ядро до них, только если
  // среди них есть настоящий латинский токен (Mach3, Turbo, SPF, Care) —
  // одиночные цифры («тон 03») сами по себе линейку не образуют.
  const line = core.filter(isLineToken);
  const hasLatinLine = line.some((t) => /[a-z]{2,}/i.test(t));
  const base = (
    hasLatinLine && line.length > 0 && line.length < core.length ? line : core
  ).slice(0, CORE_MAX_TOKENS);

  const join = (parts: Array<string | null>): string =>
    parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  // Широкое ядро: минус последний токен (но не короче 1).
  const broad = base.slice(0, Math.max(1, Math.min(2, base.length - 1)));

  const raw = [
    join([brand, ...base, volume]), // 1: строгий (с объёмом)
    join([brand, ...base]),         // 2: без объёма
    join([brand, ...broad]),        // 3: укороченное ядро
  ];

  const queries: string[] = [];
  const uniq = new Set<string>();
  for (const q of raw) {
    if (!q) continue;
    const key = q.toLowerCase();
    if (uniq.has(key)) continue;
    uniq.add(key);
    queries.push(q);
    if (queries.length >= MAX_QUERIES) break;
  }

  // Fallback: ядро пустое (name состоял из бренда/стоп-слов) — как раньше.
  if (queries.length === 0) {
    const q = join([brand, name]);
    if (q) queries.push(q);
  }

  return { queries, volume };
}
