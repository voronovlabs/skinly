/**
 * Skinly · ОБЩИЙ движок нормализации (мульти-источник).
 *
 * Единственная реализация нормализации raw-источника в ЕГО СОБСТВЕННУЮ
 * таблицу `scrape.<source>_products_normalized`. Переиспользует те же
 * dm.*-функции, что и каталог:
 *   dm.norm_brand / dm.brand_key       — бренд
 *   dm.norm_name  / dm.name_key        — название
 *   dm.extract_volume                  — объём из названия
 *   dm.norm_ingredients                — INCI → text[]
 *   dm.is_valid_ean                    — проверка EAN
 * плюс декларативный CATEGORY_CASE (RU/EN-эвристика → ProductCategory enum).
 *
 * Архитектура: общий ДВИЖОК, но РАЗДЕЛЬНЫЕ таблицы результата на источник
 * (scrape.<source>_products_normalized). Движок параметризуется целевой
 * таблицей — единой таблицы-свалки нет. Объединение источников — отдельный
 * merge-слой, не normalize.
 *
 * Новый источник НЕ требует нового normalizer'а — только тонкий adapter,
 * который отдаёт `selectRaw` со стандартными алиасами:
 *   source_ref, ean, brand, name, volume_raw, category_hint,
 *   ingredients_raw, description, image_url
 * и свою целевую таблицу canonical-формы (см. caretobeauty_products_normalized).
 *
 * Это STAGING. В Product ничего не пишется.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * RU/EN-эвристика категории → ProductCategory enum (как text).
 * Специфичные правила раньше общих (eye/oil/mist до moisturizer).
 * Применяется к lower(category_hint || ' ' || name) под алиасом `src`.
 *
 * ЕДИНЫЙ источник правды по категории для всех нормализаторов проекта
 * (impl-detail: normalize-inn-skin.ts импортирует именно отсюда).
 */
export const CATEGORY_CASE = Prisma.raw(`
  CASE
    WHEN src ~ 'сыворотк|serum'                                   THEN 'SERUM'
    WHEN src ~ 'эссенц|essence'                                   THEN 'ESSENCE'
    WHEN src ~ 'тонер|тоник|toner'                                THEN 'TONER'
    WHEN src ~ 'для глаз|крем для глаз|eye'                       THEN 'EYE_CREAM'
    WHEN src ~ 'скраб|пилинг|эксфолиант|peel|scrub|exfoli'        THEN 'EXFOLIANT'
    WHEN src ~ 'маска|маски|mask'                                 THEN 'MASK'
    WHEN src ~ 'солнцезащит|spf|sunscreen|bariesun'               THEN 'SUNSCREEN'
    WHEN src ~ 'масло|oil'                                        THEN 'OIL'
    WHEN src ~ 'термальн|мист|спрей|мисты|mist|thermal|spray'     THEN 'MIST'
    WHEN src ~ 'для губ|бальзам для губ|губ|lip'                  THEN 'LIP_CARE'
    WHEN src ~ 'очищ|умыв|мицелляр|пенк|мыло|гель для|cleans|micellar|foam|cleansing' THEN 'CLEANSER'
    WHEN src ~ 'крем|молочко|эмульс|увлажн|cream|milk|emulsion|moistur|lotion|bariederm' THEN 'MOISTURIZER'
    ELSE 'OTHER'
  END
`);

export interface NormalizeSourceOpts {
  /**
   * Целевая таблица результата ИМЕННО этого источника, canonical-формы
   * (см. scrape.caretobeauty_products_normalized). Передавать как
   * Prisma.raw("scrape.<source>_products_normalized") — идентификатор,
   * не bind-параметр.
   */
  targetTable: Prisma.Sql;
  /**
   * SELECT, отдающий СЫРЫЕ колонки под стандартными алиасами:
   *   source_ref, ean, brand, name, volume_raw, category_hint,
   *   ingredients_raw, description, image_url
   * (любой может быть NULL). Это и есть единственный per-source код.
   */
  selectRaw: Prisma.Sql;
}

/**
 * Прогоняет произвольный источник через dm.*-нормализацию в ЕГО СОБСТВЕННУЮ
 * таблицу `opts.targetTable`. Идемпотентно (ON CONFLICT (source_ref)).
 * Возвращает число обработанных строк. В Product ничего не пишет.
 */
export async function normalizeSource(
  prisma: PrismaClient,
  opts: NormalizeSourceOpts,
): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`
    INSERT INTO ${opts.targetTable} (
      source_ref, ean, has_valid_ean,
      brand, brand_normalized, brand_key,
      name, product_name_normalized, name_key, product_key,
      volume, category, ingredients_raw, ingredients_normalized,
      description, image_url, updated_at
    )
    SELECT
      r.source_ref,
      r.ean,
      dm.is_valid_ean(r.ean),
      r.brand,
      dm.norm_brand(r.brand),
      dm.brand_key(r.brand),
      r.name,
      dm.norm_name(r.name),
      dm.name_key(r.name),
      CASE
        WHEN dm.is_valid_ean(r.ean) THEN 'bc:' || r.ean
        ELSE nullif(
          'nb:' || coalesce(dm.brand_key(r.brand), '') || '|' || coalesce(dm.name_key(r.name), ''),
          'nb:|'
        )
      END,
      coalesce(nullif(r.volume_raw, ''), dm.extract_volume(r.name)),
      ( SELECT (${CATEGORY_CASE})
        FROM (SELECT lower(coalesce(r.category_hint, '') || ' ' || coalesce(r.name, '')) AS src) c
      ),
      r.ingredients_raw,
      dm.norm_ingredients(r.ingredients_raw),
      r.description,
      r.image_url,
      now()
    FROM ( ${opts.selectRaw} ) r
    ON CONFLICT (source_ref) DO UPDATE SET
      ean                     = EXCLUDED.ean,
      has_valid_ean           = EXCLUDED.has_valid_ean,
      brand                   = EXCLUDED.brand,
      brand_normalized        = EXCLUDED.brand_normalized,
      brand_key               = EXCLUDED.brand_key,
      name                    = EXCLUDED.name,
      product_name_normalized = EXCLUDED.product_name_normalized,
      name_key                = EXCLUDED.name_key,
      product_key             = EXCLUDED.product_key,
      volume                  = EXCLUDED.volume,
      category                = EXCLUDED.category,
      ingredients_raw         = EXCLUDED.ingredients_raw,
      ingredients_normalized  = EXCLUDED.ingredients_normalized,
      description             = EXCLUDED.description,
      image_url               = EXCLUDED.image_url,
      updated_at              = now()
  `);
}
