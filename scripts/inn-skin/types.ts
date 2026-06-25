/**
 * Skinly · staging scraper · inn-skin.ru — типы.
 *
 * Это RAW enrichment layer источника inn-skin.ru. С Prisma-моделями он
 * совпадает НЕ 1:1 — нормализация и (потенциальный) merge в Product идут
 * отдельными фазами.
 */

export interface InnSkinScrapedProduct {
  source: "inn-skin";
  /** UUID карточки на inn-skin.ru (из URL). */
  sourceProductId: string;
  /** Канонический URL детальной страницы. Уникален → ключ upsert'а. */
  sourceUrl: string;

  brand: string | null;
  productName: string | null;
  /** Сырой ярлык категории (эвристика по имени/листингу). */
  categoryRaw: string | null;

  imageUrl: string | null;
  priceText: string | null;
  priceValue: number | null;

  description: string | null;
  /** Инструкция применения, если выделена отдельно (иначе null). */
  usage: string | null;

  /** Полная INCI-строка. Главный по ценности артефакт источника. */
  ingredientsRaw: string | null;

  /** Витрина продавца, например 'goldapple'. */
  retailer: string | null;
  /** Артикул продавца (НЕ EAN). */
  retailerArticle: string | null;
  /** Ссылка «Сайт продавца». */
  sellerUrl: string | null;

  scrapedAt: string;
}

/** Лёгкая запись из листинга: только то, что нужно, чтобы дойти до детали. */
export interface ListingStub {
  sourceProductId: string;
  sourceUrl: string;
  /** Сырой ярлык категории из карточки листинга (best-effort, может быть null). */
  categoryRaw: string | null;
}

export interface ListingPage {
  stubs: ListingStub[];
  /** Всего страниц у бренда (из «N из M»). null = не удалось определить. */
  totalPages: number | null;
}

export interface ScrapeStats {
  brandsProcessed: number;
  listingPagesFetched: number;
  cardsFound: number;
  detailFetched: number;
  rawUpsertOk: number;
  rawUpsertFail: number;
  withoutIngredients: number;
  withoutArticle: number;
  duplicatesSkipped: number;
  failures: number;
}

export function emptyStats(): ScrapeStats {
  return {
    brandsProcessed: 0,
    listingPagesFetched: 0,
    cardsFound: 0,
    detailFetched: 0,
    rawUpsertOk: 0,
    rawUpsertFail: 0,
    withoutIngredients: 0,
    withoutArticle: 0,
    duplicatesSkipped: 0,
    failures: 0,
  };
}
