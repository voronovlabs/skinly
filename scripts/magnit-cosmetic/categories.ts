/**
 * Маппинг категорий Магнит Косметик → Prisma enum `ProductCategory`
 * + фильтр beauty-релевантности + emoji.
 *
 * Enum проекта скроен под skincare (CLEANSER…TREATMENT, OTHER) — как и в
 * существующих нормализаторах (normalize-national-catalog.ts,
 * scripts/normalize/normalize-core.ts), всё «не-skincare» (шампуни, тушь,
 * парфюм) попадает в OTHER. Правила вынесены в декларативные списки —
 * расширяются добавлением строки.
 */

import { ProductCategory } from "@prisma/client";
import type { MagnitCharacteristics } from "./types";

/* ───────── Beauty-релевантность ───────── */

/**
 * Корневые разделы каталога, релевантные Skinly. Всё остальное
 * («Для дома и питомцев», «На все случаи», игрушки, перекус…)
 * скрейпится в staging, но в Product не импортируется.
 */
const BEAUTY_ROOTS = [
  "макияж",
  "уход",
  "парфюмерия",
  "волосы",
  "для мужчин",
  "гигиена",
];

/** Подкатегории «Детям», которые пропускаем в Product. */
const KIDS_ALLOWED = ["уход", "гигиена"];

/** Стоп-слова: даже внутри beauty-разделов это не косметика. */
const NON_BEAUTY_KEYWORDS: RegExp[] = [
  /корм|лакомств|для (кошек|собак|животных|питомц)/i,
  // бумага/полотенца/бумажные салфетки + ХОЗЯЙСТВЕННЫЕ и СТОЛОВЫЕ салфетки.
  // NB: «детские/уходовые влажные салфетки» НЕ попадают сюда — у них есть
  // косметическое назначение (уход за кожей), их оставляем.
  /туалетн\w* бумага|бумажн\w* полотенц|бумажные салфетки|салфетки бумажные/i,
  /столов\w* салфетк|сервировочн\w* салфетк|салфетки для уборки|хозяйствен\w* салфетк|влажные салфетки для (дома|уборки|поверхностей|кухни|мебели|стёкол|стекол)/i,
  /губк\w* для посуды|для мытья посуды|чистящ|моющ|стирк|порошок стиральн/i,
  /освежитель воздуха|унитаз|сантехник|стекол|для пола/i,
  /батарейк|лампочк|пакеты для мусора|перчатки (латексн|резинов|хозяйствен)/i,
  /игрушк|пазл|раскраск|канцеляр/i,
  /посуда|контейнер|термос|бутылка для воды/i,
  /зубочистк|ватные палочки для ушей животных/i,
  /подгузник|пеленк/i,
  /носки|колготк|бельё|белье нательное/i,
];

export interface RelevanceInput {
  breadcrumbs: string[];
  name: string;
}

/** true → товар относится к косметике/уходу и подходит каталогу Skinly. */
export function isBeautyRelevant(input: RelevanceInput): boolean {
  const name = input.name.toLowerCase();
  const crumbs = input.breadcrumbs.map((c) => c.toLowerCase());
  const haystack = `${crumbs.join(" / ")} ${name}`;

  for (const re of NON_BEAUTY_KEYWORDS) {
    if (re.test(haystack)) return false;
  }

  const root = crumbs[0] ?? "";
  if (root.includes("детям")) {
    const sub = crumbs[1] ?? "";
    return KIDS_ALLOWED.some((k) => sub.includes(k));
  }
  if (BEAUTY_ROOTS.some((r) => root.includes(r))) return true;

  // Хлебные крошки не распарсились — решаем по названию.
  if (crumbs.length === 0) {
    return /крем|сыворотк|шампун|бальзам|маск|тоник|тонер|лосьон|гель для душ|гель для умыв|мицелляр|скраб|пилинг|дезодорант|парфюм|туалетн\w* вода|духи|помад|тушь|тени|пудр|румян|консилер|карандаш для|лак для ногт|мыло|зубн\w* (паст|щетк)|spf|солнцезащит|масло для (лица|тела|волос)|патчи|уход/i.test(
      name,
    );
  }
  return false;
}

/* ───────── ProductCategory mapper ───────── */

interface CategoryRule {
  category: ProductCategory | "__OTHER_GUARD__";
  /** Матчится по `breadcrumbs / name / характеристики`. */
  pattern: RegExp;
}

