# Магнит Косметик — парсер (5 независимых этапов)

**Статус: транспорт подтверждён (2026-07).** Браузерные команды (этапы 1 /
retry-failed) закрыты флагом `--experimental`.

## Транспорт

| Транспорт | Результат |
|---|---|
| Sitemap (`/__sitemap__/products.xml`) | ✅ полный список ~7 276 URL карточек |
| Прямые HTTP-запросы к карточкам | ❌ `HTTP 423 / 403` — защита **QRATOR** |
| Playwright + Chrome, headless, **без VPN** | ✅ стабильно (проверено 5/5, затем endurance) |

История: `HTTP 423`, `x-rkn-status: on` («Выключите VPN») — причиной был
включённый VPN. С выключенным VPN headless Chrome открывает карточки штатно.
Транспорт карточек — только браузерный, одна persistent-сессия, ~1 карточка/сек.

## Пайплайн

Импорт полностью разделён на независимые этапы. Каждый этап читает выход
предыдущего, работает потоково (каталог не держится в памяти) и
перезапускается идемпотентно.

```
ЭТАП 1  scrape        sitemap → Playwright-карточки
                      → data/raw/magnit-cosmetic-products.jsonl (append-only,
                        единственный источник истины; ни нормализации, ни БД)
        retry-failed  повтор карточек из failed-products.jsonl (отдельная команда)
ЭТАП 2  normalize     raw JSONL → data/magnit-cosmetic/normalized-products.jsonl
                      (+ skipped-products.jsonl; без БД)
ЭТАП 3  images        скачивание изображений → storage/product-images/ab/cd/<sha256>.<ext>
                      (формат migrate-product-images), imageUrl → внутренний
                      /product-images/... URL, исходный URL остаётся в sourceImageUrl
ЭТАП 4  barcodes      поиск настоящих EAN на barcode-list.ru (клиент
                      scripts/farera/barcode-list, 1 запрос / 2–3 сек)
                      → data/raw/magnit-cosmetic-barcode-matches.jsonl
ЭТАП 5  import        normalized JSONL → upsertProduct() → Postgres.
                      Временный barcode mc:<externalId> подменяется на EAN
                      (только status=matched + валидная контрольная сумма;
                      в БД mc:-barcode апгрейдится до EAN, настоящий barcode
                      никогда не перезаписывается)
```

### Resume и ошибки

- **Resume этапа 1 — из самого JSONL**: если `externalId` уже есть в
  `magnit-cosmetic-products.jsonl`, карточка повторно не скачивается
  (`--refetch` — осознанная перекачка; свежая запись дописывается в конец,
  этап 2 берёт последнюю). `state.json` упразднён — аварийное завершение
  теряет максимум одну оборванную строку, которую потоковый читатель молча
  пропускает.
- **Ошибки не тормозят проход**: неудачные карточки уходят в
  `data/magnit-cosmetic/failed-products.jsonl`, парсер продолжает. Повтор —
  только командой `magnit:retry-failed` (успехи переезжают в основной JSONL,
  файл ошибок переписывается атомарно).
- **Удалённые товары (404)**: SPA-заглушка «Здесь ничего не нашлось»
  (`.app-empty-404`) распознаётся сразу после навигации, без прожигания
  таймаута селектора (`ProductNotFoundError`, код `PRODUCT_NOT_FOUND`).
  Это не временная ошибка: такие id уходят в append-only
  `not-found-products.jsonl`, в failed не попадают, не ретраятся и
  пропускаются при следующих scrape/resume (перекачка — только `--refetch`).
- Производные файлы (normalized/skipped/failed) переписываются только
  атомарно: `<file>.part` → `rename`.

### Этап 4: multi-query fallback

Один длинный запрос «brand + полное name» на barcode-list.ru почти всегда
давал not_found (бренд дублировался, название перегружено служебными
словами). Теперь `query-builder.ts` строит **до 3 уникальных запросов от
строгого к широкому**:

```
brand=Gillette, name="Кассеты для бритья Gillette Mach3 Turbo 4шт"
  1. "Gillette Mach3 Turbo 4 шт"   (ядро + объём/кол-во)
  2. "Gillette Mach3 Turbo"        (без объёма)
  3. "Gillette Mach3"              (укороченное ядро)
```

Правила генерации: бренд (кроме `Unknown`) добавляется отдельно и удаляется
из названия; объём/вес/количество (`50 мл`, `0.2 л`, `200 г`, `4 шт`)
извлекается и нормализуется («число пробел единица»); убираются служебные
слова («для», «уход», «средство», «кожи», «лица»… — только как отдельные
токены) и повторы; названия линеек/моделей/оттенков (Mach3, Turbo, SPF50,
№7, номер тона) сохраняются — если такие токены есть, строгие запросы
строятся по ним.

