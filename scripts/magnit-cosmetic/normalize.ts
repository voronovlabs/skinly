/**
 * Нормализация RawMagnitProduct → структура Prisma `Product`.
 *
 * Соглашения (см. существующие импортеры):
 *   - descriptionRu: русский текст источника, пусто → null; descriptionEn не трогаем;
 *   - imageUrl И sourceImageUrl: исходный CDN-URL Магнит Косметик.
 *     Локализация (scripts/migrate-product-images.ts) потом заменит imageUrl
 *     на внутренний URL хранилища, sourceImageUrl останется оригиналом
 *     (migrate использует `sourceImageUrl ?? url` — совместимо);
 *   - source = "magnit_cosmetic", externalId = ID карточки (он же «Артикул»);
 *   - barcode: настоящего EAN на сайте нет → технический ключ `mc:<externalId>`.
 *     Если JSON-LD внезапно отдал валидный gtin13 — используем его.
 */

import { BARCODE_PREFIX, SOURCE } from "./config";
import {
  isBeautyRelevant,
  mapMagnitCategoryToProductCategory,
  pickEmoji,
} from "./categories";
import type {
  NormalizedMagnitProduct,
  RawMagnitProduct,
  SkippedProduct,
} from "./types";

/* ───────── helpers ───────── */

function cleanSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** TS-порт dm.is_valid_ean (sql/dm/10_dm_functions.sql): GTIN-8/12/13/14 checksum. */
export function isValidEan(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // веса 3/1 справа налево
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Нормализация бренда: trim, схлопывание пробелов, удаление ™®©«»,
 * отбрасывание мусорных значений (по мотивам dm.norm_brand /
 * dm.is_garbage_brand). Кейс источника сохраняем — так делают
 * существующие импортеры (canon-кейс наводится позже в dm-слое).
 */
export function normalizeBrand(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let b = cleanSpaces(raw.replace(/[™®©«»"]/g, " "));
  if (!b) return null;
  const low = b.toLowerCase();
  const garbage = [
    /^без товарного знака$/,
    /^нет( бренда)?$/,
    /^отсутствует$/,
    /^не указан[оа]?$/,
    /^\d+$/,
    /^[-–—.]+$/,
  ];
  if (garbage.some((re) => re.test(low))) return null;
  // юр. формы — не бренд
  b = cleanSpaces(b.replace(/^(ооо|оао|зао|ао|ип)\s+/i, ""));
  return b || null;
}

const NAME_FORBIDDEN = /₽|в корзину|добавить|скидк|финальная цена|отзыв|рейтинг/i;
const HTML_TAG = /<[^>]+>/;

/** Названия секций карточки — самостоятельным описанием быть не могут. */
const SECTION_NAMES = new Set([
  "описание",
  "состав",
  "отзывы",
  "документы",
  "характеристики",
  "способ применения",
  "применение",
]);

const COMMERCE_NOISE = /₽|скидк|акци[яи]|доставк|самовывоз|в корзину|рассрочк|кешбэк|бонус/i;

/**
 * Чистит текст секции: убирает HTML, коммерческий мусор (цены/акции/
 * доставка) по предложениям. Если после очистки остаются только названия
 * секций («Состав», «Отзывы», «Способ применения: Документы» и т.п.) —
 * возвращает null (это не описание, а зацепленные заголовки интерфейса).
 */
export function sanitizeDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = cleanSpaces(raw.replace(/<[^>]+>/g, " "));
  if (!text) return null;

  if (COMMERCE_NOISE.test(text)) {
    text =
      text
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !COMMERCE_NOISE.test(s))
        .join(" ")
        .trim();
  }
  if (!text) return null;

  // Остались только названия секций? Тогда это мусор, а не описание.
  const residue = text
    .split(/[\s:.,;·—–-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
  const meaningful = residue.filter((w) => !SECTION_NAMES.has(w));
  // проверяем и по многословным названиям ("способ применения")
  const stripped = text
    .toLowerCase()
    .replace(/способ применения/g, "")
    .replace(/характеристики|описание|состав|отзывы|документы|применение/g, "")
    .replace(/[\s:.,;·—–-]+/g, "");
  if (meaningful.length === 0 || stripped.length < 3) return null;

  return text;
}

/* ───────── validation ───────── */

export interface NormalizeResult {
  product: NormalizedMagnitProduct | null;
  skip: SkippedProduct | null;
  flags: { noBrand: boolean; noImage: boolean; noDescription: boolean; noCategory: boolean };
}

export function normalizeProduct(raw: RawMagnitProduct): NormalizeResult {
  const flags = { noBrand: false, noImage: false, noDescription: false, noCategory: false };
  const skip = (reason: string, detail?: string): NormalizeResult => ({
    product: null,
    skip: { externalId: raw.externalId, url: raw.url, reason, detail },
    flags,
  });

  /* — обязательные поля — */
  if (!raw.externalId) return skip("missing externalId");
  const name = raw.name ? cleanSpaces(raw.name) : "";
  if (!name) return skip("missing name");
  if (name.length > 500) return skip("name too long");
  if (HTML_TAG.test(name)) return skip("html in name");
  if (NAME_FORBIDDEN.test(name)) return skip("ui garbage in name", name);

  /* — beauty-фильтр (решение: в Product только косметика/уход) — */
  if (!isBeautyRelevant({ breadcrumbs: raw.breadcrumbs, name })) {
    return skip("not beauty-relevant", raw.breadcrumbs.join(" / ") || name);
  }

  /* — barcode: настоящий gtin из JSON-LD или технический ключ — */
  const gtin = raw.gtin && isValidEan(raw.gtin) ? raw.gtin : null;
  const barcode = gtin ?? `${BARCODE_PREFIX}${raw.externalId}`;

  /* — brand — */
  const brand =
    normalizeBrand(raw.characteristics["Бренд"]) ??
    normalizeBrand(raw.characteristics["Производитель"]) ??
    null;
  if (!brand) flags.noBrand = true;

  /* — category — */
  const category = mapMagnitCategoryToProductCategory(
    raw.breadcrumbs,
    name,
    raw.characteristics,
  );
  if (category === "OTHER") flags.noCategory = true;

  /* — image — */
  let imageUrl: string | null = raw.imageUrl;
  if (imageUrl) {
    if (!/^https:\/\//.test(imageUrl) || /placeholder|data:image|blob:/i.test(imageUrl)) {
      imageUrl = null;
    }
  }
  if (!imageUrl) flags.noImage = true;

  /* — description: описание + способ применения, без цен/акций/HTML — */
  const cleanDesc = sanitizeDescription(raw.description);
  const cleanUsage = sanitizeDescription(raw.usage);
  const descParts: string[] = [];
  if (cleanDesc) descParts.push(cleanDesc);
  if (cleanUsage) descParts.push(`Способ применения: ${cleanUsage}`);
  let descriptionRu: string | null = descParts.join("\n\n") || null;

  // повтор названия товара в начале описания — убираем
  if (descriptionRu && descriptionRu.toLowerCase().startsWith(name.toLowerCase())) {
    descriptionRu = cleanSpaces(descriptionRu.slice(name.length)) || null;
  }
  if (!descriptionRu) flags.noDescription = true;

  const product: NormalizedMagnitProduct = {
    barcode,
    brand: brand ?? "Unknown", // соглашение normalize-national-catalog.ts
    name,
    category,
    emoji: pickEmoji(category, raw.breadcrumbs, name),
    imageUrl,
    descriptionRu,
    descriptionEn: null,
    source: SOURCE,
    externalId: raw.externalId,
    sourceImageUrl: imageUrl,
    rawComposition: raw.composition,
    sourceUrl: raw.url,
    breadcrumbs: raw.breadcrumbs,
  };

  return { product, skip: null, flags };
}
