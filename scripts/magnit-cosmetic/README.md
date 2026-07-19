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

# этап 4 — настоящие EAN (barcode-list.ru, медленно: ~2.5 сек/товар)
npm run magnit:barcodes -- --limit 200
npm run magnit:barcodes -- --retry-errors

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
