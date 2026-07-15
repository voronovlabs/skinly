# Магнит Косметик — парсер (ЭКСПЕРИМЕНТАЛЬНЫЙ)

**Статус: транспорт подтверждён (2026-07). Массовый импорт пока не
запускался — только dry-run.** Запуск закрыт флагом `--experimental`.

## Транспорт

| Транспорт | Результат |
|---|---|
| Sitemap (`/__sitemap__/products.xml`) | ✅ полный список ~7 276 URL карточек |
| Прямые HTTP-запросы к карточкам | ❌ `HTTP 423 / 403` — защита **QRATOR** |
| Playwright + Chrome, headless, **без VPN** | ✅ стабильно (проверено 5/5, затем endurance) |

История: изначально карточки отдавали `HTTP 423`, `x-rkn-status: on`
(«Выключите VPN») — **причиной был включённый VPN**. С выключенным VPN
headless Chrome через Playwright открывает карточки штатно. HTTP-fetcher для
карточек не используется (QRATOR режет клиентов вне браузера) — транспорт
только браузерный, одна долгоживущая persistent-сессия, ~1 карточка/сек.

## Команды

```bash
# диагностика: чистый headful Chrome, временный профиль, ENV/launch args, 1 карточка
npm run diag:magnit

# smoke + endurance: каталог → карточка → 20–30 карточек той же сессией
npm run smoke:magnit

# dry-run на первых 5 товарах sitemap
npm run scrape:magnit:experimental -- --experimental --limit 5 --dry-run --save-json

# dry-run на репрезентативной выборке (2 лицо / 2 волосы / 2 тело / 2 макияж / 2 не-косметика)
npm run scrape:magnit:experimental -- --experimental --sample-categories --dry-run --save-json --debug

# одна карточка / категория
npm run scrape:magnit:experimental -- --experimental --product-url "https://cosmetic.magnit.ru/product/..." --dry-run
npm run scrape:magnit:experimental -- --experimental --category-url "https://cosmetic.magnit.ru/catalog/100656-..." --dry-run
```

**Про категории:** enum `ProductCategory` skincare-центричный
(CLEANSER…TREATMENT, OTHER). Волосы, декоративный макияж, дезодоранты,
бритьё, депиляция и парфюмерия не имеют значения в enum → корректно
попадают в `OTHER` (новые значения не создаём). Уход за лицом и телом
раскладывается по существующим значениям.

Артефакты диагностики: `data/magnit-cosmetic/{diag,smoke,debug}/`
(HTML, screenshot, cookies, network-лог, summary.json).

## Что здесь лежит

Полный конвейер (работоспособность подтверждена на фикстурах и мок-тестах,
живьём — только discovery): `browser.ts` (headless Playwright-сессия),
`discovery.ts` (sitemap + категории), `product.ts` (парсер карточки:
JSON-LD → DOM → plain-text), `categories.ts` (mapper → `ProductCategory`,
beauty-фильтр, emoji), `normalize.ts` (barcode `mc:<id>`, merge-safe поля),
`db.ts` (upsert по `source="magnit_cosmetic"` + `externalId`, защита
barcode/descriptionEn/локализованных картинок), `storage.ts`
(JSONL + checkpoint/resume), `smoke-playwright.ts`, `diag-clean-profile.ts`,
`api.ts` (неподключённый эксперимент с web-gateway).

Если у Магнита появится легальный источник данных (фид/выгрузка/API) —
нормализация, категоризация и merge-логика переиспользуются как есть,
заменить нужно только слой получения данных.
