# Skinly — Perf-расследование загрузки рекомендаций

> Статус: **инструментация готова, ожидаются измерения на реальной БД**.
> Продуктовая логика не менялась — добавлено только профилирование
> (server + web + mobile) и bench-скрипт. Оптимизации — после цифр.
>
> Дата: 2026-07-11. Основной сценарий (по решению): **seed-режим** —
> блок «Похожие товары» на карточке товара (mobile `SimilarProducts`,
> web `components/product/similar-products.tsx`).

---

## 1. Полная схема пайплайна (от открытия экрана до отображения)

### 1.1. Mobile (основной клиент)

```
Пользователь открывает /product/[id]
│
├─ useProduct(id) ──────────────── GET /api/v1/products/:id     ┐ параллельно
├─ useSkinProfile() ────────────── GET /me/beauty-profile (user)┘ (React Query)
│         │                        или MMKV (guest, ~0мс)
│         ▼
│   productQ.data.barcode готов ← ⚠️ БАРЬЕР: recommendations ждут этот момент
│
└─ useRecommendations({barcode}) ─ GET /api/v1/recommendations?barcode=…&<профиль>
          │      ⚠️ если профиль (user) доехал ПОЗЖЕ barcode — queryKey меняется
          │         и запрос уходит ДВАЖДЫ (без профиля → с профилем)
          ▼
   ┌──────────────────────────── СЕРВЕР (route.ts) ────────────────────────────┐
   │ auth (jose JWT verify)                                  [t: auth]         │
   │ parse query params                                      (≈0)              │
   │ ── service.ts ──                                                          │
   │ cache-check (только subject == null; user всегда мимо)                    │
   │ ┌ getRecoSeed(barcode) ── SQL #1 ──────────┐  ПАРАЛЛЕЛЬНО                 │
   │ └ buildPreference(subject) ── SQL #2 ──────┘  [t: getRecoSeed /           │
   │        │                                          buildPreference]        │
   │        ▼ (ждём оба)                                                       │
   │ getRecoSeedCandidates(seed, 100) ── SQL #3   [t: getRecoSeedCandidates]   │
   │        │   скан категории + overlap по jsonb на КАЖДУЮ строку             │
   │        ▼                                                                  │
   │ preScore 100 кандидатов (CPU, pure)          [t: preScore]                │
   │        ▼                                                                  │
   │ getDmCompatibilityInputs(top-40) ── SQL #4   [t: getDmCompatibilityInputs]│
   │        │   jsonb_agg полного состава 40 товаров + 2 JOIN справочников     │
   │        ▼                                                                  │
   │ jsScoring: featuresToFacts + evaluateCompatibility × 40 (CPU)             │
   │            [t: jsScoring / jsScoring.featuresToFacts /                    │
   │                jsScoring.evaluateCompatibility]                           │
   │        ▼                                                                  │
   │ gate → sort → slice(limit) → buildReasons    [t: buildItems]              │
   │        ▼                                                                  │
   │ NextResponse.json                            [t: serialization]           │
   └───────────────────────────────────────────────────────────────────────────┘
          │
          ▼  сеть (TTFB → тело)                   [client: headers / body+parse]
   React Query кэш → рендер карусели              [client: screen similar ready]
```

Последовательная цепочка серверных SQL: **#1 ∥ #2 → #3 → #4** — три
последовательных round-trip'а к Postgres после параллельной пары.

### 1.2. Web

`/product/[barcode]` рендерится на сервере (карточка уже видна), затем
клиентский `SimilarProducts` после mount (+ hydration demo store для гостя)
делает тот же `GET /api/v1/recommendations`. Web-путь короче мобильного:
нет барьера product→recs (barcode известен из URL) и нет profile-запроса
(профиль приходит в props / из demo store).

### 1.3. Замечание про дашборд

Карусель «Возможно подойдёт» на мобильном дашборде ходит **не** в
recommendations, а в `GET /api/v1/products` (`useRecommended` →
`productsApi.list`). Она вне этого расследования, но это кандидат на
переключение на recommendations API после оптимизации.

---

## 2. Инструментация (что и где добавлено)

