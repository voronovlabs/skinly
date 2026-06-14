/**
 * Skinly · staging scraper · FARERA
 *
 * Типы только для источника `farera`. НЕ совпадают 1:1 с Prisma-моделью —
 * это raw enrichment layer (этап 1 → JSONL).
 *
 * Отличия от national_catalog ScrapedProduct:
 *   - `source: "farera"`;
 *   - barcode всегда `null` (на fareraparfum.ru нет EAN/штрихкода);
 *   - есть `productId` (внутренний CS-Cart id), `vendorCode` («Код:»),
 *     цена (`priceCurrent`/`priceOld`), `line`, `productType`, `skinType`,
 *     `volume` — это то, что реально отдаёт карточка CS-Cart.
 *
 * `barcode` оставлен (null) намеренно: storage.loadExistingKeys() читает
 * `obj.sourceUrl` и `obj.barcode` для дедупликации — поле должно
 * присутствовать, чтобы переиспользовать общий storage без изменений.
 */

export interface FareraScrapedProduct {
  source: typeof import("./config").SOURCE;
  /** Абсолютный URL detail-страницы. */
  sourceUrl: string;
  /** Внутренний CS-Cart product_id (из `product_id=NNN`), если найден. */
  productId: number | null;
  /** «Код:» — артикул поставщика (например `6102`, `028065B`). НЕ EAN. */
  vendorCode: string | null;
  /** Хлебные крошки без «Главная». */
  categoryPath: string[];
  title: string | null;
  /** Всегда null — у farera нет штрихкодов. Нужно для storage-дедупа. */
  barcode: null;
  brand: string | null;
  country: string | null;
  /** Линия. */
  line: string | null;
  /** Средства (тип средства: Крем/Пилинг/Тоник …). */
  productType: string | null;
  /** Тип кожи (Сухая/Жирная/Всех типов/Атопичная …). Мапится на Skinly skinType. */
  skinType: string | null;
  /** Объём (из названия или фичи), строкой как на сайте: «150 мл». */
  volume: string | null;
  /** Текущая цена в рублях. */
  priceCurrent: number | null;
  /** Старая (зачёркнутая) цена, если есть скидка. */
  priceOld: number | null;
  currency: "RUB";
  imageUrl: string | null;
  /** Строка состава INCI, если на странице есть. Иначе null. */
  compositionRaw: string | null;
  /** true, если найдена явная INCI-строка (для метрик покрытия). */
  hasInci: boolean;
  /** Плоские key/value характеристики из блока «Особенности». */
  flatAttributes: Record<string, string>;
  scrapedAt: string;
}

export interface FareraScrapeStats {
  productsScraped: number;
  productsWithInci: number;
  productsWithoutImage: number;
  productsWithoutPrice: number;
  duplicatesSkipped: number;
  failures: number;
}
