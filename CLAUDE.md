# Skinly

Персональный AI beauty-assistant: подбор косметики по штрихкоду, составу, типу
кожи и истории пользователя.

Repo: production-ready Next.js 15 + Postgres + Prisma. Развёрнут на
[skinly.msvoronov.com](https://skinly.msvoronov.com) (Linux, Caddy + Docker
Compose).

## Принципы

- Не ломать `index.html`-визуал (premium minimal beauty-tech).
- RU по умолчанию, RU/EN i18n через next-intl.
- Mobile-first, max-width 480 px.
- Архитектура — server actions + Prisma, без отдельного API/backend, без
  NextAuth. Auth — собственная JWT cookie.
- Guest mode не ломаем никогда. Любая server-side фича должна иметь fallback
  на demo store (localStorage) для гостя.
- Минимум миграций. Если новых полей хватает — schema не трогаем.

## Стек

- Next.js 15 App Router, React 19, TypeScript
- Tailwind CSS v4 (CSS-first config через `@theme`)
- Prisma 6 + PostgreSQL 16
- next-intl (RU/EN cookie-based)
- Auth: email/password + bcrypt + JWT-cookie + guest mode
- Barcode scanner: native `BarcodeDetector` (Chromium) + `@zxing/browser`
  fallback (iOS WebKit), lazy-imported
- Docker Compose (postgres + web + tools)
- Caddy reverse proxy на сервере

## Roadmap / Status

| Phase | Что | Статус |
|---|---|---|
| 0 — Bootstrap | Next.js skeleton, дизайн-токены, Prisma stub, Docker, /welcome | ✅ |
| 1 — UI primitives | Button, Card, Tag, Input, Toggle, ProgressBar, MatchRing, BottomNav | ✅ |
| 2 — Static screens | Welcome, Dashboard, History, Favorites, Profile, Analysis | ✅ |
| 3 — i18n | next-intl, RU/EN, переключатель | ✅ |
| 4 — Auth + Guest | Guest session, login/register UI, middleware, JWT cookie | ✅ |
| 5 — Demo state | localStorage store: profile, favorites, history, compare | ✅ |
| 6.1.0 — Domain schema | Prisma: User, BeautyProfile, Product, Ingredient, ProductIngredient, Favorite, ScanHistory + enum'ы | ✅ |
| 6.1.1 — Raw ingest | NationalCatalogRawProduct таблица, JSONL + Postgres dual-write | ✅ |
| 6.1.2 — Scraper | National catalog discovery + parser, idempotent | ✅ |
| 6.1.3 — Normalizer | raw payload → Product / Ingredient / ProductIngredient | ✅ |
| 6.1.4 — Product page DB | /product/[id-or-barcode] читает Postgres | ✅ |
| 7 — Real scanner | Camera + BarcodeDetector + manual fallback | ✅ |
| 7.1 — iOS scanner | @zxing/browser lazy fallback для WebKit | ✅ |
| 8 — Production deploy | Caddy + Docker Compose, tools service, миграции через `migrate deploy` | ✅ |
| 9 — Server persistence | Auth + Profile + Favorites + History в Postgres, dual-mode с guest fallback | ✅ |
| 11 — Auth/Onboarding UX + Guest→User migration | 3-tier welcome CTA, account gate, soft migration localStorage → Postgres при register/login | ✅ |
| **10.1 — Compatibility engine v1 (текущая)** | Deterministic rules + INCI knowledge base, реальный score / verdict / per-ingredient findings, заменил mock | ✅ |
| 10.2 — AI explanation | Anthropic-генерируемые объяснения поверх engine result | ⏳ |
| 10.3 — ML scoring | Калибровка score через telemetry / ratings | ⏳ |
| 10.4 — Ingredient interaction graph | Нерекомендованные комбинации (retinol + AHA, vit C + niacinamide и т.п.) | ⏳ |
| 12 — PWA polish | Manifest, icons, offline cache | ⏳ |
| 13 — Tests + CI | Vitest unit + Playwright e2e + GitHub Actions | ⏳ |