| Слой | Где | Как включить | Что показывает |
|---|---|---|---|
| API route + service | `lib/recommendations/timing.ts` (существовал) + сплит `jsScoring.featuresToFacts` / `jsScoring.evaluateCompatibility` и счётчики `dmInputs/factsTotal/subject/pref` в `service.ts` | `RECO_TIMING=1` | одна строка `[reco-timing]` на запрос: total + все этапы + объёмы |
| Server bench | `scripts/bench-recommendations.ts` (новый) | `npm run bench:reco` | объёмы БД, проверка индексов, p50/max по этапам × сценарии, EXPLAIN ANALYZE всех SQL, HTTP e2e |
| Web client | `components/product/similar-products.tsx` | dev-сборка или `localStorage["skinly:reco-timing"]="1"` | `headers` (сеть+сервер), `json`, `render`, счётчик повторных fetch |
| Mobile API | `src/api/endpoints/recommendations.api.ts` | `__DEV__` | `headers` (TTFB), `body+parse`, items |
| Mobile hook | `src/hooks/useRecommendations.ts` | `__DEV__` | каждый вызов queryFn (ловит double-fetch по смене profileKey) |
| Mobile экран | `app/product/[id].tsx` | `__DEV__` | mount → product loaded → similar ready (полный waterfall экрана) |

### Как снять измерения (на вашей машине, реальная БД)

```bash
# 1. Серверный пайплайн + SQL-планы (главное):
cd skinly
npm run bench:reco 2>&1 | tee reco-bench.log

# 2. (желательно) end-to-end через HTTP — поднять dev/prod-сборку и:
RECO_TIMING=1 npm run dev          # в одном терминале
npm run bench:reco -- --url http://localhost:3000 2>&1 | tee -a reco-bench.log
#   строки [reco-timing] из консоли dev-сервера тоже прислать

# 3. (опционально) мобильный клиент: expo dev-сборка, открыть карточку товара,
#    собрать строки [reco-timing:mobile] из Metro-консоли.
```

Прислать: `reco-bench.log` + строки `[reco-timing]` / `[reco-timing:mobile]`.
По ним заполняются разделы 4–6.

---

## 3. Статический анализ (гипотезы до измерений)

Код уже прошёл один perf-проход (commit `1a585e4`): двухэтапный скоринг
(pre-score 100 → compatibility только top-40), параллельный seed∥preference,
in-memory TTL-кэш для гостей, индексы в `scripts/sql/reco-indexes.sql`.
Ниже — что осталось подозрительным. **Вклад каждого пункта подтверждается
или опровергается bench-логом.**

### 3.1. SQL / Prisma

**S1. `getRecoSeedCandidates` — главный подозреваемый.**
Для каждой строки категории (после gates) выполняется коррелированный
подзапрос: `jsonb_array_elements(canonical_ingredients)` × `IN (<cset>)`.
Это O(размер категории × длина состава × размер cset) — на категории
«Лицо»/«Волосы» (тысячи–десятки тысяч товаров при каталоге 60k+) парсинг
jsonb на каждую строку. Сортировка по overlap требует вычислить его для
ВСЕХ строк до LIMIT 100. Индекс `idx_dm_products_category_quality` сужает
только выборку категории, не overlap.
*Проверка:* EXPLAIN в bench (§4) + доля этапа в total.

