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
| **11 — Auth/Onboarding UX + Guest→User migration (текущая)** | 3-tier welcome CTA, account gate, soft migration localStorage → Postgres при register/login | ✅ |
| 10 — Compatibility engine | Score + verdict + AI explanation (deterministic + Anthropic) | ⏳ |
| 12 — PWA polish | Manifest, icons, offline cache | ⏳ |
| 13 — Tests + CI | Vitest unit + Playwright e2e + GitHub Actions | ⏳ |

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
│                    CompatibilityTable, ProductActionBar
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