## Текущая фаза (10.1) — Compatibility engine v1

Production-grade deterministic scoring engine для product analysis. Без AI,
без LLM, без БД-зависимостей — pure-функция, server- и client-safe.

### Архитектура

```
lib/compatibility/
├── types.ts          public types: Profile, Fact, Result, Verdict, RuleHit, KbEntry
├── ingredients.ts    INCI knowledge base + lookup (нормализация, aliases, partial)
├── rules.ts          декларативный список правил (avoidedList, sensitivity,
│                     concerns, skinType, goal). Каждое правило → RuleHit[].
├── score.ts          public entry: evaluateCompatibility(profile, facts)
├── explain.ts        engine result → CompatibilityRow[] + IngredientFinding[]
├── adapters.ts       DB BeautyProfile / DemoSkinProfile / Mock → engine input
└── index.ts          barrel
```

### Engine input

```ts
interface CompatibilityProfile {
  skinType: SkinType | null;       // "dry" | "oily" | "combination" | "normal"
  sensitivity: SensitivityLevel | null;
  concerns: SkinConcern[];
  avoidedList: AvoidedIngredient[];
  goal: SkincareGoal | null;
}

interface IngredientFact {
  inci: string;
  position: number;
  kbId: string | null;             // null = неизвестный ингредиент
  benefitsFor: SkinConcern[];
  cautionsFor: SkinConcern[];
  flagsAvoided: AvoidedIngredient[];
  tags: IngredientTag[];           // humectant, fragrance, exfoliant_bha, ...
  baseSafety: "beneficial" | "neutral" | "caution" | "danger";
}
```

### Engine output

```ts
interface CompatibilityResult {
  score: number;                   // 0..100; 0 = engine не запускался
  verdict: "excellent" | "good" | "mixed" | "risky";
  reasons: RuleHit[];              // топовые причины (для VerdictCard)
  positives: RuleHit[];
  warnings: RuleHit[];
  matchedConcerns: SkinConcern[];
  triggeredAvoided: AvoidedIngredient[];
  rows: CompatibilityRowComputed[];      // готовые строки таблицы
  ingredientFindings: IngredientFinding[]; // per-ingredient safety с учётом профиля
  lowConfidence: boolean;          // < 30% ингредиентов распознано → score «приблизителен»
}
```

### Scoring formula

```
baseline = 75
sumPositives — сумма weight'ов «позитивных» hits
sumWarnings   — сумма weight'ов «предупреждающих» hits

dampened = sumPositives ≤ 30 ? sumPositives
                              : 30 + (sumPositives − 30) * 0.5
                              # diminishing returns после +30

raw = baseline + dampened + sumWarnings
raw = clamp(raw, 25, 100)

# жёсткий потолок при срабатывании avoidedList
if any warning.key === "avoidedFlag":
  raw = min(raw, 60)

# защита от overconfidence на неизвестном составе
if recognitionRatio < 0.3:
  raw = round(raw * 0.5 + 75 * 0.5)

score = round(raw)

verdict =
   score >= 88 → "excellent"
   score >= 72 → "good"
   score >= 50 → "mixed"
   else        → "risky"

# avoidedList триггер сдвигает verdict на mixed, если score высокий
```

### Правила (`rules.ts`)

| Rule | Когда срабатывает | Эффект |
|------|-------------------|--------|
| `avoided_list` | ingredient.flagsAvoided ∩ profile.avoidedList | warning, weight −25 (hard) |
| `sensitivity` | sens=high/reactive + fragrance/essential_oil/alcohol | warning, −12/−18 |
| `strong_actives_for_sensitive` | sens=high/reactive + retinoid/AHA/BHA | warning, −6/−10 |
| `concern_match` | benefitsFor ∩ profile.concerns | positive, +6..+12 (active=сильнее) |
| `concern_match` (cautions) | cautionsFor ∩ profile.concerns | warning, −10 |
| `skin_dry` | skinType=dry + humectant/barrier/occlusive | positive, +5; alcohol_drying −8 |
| `skin_oily` | skinType=oily + heavy_oil/comedogenic | warning, −10; light humectant +4 |
| `skin_combination` | skinType=combination | comedogenic −6; humectant/barrier +3 |
| `skin_normal` | skinType=normal | barrier/antioxidant +2 |
| `goal_alignment` | profile.goal ∩ ingredient tags/benefits | positive, +4 |