**S2. `getDmCompatibilityInputs` (SQL #4) — тяжёлая сборка jsonb.**
Для 40 товаров: LATERAL `jsonb_to_recordset` + JOIN двух справочников +
`jsonb_agg` из **12 полей на ингредиент**, из которых рекомендациям не
нужны `inci_name`, `display_ru`, `display_en` (нужны только tags/benefits/
cautions/flags/позиция — display-поля нужны карточке товара, не reco).
Лишние поля = больше времени сборки в PG, больше байт по проводу, дороже
десериализация в Prisma.
*Проверка:* доля этапа + EXPLAIN.

**S3. Три последовательных SQL round-trip'а.**
seed∥preference → candidates → compatInputs. Каждый ходит в Postgres
отдельно; при сетевой БД RTT суммируется. Потенциальное слияние: seed +
candidates в один CTE-запрос (−1 round-trip), либо candidates сразу
возвращает состав top-K.
*Проверка:* если p50 этапов ≈ RTT-bound (малое execution time в EXPLAIN
при заметном времени этапа) — виноваты round-trip'ы.

**S4. Применены ли индексы `reco-indexes.sql` на проде/локально —
неизвестно.** Файл есть в репо, но это ручной SQL вне Prisma-миграций.
*Проверка:* bench печатает ✅/❌ по каждому.

**S5. `buildPreference`** — один запрос (N+1 нет), но `jsonb_array_elements`
на каждое из ≤500 событий + LEFT JOIN двух dm-таблиц. Идёт параллельно с
seed, поэтому влияет на total только если дольше seed.
*Проверка:* этап `buildPreference` в user-сценарии bench.

### 3.2. Алгоритм

**A1. Состав читается дважды.** SQL #3 уже разворачивает
`canonical_ingredients` каждого кандидата (для overlap), а SQL #4 заново
тянет полный состав top-40. Дублирования вычислений в JS нет, но данные о
составе гоняются по проводу дважды в разной форме.

**A2. CPU-этапы (preScore 100, engine × 40, reasons × 10)** — по прошлому
рефакторингу ожидаемо дёшевы (<5–10 мс суммарно). Новый сплит
`jsScoring.*` подтвердит или опровергнет.

**A3. Кэш не работает для залогиненных.** Любой subject (Bearer) →
полный пайплайн на каждый запрос, by design (§cache.ts). Если бэкенд-часть
окажется дорогой, кандидат — кэшировать неперсонализированную часть
(seed+candidates+compat по `(barcode, profile)`) и накладывать preference
поверх кэша.

### 3.3. Frontend

**F1. Mobile: double-fetch на карточке (user-режим).** `queryKey` включает
`serializeProfileKey(profileQuery.data)`, а `enabled` требует только
barcode. Пока `GET /me/beauty-profile` не завершился, уходит запрос с
`profileKey=none`; когда профиль доехал — ключ меняется → **второй** полный
запрос. Для холодного старта залогиненного пользователя это гарантированные
2 × полный серверный пайплайн.
*Проверка:* два `queryFn fire` подряд в `[reco-timing:mobile]`.

**F2. Mobile: последовательный барьер product → recommendations.**
recsQ стартует только после загрузки товара (нужен `barcode` из ответа).
Если экран открыт по штрихкоду (после скана), barcode уже известен из URL —
запросы могли бы идти параллельно.
*Проверка:* разница `screen product loaded` ↔ `screen similar ready`.

**F3. Web: блок ждёт полный ответ** (fetch после mount; для гостя — ещё и
hydration demo store). Ничего криминального, но `effect→visible` в логе
покажет цену.

**F4. Сеть/полезная нагрузка.** Ответ ≤ 30 items — маленький; `ky` retry
(до 2 повторов на 5xx/408) может давать редкие ×3 хвосты. Второстепенно.

---

## 4. Результаты измерений

> ⏳ Заполняется из `reco-bench.log` (см. §2). Структура:
>
> - объёмы БД и категорий, статус индексов;
> - таблица этапов: run1 (холодный) / p50 / max — по сценариям
>   (гость без профиля, гость с профилем, cache-hit, user+preference)
>   и по seed'ам (большая / средняя / малая категория);
> - EXPLAIN ANALYZE: узлы-лидеры по времени, Buffers, отсутствие индексов;
> - HTTP e2e: ttfb/total vs серверный total (= сетевая надбавка);
> - mobile: наличие double-fetch, цена waterfall'а экрана.

## 5. Bottleneck'и: вклад, выигрыш, сложность, приоритет

> ⏳ Заполняется после §4. Формат: таблица
> `# | узкое место | вклад в total, мс (%) | ожидаемый выигрыш | сложность | приоритет`.

## 6. План оптимизации

> ⏳ После §5, по убыванию (выигрыш / сложность). Кандидаты уже описаны в
> §3 (S1–S5, A1–A3, F1–F4), но порядок и целесообразность — только по цифрам.
