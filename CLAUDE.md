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
| **9 — Server persistence (текущая)** | Auth + Profile + Favorites + History в Postgres, dual-mode с guest fallback | ✅ |
| 10 — Compatibility engine | Score + verdict + AI explanation (deterministic + Anthropic) | ⏳ |
| 11 — Guest → user migration | Soft migration localStorage → Postgres при register/login | ⏳ |
| 12 — PWA polish | Manifest, icons, offline cache | ⏳ |
| 13 — Tests + CI | Vitest unit + Playwright e2e + GitHub Actions | ⏳ |

## Текущая фаза (9) — Auth + Profile Server Persistence

Перевод user-data с localStorage на Postgres через server actions, без потери
guest flow.

### Что внутри

**Repositories** (`lib/db/repositories/*`)
- `user.ts` — getById, updateLocale, updateName
- `beauty-profile.ts` — getByUserId, upsert
- `favorite.ts` — list, isFavorite, toggle
- `scan-history.ts` — list, record, getLast (для дедупа), counters

**Server actions** (`app/actions/*`)
- `profile.ts` — `upsertBeautyProfileAction`
- `favorites.ts` — `toggleFavoriteAction`
- `scans.ts` — `recordScanAction` (30 сек дедуп)
- `auth.ts` (без изменений) — register / login / guest / logout
- `locale.ts` — пишет cookie + дублирует в `User.locale` для user'а
- `products.ts` (без изменений) — `getProductByBarcodeAction`

**Pages dual-mode**

```
Server (RSC) определяет session:
  user  → читает БД, рендерит client с props (mode="user")
  guest → рендерит client с mode="guest" (data из demo store)
```

Покрыто: `/dashboard`, `/favorites`, `/history`, `/profile`.

**Write-paths dual-mode**

```
guest → только demo store (localStorage)
user  → demo store optimistic + server action (БД)
```

Покрыто: onboarding wizard, product action bar (favorite + scan recording),
preferences (locale).

**Существующие модели не меняются** — schema.prisma после Phase 6 уже подходит.

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
- Auth-страницы (`/login`, `/register`) перенаправляют залогиненных на
  `/dashboard`.

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
├── (onboarding)/    onboarding/
├── (app)/           dashboard, favorites, history, profile (защищённые, BottomNav)
├── product/[barcode]/   /product/<id-or-barcode>
├── scan/            real BarcodeDetector + zxing fallback
└── actions/         auth, profile, favorites, scans, products, locale

lib/
├── auth/            session (jose JWT), server (cookies), password (bcrypt),
│                    current-user, forms (типы для useActionState)
├── db/              prisma, repositories/*, display (DB→view mappers)
├── demo-store/      Phase 5 localStorage layer
├── i18n/            locale constants
└── mock/            mock products + onboarding questions

components/
├── ui/              Button, Card, Tag, Input, Toggle, ProgressBar,
│                    MatchRing, LanguageSwitcher
├── layout/          ScreenContainer, BottomNav
├── auth/            LoginForm, RegisterForm, GuestButton, LogoutButton,
│                    StartOnboardingButton
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
