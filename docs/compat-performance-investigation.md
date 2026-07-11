# Skinly — Perf-расследование блока «Подходимость товара»

> Статус: **инструментация готова, ожидаются измерения на реальной БД**.
> Продуктовая логика НЕ менялась — только профилирование + bench.
> Оптимизации — после реальных цифр (before/after, с fallback'ами, без
> изменения бизнес-логики оценки, контракта API и текстов объяснений).
>
> Дата: 2026-07-11. Цель: cold < 150–200 ms, warm — десятки ms.
> Блок «Похожие продукты» (уже ускорен) не затрагивается.

---

## 1. Карта пайплайна

### 1.1. MOBILE — от открытия карточки до вердикта

```
Пользователь открывает /product/[id]
│
├─ useProduct(id) ────────── GET /api/v1/products/:id            ┐ параллельно
│     сервер: findUnique(id) ← ПРОМАХ для barcode-URL            │
│             findUnique(barcode) + ingredients include          │
│             reviewAggregate → DTO (полный состав + displayName │
│             + description на каждый ингредиент)                │
├─ useSkinProfile() ──────── GET /me/beauty-profile (user)       ┘
│                            или MMKV (guest, ~0 мс)
│         ▼
│   product загружен ← ⚠️ БАРЬЕР: useCompatibility ждёт product
│         ▼
└─ useCompatibility(id, product) → compatibilityApi.evaluate:
      1) evaluateMockCompatibility (локальный CPU, всегда)
      2) если профиль есть → GET /api/v1/products?forMe=1&q=<barcode>&limit=10
         ┌────────────────────── СЕРВЕР ──────────────────────────────┐
         │ searchProducts(q=barcode) — trgm/LIKE по 62k Product       │
         │ attachIngredients(≤10 товаров) — legacy public-состав      │
         │ resolveCompatibilityBatch:                                 │
         │   getDmCompatibilityInputs(≤10 barcodes) ← ТЯЖЁЛЫЙ батч,   │
         │     jsonb_agg 12 полей/ингредиент (incl. display_ru/en)    │
         │   featuresToFacts ×10 → evaluateCompatibility ×10          │
         │ sort по score → сериализация СТРАНИЦЫ (10 товаров)         │
         └────────────────────────────────────────────────────────────┘
      3) клиент ищет в странице СВОЙ barcode → берёт score/verdict,
         reasons/positives/warnings ЗАТИРАЮТСЯ ([]) — объяснения
         показываются только из локального mock-движка
│
▼  verdict «Подходит / с ограничениями / не подходит» виден
```

⚠️ Ключевое: ради **одного** товара выполняется **поиск по каталогу + скоринг
до 10 товаров + два последовательных HTTP-запроса** (product → forMe), плюс
потенциальный **double-fetch** (queryKey включает profileKey, а enabled
требует только product — профиль доехал позже → пересчёт).

### 1.2. WEB — SSR /product/[id-or-barcode]

```
generateMetadata: findInDb(idOrBarcode)      ← ⚠️ ДУБЛЬ productLoad
page:
  loadServerProfile: auth (getCurrentUser → JWT + Prisma user)
                     → profileLoad (getBeautyProfileByUserId)   ┐ последовательно
  findInDb: findUnique(id) ← промах для barcode-URL             │ (waterfall,
            findUnique(barcode) + ingredients include           ┘  4 запроса подряд)
  resolveCompatibility:
    getDmCompatibilityInput(barcode) — jsonb_agg 12 полей
    featuresToFacts → evaluateCompatibility (результат ВЫБРАСЫВАЕТСЯ —
      сервер шлёт клиенту только facts)
  RSC payload → клиент: ProductCompatibilitySection
    evaluateCompatibility(profile, facts) — ПЕРЕСЧЁТ на клиенте
    VerdictCard + rows + reasons (объяснения — client-side)
```

