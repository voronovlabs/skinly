/**
 * Skinly · staging scraper · National Catalog of Goods (RF)
 *
 * Типы только для скрейпера. Эти данные НЕ совпадают с Prisma-моделью
 * 1:1 — это именно raw enrichment layer, который потом отдельной фазой
 * нормализуется и кладётся в Product/Ingredient.
 */

export interface ScrapedProduct {
  source: "national_catalog";
  sourceUrl: string;
  /** Хлебные крошки сверху страницы, без "Главная". */
  categoryPath: string[];
  title: string | null;
  barcode: string | null;
  brand: string | null;
  country: string | null;
  manufacturer: string | null;
  signer: string | null;
  importer: string | null;
  imageUrl: string | null;
  /** Сырая строка состава, если на странице есть; INCI пока не парсим. */
  compositionRaw: string | null;
  /** Вложенная структура: секция → ключ-значение. */
  characteristics: Record<string, Record<string, string>>;
  /** Та же структура, но плоская — удобно для нормализации. */
  flatAttributes: Record<string, string>;
  scrapedAt: string;
}

export interface Checkpoint {
  /** Все обнаруженные product-URL'ы (path-only, например "/.../ID"). */
  discoveredUrls: string[];
  /** URL'ы, по которым уже отработали (успех или фатал). */
  processedUrls: string[];
  /** Падения: URL + причина. Чтобы потом перепрогнать только их. */
  failed: { url: string; reason: string; at: string }[];
  startedAt: string;
  updatedAt: string;
}

export interface ScrapeStats {
  productsScraped: number;
  productsWithoutBarcode: number;
  productsWithoutImage: number;
  productsWithoutAttributes: number;
  duplicatesSkipped: number;
  failures: number;
  /** Успешный upsert в Postgres (NationalCatalogRawProduct). */
  rawUpsertOk: number;
  /** Ошибка upsert в Postgres — товар всё равно есть в JSONL. */
  rawUpsertFail: number;
}
