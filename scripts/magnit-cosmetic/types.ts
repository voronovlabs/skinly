/**
 * Типы скрейпера Магнит Косметик.
 */

import type { ProductCategory } from "@prisma/client";

/** Пары "ключ → значение" из блока «Характеристики» карточки. */
export type MagnitCharacteristics = Record<string, string>;

/** Сырой товар, как распарсен со страницы (до нормализации). */
export interface RawMagnitProduct {
  /** Числовой ID из URL (`/product/8000067077-slug`) — он же «Артикул». */
  externalId: string;
  /** Канонический URL карточки (без shopCode/query). */
  url: string;
  slug: string;
  name: string | null;
  /** Хлебные крошки без «Главная»/«Каталог», например ["Волосы", "Бальзамы и уход", "Бальзамы и кондиционеры"]. */
  breadcrumbs: string[];
  description: string | null;
  /** Сырой текст блока «Состав» (INCI). В Product НЕ пишется — этап 2. */
  composition: string | null;
  /** «Способ применения», если есть на карточке. */
  usage: string | null;
  characteristics: MagnitCharacteristics;
  /** URL основного изображения (images-foodtech.magnit.ru, max-размер). */
  imageUrl: string | null;
  /** gtin13 из JSON-LD, если сайт его отдал (обычно нет). */
  gtin: string | null;
  scrapedAt: string;
}

/** Нормализованный товар — 1:1 поля Prisma `Product` + служебные. */
export interface NormalizedMagnitProduct {
  barcode: string;
  brand: string;
  name: string;
  category: ProductCategory;
  emoji: string | null;
  imageUrl: string | null;
  descriptionRu: string | null;
  descriptionEn: null;
  source: string;
  externalId: string;
  /** Исходный URL изображения Магнит Косметик (= imageUrl до локализации). */
  sourceImageUrl: string | null;
  /** Не пишется в Product — сырьё для будущего импорта ингредиентов. */
  rawComposition: string | null;
  /** Не пишется в Product — для отчёта/отладки. */
  sourceUrl: string;
  breadcrumbs: string[];
}

export interface SkippedProduct {
  externalId: string;
  url: string;
  reason: string;
  detail?: string;
}

export interface FailedProduct {
  url: string;
  error: string;
}

export type UpsertResult = "created" | "updated" | "unchanged";

export interface ImportStats {
  categoriesFound: number;
  listedProducts: number;
  uniqueProducts: number;
  duplicates: number;
  detailsFetched: number;
  detailsFailed: number;
  normalized: number;
  skipped: number;
  skippedNotBeauty: number;
  created: number;
  updated: number;
  unchanged: number;
  dbErrors: number;
  noBrand: number;
  noImage: number;
  noDescription: number;
  noCategory: number;
  /** Разбивка OTHER — для решения о расширении enum перед массовым импортом. */
  otherHair: number;
  otherMakeup: number;
  otherDeodorant: number;
  otherShaving: number;
  otherKidsHygiene: number;
  otherOther: number;
}

export function emptyStats(): ImportStats {
  return {
    categoriesFound: 0,
    listedProducts: 0,
    uniqueProducts: 0,
    duplicates: 0,
    detailsFetched: 0,
    detailsFailed: 0,
    normalized: 0,
    skipped: 0,
    skippedNotBeauty: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    dbErrors: 0,
    noBrand: 0,
    noImage: 0,
    noDescription: 0,
    noCategory: 0,
    otherHair: 0,
    otherMakeup: 0,
    otherDeodorant: 0,
    otherShaving: 0,
    otherKidsHygiene: 0,
    otherOther: 0,
  };
}
