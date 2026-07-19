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

/** Строка failed-products.jsonl (этап 1 / retry-failed). */
export interface FailedProduct {
  externalId: string | null;
  url: string;
  error: string;
  failedAt: string;
}

/** Строка not-found-products.jsonl: товар удалён с сайта (404-заглушка). */
export interface NotFoundProduct {
  externalId: string;
  url: string;
  notFoundAt: string;
}

/** Строка magnit-cosmetic-barcode-matches.jsonl (этап 4). */
export interface BarcodeMatchLine {
  source: "barcode-list";
  externalId: string;
  query: string;
  /** matched / ambiguous / not_found — как у classifyCandidates; error — сбой запроса. */
  status: "matched" | "ambiguous" | "not_found" | "error";
  barcode: string | null;
  matchedName: string | null;
  score: number;
  candidates: unknown[];
  error?: string;
  enrichedAt: string;
}

export type UpsertResult = "created" | "updated" | "unchanged";

// ImportStats / emptyStats монолитного конвейера упразднены:
// счётчики каждого этапа считаются локально в stage-*.ts.