⚠️ Ключевое: продукт грузится **дважды** (metadata + page), auth → profile →
product — **последовательно**, движок считается **дважды** (сервер считает и
выбрасывает; клиент пересчитывает), facts целиком сериализуются в RSC payload.

### 1.3. SQL этого пайплайна

| Запрос | Где | Подозрение |
|---|---|---|
| `findUnique(id)` → промах | оба route + web page | лишний round-trip на каждый barcode-URL |
| `findUnique(barcode) + ingredients include` | products/:id, web page | Prisma include = 2–3 запроса |
| `reviewAggregate` | products/:id | последовательный, мог бы быть параллельным |
| `searchProducts(q=barcode)` | mobile forMe | trgm/LIKE скан ради точного barcode-lookup |
| `attachIngredients(≤10)` | mobile forMe | состав 10 товаров ради одного |
| `queryCompatRows(1)` / `(≤10)` | resolveCompatibility | jsonb_agg 12 полей; display_ru/en/inci_name для расчёта не нужны |

---

## 2. Гипотезы bottleneck'ов (проверяются bench-логом)

**C1 (mobile). Каталожный поиск вместо точечного lookup.** forMe-запрос ради
одного товара: `searchProducts` по 62k строк + `attachIngredients` + batch
DM-входы + движок ×10. Ожидаемый лидер по времени.

**C2 (mobile). Два последовательных HTTP + double-fetch.** verdict ждёт
product-запрос, затем forMe-запрос (сумма latency); при позднем профиле —
forMe уходит дважды. Логи `queryFn fire` / `screen verdict ready` покажут.

**C3 (web). Дубль productLoad (generateMetadata + page) и waterfall
auth → profile → product.** Строки scope=web:metadata в COMPAT_TIMING.

**C4 (оба). `queryCompatRows` тащит display_ru/display_en/inci_name** —
для расчёта не нужны (нужны tags/benefits/cautions/flags/цифры риска);
web-путь дополнительно шлёт всё это в RSC payload (factsBytesToClient).

**C5 (web). Двойной расчёт движка** (сервер выбрасывает, клиент
пересчитывает) — CPU копейки, но facts-payload и hydration не бесплатны.

**C6. Нет кэша по (barcode, profile fingerprint).** DM-слой статичен между
refresh'ами; результат детерминирован — кандидат на TTL-кэш (после цифр).

**C7. Промах findUnique(id) для barcode-URL** — +1 round-trip везде.

**C8 (mobile). reviewAggregate последовательно с product-запросом.**

Ожидание по масштабу (по аналогии с reco): C1 — сотни ms; C2/C3 — сложение
двух-четырёх round-trip'ов; C4 — десятки ms; остальное — единицы ms.

---

## 3. Файлы, изменённые ТОЛЬКО для профилирования

Backend (skinly):

| Файл | Что добавлено |
|---|---|
| `lib/compatibility/timing.ts` (новый) | CompatTimer: этапы + counts + meta, `COMPAT_TIMING=1`, noop иначе |
| `lib/compatibility/resolve-compatibility.ts` | опц. `timer`: этапы dmCompatibilityInputs / featuresToFacts / evaluateCompatibility, объёмы dmRows/batchDmRows, source=dm/legacy. Поведение не менялось (noop-default) |
| `app/api/v1/products/[id]/route.ts` | этапы productLoad.byId/.byBarcode, reviewAggregate, serialization; counts: ingredients, bytes |
| `app/api/v1/products/route.ts` | forMe-ветка: productLoad(list+ingredients), batch-этапы, buildItems, serialization; counts: items, legacyInciLoaded, bytes |
| `app/product/[barcode]/page.tsx` | auth, profileLoad, productLoad (page и metadata раздельно — ловим дубль), resolveCompatibility; counts: facts, factsBytesToClient |
| `components/product/compatibility-section.tsx` | client: `[compat-timing:web] evaluate#N engine=…ms facts=…` (счётчик пересчётов = ререндеры) |
| `scripts/bench-compatibility.ts` (новый) + `bench:compat` в package.json | bench: service + HTTP + EXPLAIN |