Алгоритм перебора: запросы пробуются по очереди (каждый — отдельный
HTTP-запрос с тем же rate-limit 2–3 сек); первый `matched` останавливает
перебор; если matched нет — берётся лучший `ambiguous` по score, кандидаты
со всех запросов объединяются (дедуп по barcode, топ-8 по score);
`not_found` — только когда ВСЕ запросы вернули пустой список; `error` —
только когда все запросы упали сетевыми ошибками. Пороги скоринга
(`MATCH_THRESHOLD` и пр.) не менялись — fallback повышает recall, не трогая
precision.

Строка JSONL дополнена полями `queriesTried` (все запросы), `volume`,
`matchedQueryIndex` (какой запрос дал результат); `query` — запрос,
давший итоговый matched/ambiguous. Файл append-only: на externalId может
быть несколько строк (после `--retry-*`), resume этапа 4 и import (этап 5)
используют **последнюю** запись.

Флаги: `--retry-errors` / `--retry-not-found` / `--retry-ambiguous` —
повторная обработка товаров с соответствующим последним статусом;
`--limit N` ограничивает число товаров (не HTTP-запросов); `--dry-run` —
показать сгенерированные запросы без сети и без записи.

Unit-проверки генерации запросов: `scripts/magnit-cosmetic/query-builder.check.ts`.

## Команды

```bash
# этап 1 — проба на 5 карточках / весь каталог / повтор ошибок
npm run magnit:scrape -- --experimental --limit 5
npm run magnit:scrape -- --experimental --all
npm run magnit:retry-failed -- --experimental

# одна карточка / категория
npm run magnit:scrape -- --experimental --product-url "https://cosmetic.magnit.ru/product/..."
npm run magnit:scrape -- --experimental --category-url "https://cosmetic.magnit.ru/catalog/100656-..."

# этап 2 — нормализация (офлайн, без БД)
npm run magnit:normalize
npm run magnit:normalize -- --verbose --limit 50

# этап 3 — изображения (локальное хранилище, imageUrl → /product-images/...)
npm run magnit:images -- --dry-run
npm run magnit:images
npm run magnit:images -- --public-base-url https://skinly.msvoronov.com

# этап 4 — настоящие EAN (barcode-list.ru, медленно: ~2.5 сек/запрос, до 3 запросов/товар)
npm run magnit:barcodes -- --limit 200
npm run magnit:barcodes -- --dry-run --limit 20        # показать запросы, без сети
npm run magnit:barcodes -- --retry-errors
npm run magnit:barcodes -- --limit 100 --retry-not-found --retry-ambiguous

# этап 5 — импорт в Postgres (единственный этап с БД)
npm run magnit:import -- --dry-run
npm run magnit:import
```

Диагностика браузерного транспорта: `npm run diag:magnit`, `npm run smoke:magnit`.
Артефакты: `data/magnit-cosmetic/{diag,smoke,debug}/`, summary последнего
этапа — `data/magnit-cosmetic/summary.json`.

**Про категории:** enum `ProductCategory` skincare-центричный
(CLEANSER…TREATMENT, OTHER). Волосы, декоративный макияж, дезодоранты,
бритьё, депиляция и парфюмерия не имеют значения в enum → корректно попадают
в `OTHER` (новые значения не создаём).

## Что здесь лежит

`browser.ts` (headless Playwright-сессия), `discovery.ts` (sitemap +
категории), `product.ts` (парсер карточки: JSON-LD → DOM → plain-text,
публичный `fetchProductViaBrowser()`), `categories.ts` (mapper →
`ProductCategory`, beauty-фильтр, emoji), `normalize.ts`
(`normalizeProduct()`: barcode `mc:<id>`, merge-safe поля), `db.ts`
(`upsertProduct()` по `source + externalId`; защита barcode/descriptionEn/
локализованных картинок; апгрейд `mc:` → EAN), `storage.ts` (потоковый JSONL:
`streamJsonl` / `readJsonlKeys` / `appendJsonl` / `AtomicJsonlWriter`),
`stage-*.ts` (этапы 1–5), `index.ts` (CLI-диспетчер),
`smoke-playwright.ts`, `diag-clean-profile.ts`, `api.ts` (неподключённый
эксперимент с web-gateway).

Если у Магнита появится легальный источник данных (фид/выгрузка/API) —
нормализация, категоризация и merge-логика переиспользуются как есть,
заменить нужно только этап 1.