Расширение rules: новый объект в `RULES`. Поведение остальных правил не меняется.

### Knowledge base (`ingredients.ts`)

Около 35 ключевых ингредиентов: humectants, ceramides, niacinamide,
salicylic/glycolic/lactic/azelaic, retinol, vitamin C, zinc PCA, snail
mucin, centella, fragrance markers (parfum/linalool/limonene), alcohols
(SD/IPA), SLS/SLES, parabens, essential oils, comedogenic oils, UV filters.

Lookup устойчив к:
- регистру / пробелам / дефисам / слешам
- процентным суффиксам («Niacinamide 4%»)
- торговым знакам (™ ® ©)
- скобкам (берём текст до `(`)
- partial substring match

Расширение KB: новая запись в `KB`-массиве с `id` / `inci` / `aliases` /
`benefitsFor` / `cautionsFor` / `flagsAvoided` / `tags` / `baseSafety`.

### Профиль: lowercase id

Engine ожидает lowercase id'шники (`"dry"`, `"acne"`, ...). DB-енумы
(`DRY`, `ACNE`) приводятся через адаптер `dbBeautyProfileToEngine()`,
demo store уже хранит lowercase, mock-каталог тоже. Один engine API
работает и для guest, и для user.

### Wiring

| Поверхность | Как подключено |
|---|---|
| `/product/[id-or-barcode]` (DB) | server отдаёт INCI+positions, `<ProductCompatibilitySection />` + `<IngredientsList />` считают результат на клиенте |
| `/product/[id-or-barcode]` (mock fallback) | то же — engine запускается на mock-составе |
| Dashboard recommendations | `<ProductCard liveScoring={...}>` → `<LiveMatchBadge />` |
| Product action bar (запись скана) | `<ProductActionBar scoringContext={...}>` считает score и кладёт в `recordScanAction(productId, score)` — ScanHistory.matchScore = реальный engine snapshot |
| History (recent / list) | читает `ScanHistory.matchScore` (snapshot из engine) |
| Favorites | бейдж не показываем без ингредиентов (карточки лёгкие); в Phase 10.2 расширим |

### Guest mode

Engine работает идентично. Профиль приходит из demo store, ингредиенты —
из mock-каталога. ScanHistory не пишется (для guest action no-op), но
demo store содержит scans без score-snapshot — в Phase 10.2 добавим
сохранение `matchScore` в demo store.

### Performance

- O(N_rules × N_facts) на один evaluateCompatibility, ≈ 9 правил × ≤ 30
  ингредиентов = ≤ 270 операций. Pure-функция, без БД, без I/O.
- На сервере `evaluateCompatibility` не вызывается напрямую — клиентские
  компоненты считают локально (один вызов на маунт + memo).
- KB-lookup за O(1) через pre-built Map; partial-fallback за O(K), где K —
  размер KB (≈ 35).

### Future-ready

- Phase 10.2 (AI explanation): добавит `aiExplanation?: string[]` в
  `CompatibilityResult`. Engine API не меняется.
- Phase 10.3 (ML scoring): подменит `score` после правил, оставит rest.
- Phase 10.4 (interaction graph): новые правила в `rules.ts` без изменений
  KB или engine API.

### Что НЕ менялось

- Prisma schema: `Ingredient.flagsAvoided` / `benefitsFor` / `cautionsFor`
  всё ещё пусты в БД (нормализатор их не заполняет). Engine читает
  knowledge из in-code KB по `Ingredient.inci` — это и есть source of truth.