Mobile (skinly-mobile):

| Файл | Что добавлено |
|---|---|
| `src/api/endpoints/compatibility.api.ts` | `[compat-timing:mobile] evaluate … local=…ms backend=…ms backendHit` + `backend page itemsScored=N` |
| `src/hooks/useProduct.ts` (useCompatibility) | `queryFn fire productId=… profileKey=…` — детектор double-fetch |
| `app/product/[id].tsx` | `screen verdict ready +…ms after mount` — полный waterfall до вердикта |

Всё за `COMPAT_TIMING=1` (сервер) / `__DEV__` (mobile) / dev или
`localStorage["skinly:compat-timing"]="1"` (web) — в prod-сборке нулевая цена.

---

## 4. Команды запуска

```bash
# 1. Service-level + EXPLAIN (главное):
cd skinly
npm run bench:compat 2>&1 | tee compat-bench.log

# свой товар / больше прогонов:
npm run bench:compat -- --barcode 4600702084566
npm run bench:compat -- --runs 9

# 2. HTTP end-to-end (поднять сервер с таймингом):
COMPAT_TIMING=1 npm run dev            # терминал 1
npm run bench:compat -- --url http://localhost:3000 2>&1 | tee -a compat-bench.log
#   строки [compat-timing] из консоли dev-сервера — тоже прислать

# 3. Web-клиент: открыть /product/<barcode> в dev (или prod с
#    localStorage skinly:compat-timing=1) → строки [compat-timing:web]

# 4. Mobile: expo dev-сборка → открыть карточку товара (user с профилем) →
#    строки [compat-timing:mobile] из Metro-консоли
```

## 5. Формат логов, которые нужно прислать

1. **`compat-bench.log`** целиком — содержит: объёмы БД, profileLoad,
   WEB path (3 сценария × 3 товара, run1/p50/max по этапам), MOBILE path,
   EXPLAIN всех SQL, HTTP ttfb/total/bytes.
2. **Сервер** (`COMPAT_TIMING=1`): строки вида
   `[compat-timing] products/:id total=…ms productLoad.byId=… … | n: ingredients=32 bytes=18400 | id=… hit=byBarcode`
   `[compat-timing] products?forMe total=…ms productLoad(list+ingredients)=… dmCompatibilityInputs(batch)=… … | n: items=10 batchDmRows=… bytes=…`
   `[compat-timing] web:/product total=…ms auth=… profileLoad=… productLoad.byId=… … | n: facts=27 … factsBytesToClient=…`
   `[compat-timing] web:metadata …` — дубль productLoad.
3. **Mobile** (`__DEV__`): `queryFn fire …` (сколько раз на одну карточку),
   `evaluate … local/backend`, `backend page itemsScored=N`,
   `screen verdict ready +…ms`.
4. **Web** (`dev`): `evaluate#N engine=…ms facts=…` (N>1 на одну карточку =
   лишние пересчёты).

## 6. Результаты измерений (bench 2026-07-11, реальная БД)

Движок и DM-путь быстрые, проблема — только в архитектуре mobile-пути:

| Этап | p50 |
|---|---|
| getDmCompatibilityInput (1 barcode) | 3–7 ms |
| featuresToFacts | <0.1 ms |
| evaluateCompatibility | <1 ms |
| **WEB path целиком (single-product)** | **10–20 ms** |
| **MOBILE path** `GET /products?forMe=1&q=<barcode>` **total** | **2480–2713 ms** |
| — из них productLoad(list+ingredients) | 2526–2749 ms |
| — dmCompatibilityInputs(batch) | 4–7 ms |

EXPLAIN `searchProducts(q=barcode)`: **Seq Scan** по `public.Product`,
Rows Removed by Filter: 63 449, Execution ~2570 ms — `LIKE '%barcode%'`
по brand/name/category/barcode. При этом `itemsScored=1`: каталожный поиск
по всей таблице выполнялся ради совместимости одного товара.

