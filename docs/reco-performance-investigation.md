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

## 4. Результаты измерений (bench 2026-07-11, реальная БД)

Seed 8022297169743, категория «Волосы» (~20k товаров):

| Этап | p50 | max | Доля total |
|---|---|---|---|
| **getRecoSeedCandidates** | **1689–2369 ms** | 2751 ms | **~95–98%** |
| getDmCompatibilityInputs | 75–100 ms | — | ~4% |
| getRecoSeed | 2–10 ms | — | <1% |
| jsScoring (facts+engine ×40) | 7–15 ms | — | <1% |
| buildItems (reasons) | <1 ms | — | ~0% |
| **total getRecommendations** | **1695–2470 ms** | 2827 ms | 100% |

EXPLAIN ANALYZE `getRecoSeedCandidates` (Execution 1792 ms): Seq Scan по
`dm_products`, ~20 114 строк проходят фильтр категории, ~17 643 доходят до
расчёта overlap, причём `jsonb_array_elements` разворачивается **дважды** на
кандидата (в фильтре `overlap >= 1` и повторно в сортировке).

Profile-режим: `getRecoProfileCandidates` p50 ~957 ms (EXPLAIN ~1055 ms),
перебор 42k+ товаров с JOIN.

Кэш: HTTP p50 ~48 ms при попадании, но **холодный запрос ~2.6 s** — кэш не
решает первое открытие товара (а для залогиненных не работает вообще).

Вывод: гипотеза S1 подтверждена и объясняет практически весь total. S2
(getDmCompatibilityInputs, 75–100 ms) и CPU-этапы — второй порядок малости.

## 5. Bottleneck'и: вклад, выигрыш, сложность, приоритет

| # | Узкое место | Вклад | Ожидаемый эффект | Сложность | Приоритет |
|---|---|---|---|---|---|
| S1 | `getRecoSeedCandidates`: Seq Scan + 2× jsonb-explode на ~17.6k товаров | ~95–98% total (1.7–2.4 s) | total → **<300 ms** cold | средняя (новая MV + запрос + fallback) | **P0 — сделано** |
| S1b | `getRecoProfileCandidates`: скан+JOIN 42k без LIMIT-aware доступа | ~957 ms profile-mode | → **~1–5 ms** | низкая (MV top-500) | **P1 — сделано** |
| S2 | `getDmCompatibilityInputs`: jsonb_agg 12 полей × 40 товаров | 75–100 ms | −30–50 ms (убрать display-поля) | низкая | P2 — после re-bench |
| A3 | кэш не работает для залогиненных | full pipeline на каждый запрос | после P0 малоактуально | средняя | P3 |
| F1 | mobile double-fetch (профиль доезжает позже queryKey) | ×2 запроса на холодный экран | −1 полный запрос | низкая | P3 (после P0 цена ниже) |
| F2 | mobile waterfall product → recommendations | + время product-запроса | параллелизация | низкая | P3 |
| — | jsScoring / buildItems / serialization / auth | <20 ms суммарно | не трогать | — | — |

## 6. Реализованное решение (P0 + P1)

### 6.1. Почему legacy-запрос был медленным

Overlap считался коррелированным подзапросом `jsonb_array_elements` по
детоастированному jsonb-массиву **каждого** из ~17.6k кандидатов категории, и
из-за `WHERE overlap >= 1` + `ORDER BY overlap` выражение вычислялось дважды.
Никакой индекс это не чинит: btree сужает только категорию, GIN по jsonb
(`jsonb_path_ops`) умеет containment одного значения, но не *счёт*
пересечений — массив всё равно разворачивается per-row, и GIN не
комбинируется с фильтром категории в одном индексе.

### 6.2. Решение: нормализованная витрина `dm.product_canonical`

`sql/dm/34_reco_candidates.sql` создаёт MV «1 строка = 1 вхождение
ингредиента в товар» (`business_key, category, canonical_id, position`,
~1M узких строк) с индексом `(category, canonical_id) INCLUDE (business_key)`.

Новый запрос (fast-path в `dm-recommendations.ts`):

```sql
WITH ov AS (
  SELECT pc.business_key, count(*)::int AS overlap
  FROM dm.product_canonical pc
  WHERE pc.category = $1
    AND pc.canonical_id IN (<cset>)      -- только ингредиенты seed'а
    AND pc.business_key <> $2
  GROUP BY pc.business_key
)
SELECT <CANDIDATE_COLS>, ov.overlap
FROM ov
JOIN dm.dm_products p USING (business_key)
JOIN dm.product_ingredient_features f USING (business_key)
WHERE <GATES>
ORDER BY ov.overlap DESC, p.quality_score DESC, f.recognized_ratio DESC
LIMIT 100;
```

Почему Postgres перестаёт обходить десятки тысяч JSONB-массивов: overlap
теперь — `count(*)` по **index-only scan** posting-строк
`(категория, ингредиент_seed'а)`. Читаются только строки, где ингредиент
∈ cset seed'а (Σ частот ~30 ингредиентов внутри категории — десятки тысяч
узких индексных записей вместо детоаста и двойного разворачивания 17.6k
jsonb-массивов), heap не трогается, jsonb в плане отсутствует. Затем join
обратно к `dm_products`/`features` только для сгруппированных ключей —
gates и финальная сортировка прежние.

Семантика идентична legacy бит-в-бит: считаются те же вхождения (включая
дубликаты canonical_id в составе), `overlap >= 1` гарантирован группировкой,
контракт `CandidateRow` не менялся.

### 6.3. P1: `dm.reco_profile_feed`

Запрос profile-режима не зависит от параметров запроса → его результат
статичен между refresh'ами DM. MV хранит готовый top-500 (тот же SQL, те же
gates); чтение — `ORDER BY ... LIMIT 100` по 500 строкам (~1 мс).

### 6.4. Fallback и совместимость

- Repo при первом вызове проверяет `to_regclass('dm.product_canonical')` /
  `('dm.reco_profile_feed')` (кэш на процесс): MV нет → **legacy SQL**
  (медленный, но рабочий) + `console.warn`. Деплой кода без применения SQL
  ничего не ломает.
- `RECO_LEGACY_SQL=1` — принудительный legacy (для A/B).
- RECO_TIMING не менялся: этапы `getRecoSeedCandidates` /
  `getRecoProfileCandidates` те же, пути видны в EXPLAIN-блоке bench.
- Prisma schema не тронута (dm.* — raw SQL, как весь DM-слой).

### 6.5. Деплой и re-bench (before/after)

```bash
# 1. BEFORE (можно пропустить — цифры уже есть в §4):
npm run bench:reco -- --legacy 2>&1 | tee reco-bench-before.log

# 2. Применить MV:
psql "$DATABASE_URL" -f sql/dm/34_reco_candidates.sql
#    (prod: docker compose --profile tools run --rm tools \
#       npx prisma db execute --file sql/dm/34_reco_candidates.sql)

# 3. AFTER:
npm run bench:reco 2>&1 | tee reco-bench-after.log
```

В ежедневный refresh DM добавить третьим шагом:
`SELECT dm.refresh_reco_candidates();` (после `refresh_dm_products` и
`refresh_product_ingredient_features`).

Ожидание: `getRecoSeedCandidates` p50 < 150–250 ms даже на «Волосы»/«Лицо»,
total cold < 300 ms; profile-режим total < 150 ms. Если after-лог покажет,
что узким стал `getDmCompatibilityInputs` (75–100 ms) — следующий шаг S2
(убрать `inci_name`/`display_ru`/`display_en` из jsonb_agg для reco-пути).