- Auth / session / middleware / scanner / onboarding / Phase 11 flow.
- DB writes: формат ScanHistory тот же, просто `matchScore` теперь не 0.

### Known limitations

- KB покрывает популярные ингредиенты, но далеко не весь каталог. На
  продуктах с большим количеством unknown'ов сработает `lowConfidence`,
  и engine приближает score к baseline 75.
- Engine не моделирует concentration/order: 0.5% и 5% салициловой пока
  оцениваются одинаково. `ProductIngredient.concentration` есть в schema —
  Phase 10.3 учтёт.
- Engine не моделирует pH, photo-stability, формулу как систему.
- Без AI-объяснений: subtitle и breakdown полностью deterministic.

## Текущая фаза (11) — Auth/Onboarding UX + Guest → User migration

Производственный auth/onboarding flow без потери guest mode. Без изменений
Prisma schema — переиспользуем то, что появилось в Phase 9.

### UX flow

```
NEW USER (full path):
  /welcome
    → [PRIMARY  ] "Начать бесплатно"   → guest session + /onboarding
    → wizard (5 шагов) → save to demo store + DB upsert (no-op для гостя)
    → /onboarding/complete   ← account gate
    → [PRIMARY  ] "Создать аккаунт"     → /register
    → registerAction       → user session + redirect /dashboard
    → (app) layout mount  → <GuestMigrator /> → migrateGuestToUserAction
    → router.refresh() → /dashboard уже с данными из БД

EXISTING USER:
  /welcome → middleware видит user-сессию → redirect /dashboard
  ИЛИ
  /welcome → [SECONDARY] "Войти" → /login → loginAction
            → user session + redirect /dashboard
            → (app) layout → <GuestMigrator /> (мерджит, если в браузере
              остался прежний guest state)

GUEST (без аккаунта, навсегда):
  /welcome → [TERTIARY ] "Продолжить как гость"
            → guest session + /dashboard
  ИЛИ
  /welcome → "Начать бесплатно" → onboarding → gate → "Продолжить как гость"
            → /dashboard в guest-режиме (demo store source of truth)
```

### CTA hierarchy на /welcome

| Tier      | CTA                       | Действие                          |
|-----------|---------------------------|-----------------------------------|
| PRIMARY   | "Начать бесплатно"        | `startOnboardingAction` → guest session → `/onboarding` |
| SECONDARY | "Войти"                   | `<Link href="/login">`             |
| TERTIARY  | "Продолжить как гость"    | `loginAsGuestAction` → guest session → `/dashboard` |

Залогиненный user не видит /welcome никогда (server-side `redirect("/dashboard")`
+ middleware).

### Account gate (`/onboarding/complete`)

Промежуточный экран после finish'а wizard'а. Показывается **только гостю**:

- Header: «Ваш skin profile готов ✨»
- Bullets-преимущества аккаунта (history / sync / recommendations)
- Warning-карточка: «Сейчас вы — гость, профиль сохранён только в браузере».
- Три CTA: Создать аккаунт / Войти / Продолжить как гость.

Залогиненный user, попав сюда, мгновенно редиректится на `/dashboard`
(server-side `redirect`).

### Маршрут wizard'а

`/onboarding/page.tsx` решает finishHref по session:

| session       | finishHref            |
|---------------|-----------------------|
| user          | `/dashboard`          |
| guest / null  | `/onboarding/complete`|

### Guest → user migration

**Repository** (`lib/db/repositories/migration.ts`)
- `migrateGuestStateToUser(userId, payload) → MigrationStats`
- Идемпотентен: повторный запуск даёт нули.
- Merge rules:
  - `BeautyProfile`: импорт **только если** у user'а нет профиля или
    `completion === 0`. Заполненный профиль user'а никогда не затирается.
  - `Favorites`: skipDuplicates по `(userId, productId)`. Невалидные
    `productId` (нет в `Product`) тихо отбрасываются.
  - `ScanHistory`: skipDuplicates по `(productId, scannedAt сек)`.
    Невалидные `productId` отбрасываются.
  - `Locale`: пишем `User.locale` только если у user'а пусто или дефолт `"ru"`.