Подтверждены: **C1** (главный, ~97% total), C2 (двойной HTTP + double-fetch),
плюс UX-дефект — backend reasons затирались пустыми массивами.

## 7. Реализованное решение (P0)

### 7.1. Новый endpoint `GET /api/v1/products/:idOrBarcode/compatibility`

`app/api/v1/products/[id]/compatibility/route.ts`:
точечный `findUnique(id → barcode)` с лёгким select (только inci+position)
→ существующий `resolveCompatibility` (DM `getDmCompatibilityInput(1 barcode)`
→ fallback на legacy `inciToFact` при recognizedRatio < 0.3 / ошибке DM)
→ `formatRuleHits` → DTO `{productId, barcode, score, verdict, lowConfidence,
source, reasons[], positives[], warnings[]}` (формат = mobile
`CompatibilityReason {key, text, kind}`).

**searchProducts исключён полностью** — endpoint не зовёт
`listProducts`; каталожный поиск и «Похожие продукты» не тронуты.
Бизнес-логика score/verdict — тот же `evaluateCompatibility`, без изменений.
Тексты причин — те же i18n-строки `compatibility.*` (messages/ru|en.json),
что видит web: `lib/compatibility/format-reasons.ts` (интерполяция ICU +
локализация enum-аргументов, dedupe + top-4 — правила отображения web-блока).

### 7.2. Кэш

`lib/compatibility/compat-cache.ts` — in-memory TTL по
`idOrBarcode::locale::profile-fingerprint` (10 мин, LRU 500, frozen;
`COMPAT_CACHE=0` отключает, `COMPAT_CACHE_TTL_MS` меняет TTL). Безопасно:
ответ детерминирован между refresh'ами DM/каталога.

### 7.3. Mobile

- `compatibility.api.ts`: зовёт новый endpoint; **reasons/positives/warnings
  берутся из backend и больше не затираются**; локальный mock — только
  fallback (нет профиля / нет barcode / сеть или backend упали) — поведение
  guest-режима прежнее.
- `useCompatibility`: `enabled` ждёт settled-профиль → double-fetch по
  profileKey устранён (для гостя профиль из MMKV мгновенный — задержки нет).

### 7.4. COMPAT_TIMING

Сохранён: новый route логирует productLoad.byId/.byBarcode,
dmCompatibilityInputs, featuresToFacts, evaluateCompatibility,
buildExplanation, serialization + counts (facts, bytes) + `cache=hit|miss`.

### 7.5. Деплой и re-bench (before/after)

Порядок выката: **сначала backend** (endpoint аддитивный), потом mobile —
старый клиент продолжает работать через прежний путь.

```bash
# сервер с новым endpoint:
COMPAT_TIMING=1 npm run dev                       # терминал 1
npm run bench:compat -- --url http://localhost:3000 2>&1 | tee compat-bench-after.log
```

В bench добавлены: секция «4b. NEW endpoint path» (service-level AFTER;
секция 4 MOBILE path осталась как BEFORE) и HTTP-probe
`AFTER /products/:b/compatibility` (run1 = cache miss, run2+ = hit → warm).

Ожидание: cold ≈ 10–30 ms server-side (+сеть) вместо ~2.5 s; warm (cache hit)
≈ 1–3 ms; verdict на экране — после одного быстрого запроса вместо
каталожного поиска, без повторного fetch'а при позднем профиле.

### 7.6. Осталось (вторичное, не блокирует P0)

- **web:** дубль `findInDb` (generateMetadata + page) → `react cache()`;
  двойной расчёт движка (сервер + клиент) и facts в RSC payload;
- **C4:** убрать `inci_name`/`display_ru`/`display_en` из `queryCompatRows`
  для путей, где они не нужны (сейчас DM-вход 3–7 ms — низкий приоритет);
- mobile: `GET /products/:id` мог бы сразу включать compatibility при
  наличии профиля (вариант b) — рассмотреть после замеров нового пути.