/**
 * ВАЖНО про enum: `ProductCategory` — skincare-центричный
 * (CLEANSER…TREATMENT, OTHER). В нём НЕТ значений для волос, декоративного
 * макияжа, дезодорантов, бритья и депиляции — такие товары корректно
 * уходят в OTHER (новые значения enum не создаём). Уход за лицом и телом
 * раскладывается по существующим значениям — согласованно с detectCategory
 * (scripts/normalize-national-catalog.ts) и CATEGORY_CASE.
 *
 * Порядок правил = приоритет. `__OTHER_GUARD__` — явное «это не skincare-
 * категория из enum» → OTHER; стоит ПОСЛЕ однозначных face-правил (чтобы
 * «бальзам для губ» стал LIP_CARE), но ДО общих (чтобы «маска для волос»
 * не утекла в MASK, а «крем для рук после бритья» — в MOISTURIZER).
 */
const RULES: CategoryRule[] = [
  // ── однозначный уход за лицом ──
  { category: "SUNSCREEN",  pattern: /солнцезащит|\bspf ?\d|после загара|sunscreen|sun protect/i },
  { category: "SERUM",      pattern: /сыворотк|serum|ампул/i },
  { category: "ESSENCE",    pattern: /эссенц|essence/i },
  { category: "TONER",      pattern: /тонер|тоник для лица|face toner|\btoner\b/i },
  { category: "EYE_CREAM",  pattern: /крем для (кожи вокруг )?глаз|вокруг глаз|патчи под глаза|патчи для глаз|eye cream/i },
  { category: "LIP_CARE",   pattern: /бальзам для губ|уход за губами|блеск для губ|помад[аы]|карандаш для губ|lip (balm|care|gloss|stick)/i },
  { category: "MASK",       pattern: /маска для лица|маски для лица|тканевая маска|патч-маска|альгинатн|глиняная маска|sheet mask/i },

  // ── OTHER-guard: категорий в enum нет → OTHER ──
  // волосы (шампуни/кондиционеры/бальзамы/маски для волос/окрашивание/стайлинг)
  { category: "__OTHER_GUARD__", pattern: /шампун|кондиционер для волос|бальзам для волос|маск[аи] для волос|для волос|окрашивани|краск[аи] для волос|стайлинг|лак для волос|мусс для волос|укладк/i },
  // дезодоранты / антиперспиранты
  { category: "__OTHER_GUARD__", pattern: /дезодорант|антиперспирант|deodorant|antiperspirant/i },
  // бритьё
  { category: "__OTHER_GUARD__", pattern: /для брить|гель для брить|пена для брить|после брить|станок|бритв|кассет[аы]|shave|shaving|razor/i },
  // депиляция / эпиляция / воск
  { category: "__OTHER_GUARD__", pattern: /депиляц|эпиляц|воск для|восков\w* полоск|шугаринг|depilat/i },
  // декоративный макияж (кроме губ — те выше в LIP_CARE)
  { category: "__OTHER_GUARD__", pattern: /тушь|туш\b|тени для век|подводк|тональн|пудр[аы]|румян|консилер|хайлайтер|бронзер|основа под макияж|праймер|брови|для бровей|тени|лак для ногт|гель-лак|маникюр|педикюр/i },
  // гигиена полости рта
  { category: "__OTHER_GUARD__", pattern: /зубн\w* паст|зубн\w* щетк|ополаскиватель для (рта|полост)|уход за полостью рта|нить зубн|ирригатор/i },
  // парфюмерия
  { category: "__OTHER_GUARD__", pattern: /туалетн\w* вода|парфюмерн\w* вода|парфюм|духи|одеколон|eau de (parfum|toilette)/i },

  // ── уход за телом/лицом по существующим значениям ──
  { category: "EXFOLIANT",   pattern: /скраб|пилинг|эксфолиант|гоммаж|peeling|exfoli/i },
  { category: "MIST",        pattern: /\bмист\b|гидролат|спрей для лица|термальная вода|mist/i },
  { category: "CLEANSER",    pattern: /мицелляр|для умывания|очищающ\w* (гель|пенк|молочко)|пенка для|гель для душа|гель для умыв|мыло|демакияж|снятия макияжа|cleanser|micellar|shower gel/i },
  { category: "OIL",         pattern: /масло (для|космети|для лица|для тела|для волос)/i },
  { category: "TREATMENT",   pattern: /точечн\w* (средство|уход)|анти-?акне|против прыщей|spot treatment|ретинол|кислотн\w* (тоник|сыворотк)/i },
  { category: "MOISTURIZER", pattern: /крем для лица|крем для тела|крем для рук|крем для ног|молочко для тела|лосьон для тела|бальзам для тела|увлажняющий крем|питательный крем|флюид|moisturi|body (cream|lotion|milk)/i },

  // ── общие добивки ──
  { category: "MASK",        pattern: /\bмаска\b/i },
  { category: "MOISTURIZER", pattern: /\bкрем\b|\bлосьон\b/i },
];