**Server action** (`app/actions/migrate-guest.ts`)
- `migrateGuestToUserAction(payload)` — single entry point.
- Если session не user → `{ ok: false, reason: "not_user" }` (no-op).
- Если БД упала → `{ ok: false, reason: "db_error" }`. Login/register
  не ломаются: action вызывается **после** успешного auth, и его падение
  логируется, но UI продолжает работать (guest data остаётся в demo store
  как клиентский кэш, БД догонит при следующем write-action'е).

**Trigger** (`components/auth/guest-migrator.tsx`)
- Невидимый `<GuestMigrator />` в `app/(app)/layout.tsx`.
- На mount после login/register:
  1. ждёт hydration demo store'а;
  2. если в demo store нет ни профиля, ни favorites, ни history → no-op;
  3. иначе зовёт `migrateGuestToUserAction`;
  4. на успех — `localStorage.setItem("skinly:migrated-for", userId)` +
     `router.refresh()`, чтобы серверные RSC'и подтянули свежие данные.
- Demo store **не сбрасывается** — он остаётся клиентским кэшем; серверные
  страницы перезаписывают его при render'е.
- Идемпотентность: ref-guard в компоненте + флаг в localStorage + идемпотентность
  на уровне БД (migration repo).

### Middleware (`middleware.ts`)

- PROTECTED (`/dashboard`, `/history`, `/favorites`, `/profile`, `/scan`,
  `/product`, `/onboarding`): нужна любая сессия (user или guest); без
  сессии → `/welcome`.
- USER-ONLY-REDIRECT (`/welcome`, `/login`, `/register`): user → `/dashboard`.
  Guest проходит. **Это критично для gate flow** — guest должен иметь право
  открыть `/register` и `/login`, иначе он не сможет создать настоящий аккаунт.

### Robustness

- Migration упала → login/register НЕ ломаются. Action вернёт
  `{ ok: false, reason: "db_error" }`, GuestMigrator залогирует и тихо выйдет.
  Demo store продолжает работать как кэш, БД догонит при первом действии.
- DB upsert на onboarding finish упал → `await upsertBeautyProfileAction(...)`
  не падает наружу (try/catch внутри action), wizard всё равно идёт на
  finishHref.

### Что НЕ менялось

- Prisma schema (нет миграций для Phase 11).
- Demo store / guest flow / scanner / product page / dashboard / favorites /
  history / profile / i18n / session JWT — без изменений.
- registerAction / loginAction — поведение прежнее, кроме того, что
  registerAction редиректит на `/dashboard` (а не `/onboarding`),
  потому что онбординг прошёл ДО register'а в gate flow.

## Архитектурные правила

### Server actions
- Файл с `"use server"` экспортирует **только async функции**.
- Типы / initial state / константы — в соседних `lib/*` модулях
  (`@/lib/auth/forms`, `@/lib/db/*`).
- Все actions устойчивы к падению Postgres: возвращают `{ ok, persisted, reason }`,
  не бросают наружу.

### Auth
- JWT в cookie `skinly_session` (HttpOnly, SameSite=Lax, 30 дней).
- Подпись HS256 + jose.
- Edge middleware (`middleware.ts`) проверяет cookie, без обращения к БД.
- Защищённые префиксы: `/dashboard`, `/history`, `/favorites`, `/profile`,
  `/scan`, `/product`, `/onboarding`.
- `/login`, `/register`, `/welcome` редиректят на `/dashboard` **только**
  user'а; guest проходит насквозь — это нужно для онбординг → account gate
  → register/login flow (Phase 11).

### Demo store
- `DemoStoreProvider` обёрнут вокруг всего приложения (root layout).
- Используется только в guest-режиме как ground truth.
- Для user'а: остаётся как **клиентский кэш** (optimistic UI + быстрый
  hover-state), но не источник правды — серверные страницы перезаписывают.

### DB-down
Любая страница / action **должны** мягко деградировать:
- Server-fetch падает → клиент рендерится в guest-режиме (читает demo store).
- Action падает → возвращает `{ ok: false, reason: "db_unavailable" }`,
  UI показывает оптимистичное состояние, БД догонит при следующем действии.

## Структура

```
app/
├── (marketing)/     welcome/, preview/
├── (auth)/          login/, register/
├── (onboarding)/    onboarding/, onboarding/complete  ← account gate (guest only)
├── (app)/           dashboard, favorites, history, profile (защищённые, BottomNav)
│                    + <GuestMigrator /> в layout
├── product/[barcode]/   /product/<id-or-barcode>
├── scan/            real BarcodeDetector + zxing fallback
└── actions/         auth, profile, favorites, scans, products, locale, migrate-guest

lib/
├── auth/            session (jose JWT), server (cookies), password (bcrypt),
│                    current-user, forms (типы для useActionState)
├── compatibility/   Phase 10.1 — deterministic engine
│   ├── types.ts             Profile, Fact, Result, Verdict, RuleHit, KbEntry
│   ├── ingredients.ts       INCI knowledge base + lookup
│   ├── rules.ts             declarative rules (avoidedList, sensitivity, …)
│   ├── score.ts             evaluateCompatibility() — public entry
│   ├── explain.ts           result → CompatibilityRow[] + IngredientFinding[]
│   ├── adapters.ts          DB / demo / mock → engine input
│   └── index.ts             barrel
├── db/
│   ├── prisma.ts
│   ├── display/                DB → view mappers
│   └── repositories/           user, beauty-profile, favorite, scan-history,
│                                migration (Phase 11 — guest → user merge rules)
├── demo-store/      Phase 5 localStorage layer
├── i18n/            locale constants
└── mock/            mock products + onboarding questions

components/
├── ui/              Button, Card, Tag, Input, Toggle, ProgressBar,
│                    MatchRing, LanguageSwitcher
├── layout/          ScreenContainer, BottomNav
├── auth/            LoginForm, RegisterForm, GuestButton, LogoutButton,
│                    StartOnboardingButton, GuestMigrator (Phase 11)
├── dashboard/       ScanCard, SectionHeader
├── product/         ProductCard, HistoryItem, IngredientCard, VerdictCard,
│                    CompatibilityTable, ProductActionBar,
│                    ProductCompatibilitySection, IngredientsList,
│                    LiveMatchBadge (Phase 10.1)
├── profile/         ProfileHeader, SkinProfileCard, StatsRow,
│                    PreferencesSection, ResetDemoButton, StatCard
├── onboarding/      OnboardingWizard
└── scanner/         ScannerView (native + zxing), AnalyzingOverlay

prisma/
├── schema.prisma
├── migrations/
│   ├── 20260508165210_phase6_domain/
│   └── 20260509100000_raw_national_catalog/
└── (no seed — данные приходят через scrape + normalize)

scripts/
├── scrape-national-catalog.ts
├── normalize-national-catalog.ts
└── national-catalog/   (модули скрейпера)

middleware.ts        Edge — JWT cookie protection
docker-compose.yml   postgres + web + tools (под profile "tools")
docker-compose.dev.yml   override для local dev (postgres exposed)
Dockerfile           multi-stage standalone web
Dockerfile.tools     lightweight tools image (prisma CLI, scraper, seeds)
```

## Команды (вкратце)

```bash
# local dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
npm install
npx prisma migrate deploy
npm run dev

# production deploy
git pull
docker compose build web
docker compose up -d
docker compose --profile tools run --rm tools npx prisma migrate deploy

# scraper / normalizer
docker compose --profile tools run --rm tools \
  npm run scrape:national-catalog -- --limit 200
docker compose --profile tools run --rm tools \
  npm run normalize:national-catalog
```

## Что НЕ трогать

- Visual style из `index.html`.
- Demo store / guest flow.
- Auth boundary (`"use server"` файлы экспортируют только async).
- Существующие миграции.
- UI middleware.