/**
 * Маппер категории. Учитывает хлебные крошки (категория + подкатегория),
 * название и характеристики карточки («Назначение», «Тип средства»).
 * Не нашли уверенного соответствия → OTHER (существующее значение enum).
 */
export function mapMagnitCategoryToProductCategory(
  breadcrumbs: string[],
  name: string,
  characteristics: MagnitCharacteristics = {},
): ProductCategory {
  const extra = [
    characteristics["Назначение"],
    characteristics["Тип средства"],
    characteristics["Тип"],
  ]
    .filter(Boolean)
    .join(" ");
  const haystack = `${breadcrumbs.join(" / ")} ${name} ${extra}`;

  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) {
      // guard = «в enum нет подходящей категории» → OTHER
      return rule.category === "__OTHER_GUARD__" ? "OTHER" : rule.category;
    }
  }
  return "OTHER";
}

/* ───────── Разбивка OTHER (для отчёта перед решением о расширении enum) ───────── */

export type OtherReason =
  | "hair"
  | "makeup"
  | "deodorant"
  | "shaving"
  | "kids_hygiene"
  | "other";

/**
 * Почему товар попал в OTHER — чтобы отдельно оценить, стоит ли расширять
 * enum `ProductCategory` (HAIR / MAKEUP / BODY / DEODORANT / SHAVING)
 * перед массовым импортом. Вызывать только для category === "OTHER".
 */
export function classifyOtherReason(
  breadcrumbs: string[],
  name: string,
): OtherReason {
  const s = `${breadcrumbs.join(" / ")} ${name}`.toLowerCase();
  if (/брить|бритв|станок|кассет|shave|razor|депиляц|эпиляц|воск для|шугаринг/.test(s)) return "shaving";
  if (/дезодорант|антиперспирант|deodorant|antiperspirant/.test(s)) return "deodorant";
  if (/шампун|кондиционер|бальзам.*волос|для волос|окрашивани|краск.*волос|стайлинг|лак для волос|мусс для волос|укладк|hair/.test(s)) return "hair";
  if (/тушь|туш\b|тени|подводк|тональн|пудр|румян|консилер|хайлайтер|бронзер|праймер|основа под макияж|брови|для бровей|помад|блеск для губ|карандаш|лак для ногт|гель-?лак|маникюр|педикюр/.test(s)) return "makeup";
  if (breadcrumbs.some((c) => /детям|детск/i.test(c)) || /детск|влажные салфетки|подгузник|для новорожд/.test(s)) return "kids_hygiene";
  return "other";
}

/* ───────── Emoji ───────── */

/**
 * Готовой category→emoji логики в проекте нет (скрейперы оставляют null,
 * emoji заданы вручную только в seed) — назначаем по итоговой категории;
 * для OTHER уточняем по разделу каталога (макияж/волосы/парфюмерия…).
 */
const CATEGORY_EMOJI: Record<ProductCategory, string> = {
  CLEANSER: "🧼",
  TONER: "💧",
  ESSENCE: "💧",
  SERUM: "🧪",
  MOISTURIZER: "🧴",
  EYE_CREAM: "👁️",
  SUNSCREEN: "☀️",
  EXFOLIANT: "✨",
  MASK: "🧖",
  MIST: "💦",
  OIL: "🌿",
  LIP_CARE: "💋",
  TREATMENT: "🎯",
  OTHER: "🧴",
};

export function pickEmoji(
  category: ProductCategory,
  breadcrumbs: string[],
  name: string,
): string {
  if (category !== "OTHER") return CATEGORY_EMOJI[category];

  const s = `${breadcrumbs.join(" ")} ${name}`.toLowerCase();
  if (/зубн|полост\w* рта|ополаскиватель для (рта|зубов)/.test(s)) return "🪥";
  if (/макияж|тушь|тени|пудр|румян|консилер|тональн|брови|лак для ногт/.test(s)) return "💄";
  if (/парфюм|туалетн\w* вода|духи|парфюмерн/.test(s)) return "🌸";
  if (/волос|шампун|бальзам|кондиционер|стайлинг/.test(s)) return "🧴";
  if (/брить|бритв/.test(s)) return "🪒";
  if (/мыло|гель для душа|гигиен/.test(s)) return "🧼";
  return CATEGORY_EMOJI.OTHER;
}
