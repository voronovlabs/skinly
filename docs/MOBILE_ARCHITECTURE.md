# Skinly Mobile — Architecture & Roadmap

**Авторы ролей:** Principal Mobile Architect · Principal Full-Stack Architect · Staff Product Engineer
**Дата:** 26 мая 2026
**Контекст:** Skinly уже работает в production как Web (Next.js 15 + Postgres). Этот документ описывает, как добавить **второй клиент** — нативные iOS/Android приложения — поверх существующей платформы, **без переписывания Web и без миграции с Web на Mobile**.

---

## Часть 1. Аудит текущего проекта

### 1.1 Общая архитектура

Skinly построен по схеме *single deployable app + dual client mode*: один Next.js App Router обслуживает и SSR-страницы, и Server Actions (выступающие в роли «backend»). Полноценного REST/GraphQL API нет — клиент Web общается с сервером через RSC + Server Actions, защищённые JWT-cookie.

Архитектура по слоям:

- **Frontend** — Next.js 15 App Router, React 19, Tailwind v4 (CSS-first через `@theme`), next-intl для RU/EN. Mobile-first вёрстка с жёстким контейнером `max-width: 480px` — это уже почти-mobile UX, что упрощает портирование.
- **Backend** — Server Actions в `app/actions/*` (`"use server"`). Все мутации идут через них; HTTP-route handlers (`app/api/*`) отсутствуют. Сессия — JWT в `httpOnly` cookie (`skinly_session`), подписанная HS256 через `jose`. Middleware на Edge защищает приватные префиксы и не лезет в БД.
- **Database** — PostgreSQL 16, доступ через Prisma 6. Schema: User, BeautyProfile, HairProfile, Product, Ingredient, ProductIngredient, Favorite, ScanHistory, NationalCatalogRawProduct. 3 миграции в `prisma/migrations/`.
- **Auth** — собственная (НЕ NextAuth): email + bcrypt + JWT-cookie + **guest sessions** (`type: "guest", guestId`). Guest — полноценный first-class режим, всё приложение умеет работать без БД (`localStorage` demo store как ground truth).
- **AI / интеллектуальный слой** — пока **deterministic engine** (`lib/compatibility/*`): чистая функция `evaluateCompatibility(profile, facts)` поверх KB из ≈35 INCI-ингредиентов и ≈10 правил. Никаких LLM/API внутри Phase 10.1. AI-объяснения зарезервированы для Phase 10.2 (`FEATURE_AI_EXPLANATION` + `ANTHROPIC_API_KEY` уже в `.env.example`).
- **Файлы / изображения** — Skinly **не загружает изображения от пользователя**. Изображения продуктов хранятся как `Product.imageUrl` (string URL во внешнем CDN/каталоге). Нет S3, нет blob-стораджа, нет user-uploaded media.
- **Инфраструктура** — Docker Compose (postgres + web + on-demand `tools`-контейнер для prisma CLI и скрейперов), Caddy reverse-proxy на хосте, развёрнуто на `skinly.msvoronov.com`.
- **Локализация** — next-intl, две локали `ru`/`en`, выбор в cookie `NEXT_LOCALE`, JSON-словари в `messages/{ru,en}.json` (15 неймспейсов: `auth`, `nav`, `welcome`, `hairOnboarding`, `onboarding`, `dashboard`, `scanCard`, `scanner`, `product`, `history`, `favorites`, `profile`, `compatibility`, `tutorial`, `common`).
- **Внешние сервисы** — Open-Meteo (контекстный tip на dashboard, без ключа), скрейперы национального каталога косметики (cron-style, через `tools` container). Anthropic API готов к подключению, но пока **выключен флагом**.

### 1.2 Технологический стек

| Технология | Зачем | Оценка | Ограничения для mobile |
|---|---|---|---|
| **Next.js 15 (App Router)** | Single-codebase SSR + server actions | Хороший выбор для web | Server Actions — RSC-only RPC, нативный клиент их вызвать не может. **Главный архитектурный gap.** |
| **React 19** | UI | Совпадает по тулчейну с React Native | RSC-специфичные `"use server"` файлы не реюзаются на mobile |
| **TypeScript 5.7** | Типобезопасность | Главный актив для переиспользования — типы и pure-функции переедут на mobile as-is | — |
| **Tailwind v4 (`@theme`)** | Дизайн-токены + utility CSS | Excellent для Web | На RN/Flutter не реюзается напрямую; нужен токен-export (см. Часть 6) |
| **Prisma 6 + PG 16** | DB layer | Strong choice | Prisma client = Node.js-only; mobile должен идти через API, не напрямую |
| **`jose` JWT** | Подпись сессий, работает в Edge | Идеально для mobile API — клиент будет проверять/носить тот же токен | — |
| **bcryptjs** | Хэш паролей | Подходит | — |
| **next-intl** | i18n RU/EN | Чистый JSON-словарь | Словари переиспользуются на mobile (i18next/Polyglot/intl_phonenumber), не сама библиотека |
| **`BarcodeDetector` + `@zxing/browser`** | Web-сканер | Хорошо для Web, **на mobile нативные SDK быстрее и стабильнее** | На mobile заменяем нативным сканером |
| **Open-Meteo (fetch)** | Контекстный tip | Минимальная зависимость | На mobile вызываем теми же URL — работает as-is |
| **lucide-react** | Иконки | Easy | Замена на `lucide-react-native` (RN) / `lucide` (Flutter) |
| **Docker Compose + Caddy** | Деплой | Простой и достаточный | Mobile добавит API endpoints на тот же web-сервис |

**Что отсутствует и потребуется добавить:**

- HTTP API (REST или tRPC) — сейчас его нет.
- Refresh-token / device-binding — текущий JWT 30-дневный, для mobile это рисково.
- Push-нотификации, FCM/APNS, device registry.
- Image-storage слой (на случай, если позже добавим «фото кожи»).

### 1.3 Карта проекта

```
app/                              Next.js App Router
├── (marketing)/welcome/          Лендинг, 3-tier CTA (start / login / guest)
├── (marketing)/preview/          Preview-страница (демо)
├── (auth)/login/                 Email + пароль
├── (auth)/register/              Регистрация
├── (onboarding)/onboarding/      Wizard анкеты КОЖИ (5 шагов)
├── (onboarding)/hair-onboarding/ Wizard анкеты ВОЛОС
├── (onboarding)/onboarding/complete/   Account gate (только для guest)
├── (app)/dashboard/              Главный экран: greeting, scan-card, рекомендации, recent
├── (app)/history/                История сканов
├── (app)/favorites/              Избранное
├── (app)/profile/                Профиль + skin/hair карточки + статистика + языки
├── product/[barcode]/            Детали продукта + compatibility engine
├── scan/                         Фулскрин сканер (Native BarcodeDetector + ZXing fallback)
├── actions/                      Server Actions (auth, profile, hair-profile, favorites,
│                                  scans, products, locale, migrate-guest)
├── layout.tsx                    Root + DemoStoreProvider + NextIntlClientProvider
└── page.tsx                      `/` → `/welcome`

lib/
├── auth/                         session.ts (jose JWT), server.ts (cookies),
│                                  current-user.ts, password.ts, forms.ts
├── compatibility/                Phase 10.1 deterministic engine
│                                  types, ingredients (KB), rules, score, explain, adapters
├── contextual/                   Phase 12: greeting, weather (Open-Meteo), recommendations
├── db/repositories/              user, beauty-profile, hair-profile, favorite,
│                                  scan-history, migration
├── db/display.ts                 DB → view-model mappers
├── demo-store/                   localStorage state (guest mode), React Context
├── mock/                         products, onboarding-questions, hair-questions, profile, scans
├── tutorial/                     use-tutorial hook
├── prisma.ts                     Prisma client singleton
├── i18n.ts                       locale constants
└── types.ts                      Shared TS types (re-export Prisma enums)

components/
├── ui/                           Button, Card, Tag, Input, Toggle, ProgressBar,
│                                  MatchRing, LanguageSwitcher
├── layout/                       ScreenContainer (max-w-480), BottomNav (5 slots)
├── auth/                         LoginForm, RegisterForm, GuestButton,
│                                  StartOnboardingButton, LogoutButton, GuestMigrator
├── dashboard/                    Greeting, ContextualTip, ScanCard, SectionHeader
├── onboarding/                   OnboardingWizard, HairOnboardingWizard
├── product/                      ProductCard, HistoryItem, IngredientCard, VerdictCard,
│                                  CompatibilityTable, ProductActionBar,
│                                  ProductCompatibilitySection, IngredientsList,
│                                  LiveMatchBadge
├── profile/                      ProfileHeader, SkinProfileCard, HairProfileCard,
│                                  StatsRow, StatCard, PreferencesSection,
│                                  ResetDemoButton, ComingSoonButton, PremiumUpgradeButton
├── scanner/                      ScannerView (native + zxing), AnalyzingOverlay
└── tutorial/                     TutorialOverlay

prisma/
├── schema.prisma                 9 моделей + 12 enum
└── migrations/                   20260508 phase6_domain, 20260509 raw_national_catalog,
                                   20260524 hair_profile

middleware.ts                     Edge: JWT cookie проверка, PROTECTED_PREFIXES, gate flow
scripts/                          scrape + normalize national catalog (tsx)
i18n/                             next-intl request config
messages/{ru,en}.json             15 неймспейсов
public/                           static assets
index.html                        Изначальный UI-прототип (sacred, не ломаем)
docker-compose{,.dev}.yml         postgres + web + tools
Dockerfile / Dockerfile.tools     web + tooling images
```

### 1.4 Пользовательские сценарии

**Новый пользователь (full path):**
`/welcome` → «Начать бесплатно» (`startOnboardingAction` создаёт guest session) → `/onboarding` (5 шагов skin-wizard) → `/hair-onboarding` (4-5 шагов hair-wizard) → `/onboarding/complete` (account gate) → «Создать аккаунт» → `/register` → `registerAction` (user JWT) → `/dashboard` → `<GuestMigrator />` тихо переносит localStorage → Postgres (BeautyProfile, HairProfile *(см. примечание ниже)*, Favorites, ScanHistory).

**Существующий пользователь:** `/welcome` → middleware видит user JWT → `redirect("/dashboard")`. ИЛИ `/welcome` → «Войти» → `/login` → `loginAction` → `/dashboard` (опционально GuestMigrator мерджит, если в браузере остался прежний guest state).

**Guest forever:** `/welcome` → «Продолжить как гость» (`loginAsGuestAction`) → `/dashboard`. Никакой БД, всё в localStorage.

**Сканирование (user или guest, идентичный flow):** `/dashboard` → FAB scanner → `/scan` → камера + native `BarcodeDetector` (Chromium) / `@zxing/browser` (iOS WebKit) / manual input → `getProductByBarcodeAction(barcode)` → если found → `router.push("/product/<id>")`; если not_found → банер с предложением ручного ввода.

**Просмотр продукта:** `/product/<id-or-barcode>` → server грузит DB-продукт (или mock-fallback) + опционально профиль user'а → клиент `<ProductCompatibilitySection />` запускает compatibility engine локально на mount → VerdictCard, IngredientsList, ProductActionBar (Favorite toggle + record-scan).

**История / Избранное:** `/history` и `/favorites` — RSC грузит данные через repositories (user) или клиент достаёт из demo store (guest).

**Профиль / Настройки:** `/profile` → шапка, skin/hair карточки с completion-прогрессом, stats (число сканов, average match, distinct products), preferences (язык), reset demo, logout. CTA «Премиум» и «Скоро» — заглушки.

**Контекстный tip на dashboard:** на mount — sessionStorage cache → Geolocation prompt (с safety-timer для iOS) → Open-Meteo `current` (T, humidity, UV, wind, weather_code) → 14 декларативных правил в `recommendations.ts` → один tip. Fallback: time-of-day → profile-based → welcome.

> **Примечание о миграции HairProfile.** В `lib/db/repositories/migration.ts` сейчас перенос BeautyProfile + favorites + scans + locale. **HairProfile в payload миграции отсутствует** — это технический gap Phase 11 (миграция датирует фазу до hair-onboarding'а). При создании mobile API мы это починим (см. Часть 3 и Часть 9).

---

## Часть 2. Модель данных

### 2.1 ERD (текстом)

```
                ┌─────────────────────┐
                │       User          │
                │ id, email (uniq),   │
                │ passwordHash, name, │
                │ locale ("ru"|"en")  │
                └─────────┬───────────┘
                          │ 1
            ┌─────────────┼──────────────┬──────────────┐
            │ 1           │ 1            │ *            │ *
            ▼             ▼              ▼              ▼
   ┌────────────────┐ ┌──────────────┐ ┌────────────┐ ┌─────────────┐
   │ BeautyProfile  │ │ HairProfile  │ │ Favorite   │ │ ScanHistory │
   │ skinType,      │ │ hairType,    │ │ userId,    │ │ userId,     │
   │ sensitivity,   │ │ scalpType,   │ │ productId  │ │ productId,  │
   │ concerns[],    │ │ concerns[],  │ │ (unique)   │ │ matchScore, │
   │ avoidedList[], │ │ goal,        │ │            │ │ scannedAt   │
   │ goal,          │ │ completion   │ │            │ │             │
   │ completion     │ │              │ │            │ │             │
   └────────────────┘ └──────────────┘ └─────┬──────┘ └──────┬──────┘
                                             │ *             │ *
                                             ▼               ▼
                                       ┌──────────────────────┐
                                       │       Product        │
                                       │ id, barcode (uniq),  │
                                       │ brand, name,         │
                                       │ category, emoji,     │
                                       │ imageUrl,            │
                                       │ descriptionRu/En,    │
                                       │ source, externalId   │
                                       └───────┬──────────────┘
                                               │ 1
                                               │ *
                                       ┌───────▼──────────────┐
                                       │ ProductIngredient    │
                                       │ (productId,          │
                                       │  ingredientId),      │
                                       │ position,            │
                                       │ concentration        │
                                       └───────┬──────────────┘
                                               │ *
                                               │ 1
                                       ┌───────▼──────────────┐
                                       │     Ingredient       │
                                       │ id, inci (uniq),     │
                                       │ displayNameRu/En,    │
                                       │ descriptionRu/En,    │
                                       │ safety,              │
                                       │ flagsAvoided[],      │
                                       │ benefitsFor[],       │
                                       │ cautionsFor[]        │
                                       └──────────────────────┘

   ┌───────────────────────────────────────────┐
   │      NationalCatalogRawProduct            │  (raw ingest layer,
   │ id, source, sourceUrl (uniq), barcode,    │   not FK-linked to
   │ payload JSON, scrapedAt                   │   Product/Ingredient)
   └───────────────────────────────────────────┘
```

### 2.2 Сущности

**User** (`models/User`). Зарегистрированный аккаунт. Поля: `id` (cuid), `email` (unique), `passwordHash` (bcrypt), `name?`, `locale` (string, не enum — чтобы избежать risky миграции). Связи: `beautyProfile` (1:1), `hairProfile` (1:1), `favorites` (1:N), `scans` (1:N). Используется как owner всех персональных данных; cascade-delete вычищает всё.

**BeautyProfile** (1:1 User). Skin-анкета: `skinType` (DRY/OILY/COMBINATION/NORMAL), `sensitivity` (NONE/MILD/HIGH/REACTIVE), `concerns[]` (ACNE/AGING/PIGMENTATION/REDNESS/PORES/BLACKHEADS), `avoidedList[]` (FRAGRANCE/ALCOHOL/SULFATES/PARABENS/ESSENTIAL_OILS), `goal` (CLEAR_SKIN/ANTI_AGING/HYDRATION/EVEN_TONE/MINIMAL_ROUTINE), `completion` (0..100). **Главный input для compatibility engine.**

**HairProfile** (1:1 User). Симметрично BeautyProfile, но для волос: `hairType` (STRAIGHT/WAVY/CURLY/COILY), `scalpType` (NORMAL/DRY/OILY/SENSITIVE), `concerns[]` (FRIZZ/DAMAGE/HAIR_LOSS/DANDRUFF/DULLNESS/SPLIT_ENDS), `goal` (HYDRATION/VOLUME/REPAIR/GROWTH/COLOR_PROTECTION/ANTI_FRIZZ), `completion`. Phase 15. Compatibility engine для волос ещё не написан — это Phase 10.x роадмапа.

**Product**. Каталог: `barcode` (EAN-13/UPC, unique — основной lookup), `brand`, `name`, `category` (14 значений enum `ProductCategory`), `emoji?`, `imageUrl?`, `descriptionRu/En?`, `source` ("seed"|"openbeautyfacts"|"manual"), `externalId?`. Индексы `(brand, name)` и `category`. Связан с `ProductIngredient`, `Favorite`, `ScanHistory`.

**Ingredient**. Канонический INCI-каталог: `inci` (unique, латиница), `displayNameRu/En`, `descriptionRu/En?`, `safety` (`BENEFICIAL`/`NEUTRAL`/`CAUTION`/`DANGER` — пока в БД хранится, но engine читает из in-code KB). Поля `flagsAvoided[]`, `benefitsFor[]`, `cautionsFor[]` — пусты в БД (по CLAUDE.md), engine берёт их из `lib/compatibility/ingredients.ts`. **Важно для mobile API:** если мы хотим, чтобы compatibility работал на сервере (а не на клиенте), нужно либо синхронизировать KB → БД, либо отдавать готовый result через API.

**ProductIngredient** (junction). PK `(productId, ingredientId)`. Поля: `position` (1 — первый по INCI), `concentration?` (Decimal(5,2)). `onDelete: Cascade` для product, `Restrict` для ingredient.

**Favorite**. Junction User↔Product. Unique `(userId, productId)`. Индекс `(userId, createdAt)`.

**ScanHistory**. История сканов: `userId`, `productId`, `matchScore` (snapshot engine), `scannedAt`. Индекс `(userId, scannedAt DESC)`. Дедуп окно 30 секунд в `recordScanAction`.

**NationalCatalogRawProduct**. Raw ingestion layer. `payload: Json` — целый scraper-объект. Никаких FK; нормализатор (`scripts/normalize-national-catalog.ts`) читает эту таблицу и заполняет основной каталог. Mobile никогда не должен видеть эту таблицу напрямую.

**Сессии в БД отсутствуют** — сессия живёт только как JWT в cookie. Для mobile это плюс: server stateless, можно отдавать тот же JWT в HTTP-заголовке.

---

## Часть 3. Backend готовность для Mobile

### 3.1 Что готово / что нужно

Текущий backend — это **Server Actions**. Они вызываются Web-клиентом через RSC RPC; нативный клиент **не может их позвать**. Чтобы mobile поднялся, нужно тонкое **HTTP API**, которое:

1. Вызывает те же `lib/db/repositories/*` и pure-функции (`evaluateCompatibility`, ...).
2. Принимает тот же JWT-формат (или родственный, с access+refresh для mobile).
3. Возвращает идентичные DTO (которые уже формируются через `lib/db/display.ts` для Web).

**Хорошая новость:** бизнес-логика уже изолирована в `lib/db/repositories/*` и `lib/compatibility/*` — Server Actions сами по себе **очень тонкий** слой (валидация + сессия + вызов repo). API-слой будет таким же тонким.

### 3.2 Таблица: функция × готовность × нужен API

| Функция | Текущая реализация | Уже готово? | Нужен API? | Комментарий |
|---|---|---|---|---|
| **Регистрация** | `registerAction` (FormData) | ⚠️ частично | ✅ нужен `POST /api/v1/auth/register` (JSON) | Логика регистрации (bcrypt + prisma.user.create) переиспользуется; нужно обернуть в JSON-handler, выдать access+refresh пару |
| **Login** | `loginAction` (FormData) | ⚠️ частично | ✅ `POST /api/v1/auth/login` | То же самое; mobile нужен JSON-ответ, не redirect |
| **Logout** | `logoutAction` (clears cookie) | ⚠️ | ✅ `POST /api/v1/auth/logout` | На mobile = удалить токены из Keychain/Keystore + (опц.) revocation list |
| **Guest session** | `loginAsGuestAction` | ⚠️ web-only | ✅ `POST /api/v1/auth/guest` | Возвращает guest-JWT и `guestId`. Mobile хранит локально |
| **Refresh token** | ❌ нет | ❌ | ✅ `POST /api/v1/auth/refresh` | Нужно ввести access (15 мин) + refresh (90 дней). Web остаётся на cookie |
| **Получить текущего user** | `getCurrentUser()` RSC helper | ⚠️ | ✅ `GET /api/v1/me` | Тонкий wrap над `getUserById` |
| **Upsert BeautyProfile** | `upsertBeautyProfileAction` | ✅ логика готова | ✅ `PUT /api/v1/me/beauty-profile` | Repo `upsertBeautyProfile` переиспользуется as-is |
| **Get BeautyProfile** | `getBeautyProfileByUserId` (RSC) | ✅ | ✅ `GET /api/v1/me/beauty-profile` | Тонкий wrap |
| **Upsert HairProfile** | `upsertHairProfileAction` | ✅ | ✅ `PUT /api/v1/me/hair-profile` | Symmetric |
| **Get HairProfile** | `getHairProfileByUserId` | ✅ | ✅ `GET /api/v1/me/hair-profile` | Symmetric |
| **Get product by barcode** | `getProductByBarcodeAction` | ✅ | ✅ `GET /api/v1/products/by-barcode/:ean` | Минимальная адаптация |
| **Get product details (with ingredients)** | Inline в `product/[barcode]/page.tsx` (Prisma include) | ⚠️ inline | ✅ `GET /api/v1/products/:idOrBarcode` | Нужно вынести query в repo `findProductDeep()` и отдавать DTO |
| **Compatibility evaluation** | Клиентский вызов `evaluateCompatibility()` | ✅ pure-func | ⚠️ опционально `POST /api/v1/compatibility/evaluate` | На mobile можно реализовать оба варианта: (а) запустить engine в коде приложения (port KB+rules) или (б) звать сервер. **Рекомендация — сервер**, чтобы KB обновлялась без релиза store |
| **Toggle favorite** | `toggleFavoriteAction` | ✅ | ✅ `POST /api/v1/me/favorites/:productId/toggle` | Repo готов |
| **List favorites** | `listFavoritesByUser` (RSC) | ✅ | ✅ `GET /api/v1/me/favorites` | Repo готов |
| **Record scan** | `recordScanAction` | ✅ | ✅ `POST /api/v1/me/scans` | Repo + 30s dedup готов |
| **List scans** | `listScansByUser` | ✅ | ✅ `GET /api/v1/me/scans?limit=200` | Repo готов |
| **Stats (avg score, distinct products, count)** | 3 функции в `scan-history` repo | ✅ | ✅ `GET /api/v1/me/stats` | Тонкий wrap, объединить в один endpoint |
| **Guest → User migration** | `migrateGuestToUserAction` + `<GuestMigrator />` | ⚠️ Web-flow | ✅ `POST /api/v1/me/migrate-guest` | **Включить HairProfile в payload** (gap в текущей версии) |
| **Set locale** | `setLocaleAction` (cookie) | ⚠️ cookie-based | ✅ `PUT /api/v1/me/locale` | Mobile хранит локаль локально, на сервере — только для будущих push-нотификаций |
| **Contextual tip (weather)** | Client-only fetch Open-Meteo | ✅ | ❌ не нужен API | Mobile зовёт Open-Meteo напрямую теми же URL'ами |
| **AI explanation** | ❌ не реализован (Phase 10.2) | ❌ | ✅ `POST /api/v1/products/:id/explain` | Когда подключим Anthropic — сделать server-side через API (Anthropic key никогда не в mobile-бандле) |
| **Push registration** | ❌ нет | ❌ | ✅ `POST /api/v1/me/devices` | Новый endpoint, новая таблица `Device` |
| **Search products** | ❌ нет (нет screen «search») | ❌ | ⚠️ Future | Phase mobile-2: full-text search по `Product.brand + Product.name` |

**Итог:** уже готовы все repositories. Нужно только написать **тонкий API-роутер** (≈300 строк в `app/api/v1/*/route.ts`) и **JWT-стратегию для mobile** (refresh-токены, Bearer-auth).

### 3.3 Что завязано на Next.js (не реюзается на mobile)

- `"use server"` файлы в `app/actions/*` — серверная RSC RPC, не вызывается извне.
- `cookies()` из `next/headers` (`lib/auth/server.ts`) — только Node-Next runtime.
- `redirect()` из `next/navigation` — заменяется на JSON-response в API-handler'ах.
- middleware на Edge — заменяется на Bearer-auth helper в `lib/auth/api.ts`.
- Tailwind + React server-rendering — Web-only, mobile получает свой UI-tree.

### 3.4 Что переиспользуется без изменений

- `prisma/schema.prisma` целиком.
- Все `lib/db/repositories/*` — pure async functions.
- `lib/auth/session.ts` (jose) — Edge/Node/Mobile (через server) agnostic.
- `lib/auth/password.ts` (bcryptjs).
- `lib/compatibility/*` целиком — pure-функции, нет I/O.
- `lib/contextual/recommendations.ts` — declarative rules, можно портировать как JSON.
- `messages/{ru,en}.json` — словари 1-в-1 на mobile.
- TypeScript-типы (`lib/types.ts`, Prisma generated) — копируются в mobile-репо.

---

## Часть 4. Готовность по направлениям

Шкала: 🟢 готово · 🟡 небольшая доработка · 🔴 серьёзная переработка.

| Направление | Статус | Что есть | Что нужно для mobile |
|---|---|---|---|
| **Auth (email/password)** | 🟡 | bcrypt + JWT + guest sessions | Добавить access+refresh пару, JSON endpoints |
| **User Profile (account)** | 🟡 | User model, name/email/locale, getUserById | Endpoints + update name/password/email |
| **Beauty (Skin) Profile** | 🟢 | Schema, upsert, server action, demo store, миграция | Только API-обёртка |
| **Hair Profile** | 🟡 | Schema + wizard + repo + action | Добавить в migration payload; API wrap |
| **Product Catalog** | 🟢 | DB-данные, скрейперы, нормализаторы | `GET /products`, `GET /products/by-barcode/:ean`, pagination |
| **Product Details (ingredients)** | 🟡 | RSC inline-query | Вынести в repo `findProductDeep` + DTO + API |
| **Barcode Scan** | 🔴 (для mobile) | Web — native `BarcodeDetector` + ZXing fallback | Заменить на нативный сканер (см. Часть 5 / 8) |
| **Compatibility Engine** | 🟢 | Deterministic, pure, isolated в `lib/compatibility/*` | API endpoint поверх (либо port в mobile — но рекомендация **API**) |
| **AI Explanation** | 🔴 | Не реализовано (Phase 10.2 roadmap) | Реализовать на сервере через Anthropic API, выдать единый endpoint |
| **Favorites** | 🟢 | Repo + action + miграция готовы | API wrap |
| **History (Scans)** | 🟢 | Repo + action + dedup + stats | API wrap |
| **Settings** | 🟡 | Locale, reset demo, logout | + change password, delete account, push prefs |
| **Localization (RU/EN)** | 🟢 | `messages/{ru,en}.json`, 15 неймспейсов | Перенести JSON 1-в-1 в mobile-репо |
| **Contextual Tip (weather)** | 🟢 | Open-Meteo client + 14 rules | Портировать pure-логику на mobile или дёргать сервер |
| **Onboarding wizards (skin + hair)** | 🟡 | Web-only React-компоненты, mock-вопросы как data | **Вынести вопросы в JSON** для шеринга с mobile |
| **Guest mode** | 🟢 (концептуально) | Web — demo store в localStorage; миграция | Перенести идею: mobile-guest → SQLite/MMKV → миграция тем же endpoint |
| **Push / Reminders** | 🔴 | Не существует | Новый Devices-API + FCM/APNS service |

**Итоговая оценка backend-готовности:** **~70%**. Все ключевые данные и логика есть; основная работа — обернуть в HTTP API и добавить refresh-токены.

---

## Часть 5. Варианты реализации Mobile

### Вариант A — React Native + Expo (с EAS Build)

Современный Expo (SDK 50+) даёт почти-OTA dev experience, нативные модули по необходимости (`expo-camera`, `expo-barcode-scanner`, `expo-notifications`), EAS Build/Submit для CI публикации, поддержку обоих сторов из одной кодовой базы.

- **Переиспользование Skinly:** **Высокое.** TS-типы, `lib/compatibility/*`, `lib/contextual/recommendations.ts`, словари `messages/*.json`, валидация форм — всё едет 1-в-1. Можно вынести в shared workspace.
- **Камера/сканер:** `expo-camera` + `expo-barcode-scanner` — стабильны на iOS/Android, поддерживают EAN-13/UPC-A/EAN-8 нативно, без танцев с MLKit/Vision.
- **AI:** через те же HTTP endpoints, никаких ограничений.
- **Скорость разработки:** 6–10 недель до MVP в сторах при одном strong-fullstack-разработчике.
- **Стоимость поддержки:** **низкая.** Один кодовый язык/тулчейн, одни PR-ы.
- **UX:** на 95% от нативного, кроме самых хитрых жестов/прокруток (для Skinly не критично — это not-game).
- **Производительность:** более чем достаточная для skin-care приложения.

### Вариант B — Flutter

- **Переиспользование Skinly:** **Низкое.** TS-логика придётся портировать на Dart. KB + rules + i18n — переписать. Это **самая дорогая часть** варианта.
- **Камера/сканер:** `mobile_scanner` — отличный (ML Kit под капотом).
- **AI:** HTTP — без проблем.
- **Скорость разработки:** 8–12 недель до MVP. Минус — нужен Dart-разработчик; команда вокруг Skinly TS-ориентированная.
- **Стоимость поддержки:** средняя, но с риском знаний.
- **UX:** очень хороший, Material 3 / Cupertino mimics.
- **Производительность:** топ.

### Вариант C — SwiftUI + Kotlin (двойная нативная команда)

- **Переиспользование Skinly:** **Минимальное.** TS-логику пишем дважды (Swift + Kotlin). Это убивает преимущество «одного backend + двух клиентов» — клиентов в реальности станет три (web + ios + android).
- **Камера/сканер:** идеально (AVFoundation Vision на iOS, ML Kit на Android).
- **AI:** HTTP.
- **Скорость разработки:** 12–18+ недель.
- **Стоимость поддержки:** **высокая.** Две команды/два релиз-цикла.
- **UX:** идеальный нативный.
- **Производительность:** идеальная.

### Сравнительная таблица

| Критерий | A: RN + Expo | B: Flutter | C: SwiftUI + Kotlin |
|---|---|---|---|
| Скорость до MVP | 🟢 6–10 нед | 🟡 8–12 нед | 🔴 12–18 нед |
| Стоимость поддержки | 🟢 низкая | 🟡 средняя | 🔴 высокая |
| Сложность команды (для команды TS) | 🟢 минимальная | 🟡 нужен Dart-dev | 🔴 нужны iOS + Android devs |
| Переиспользование TS-кода Skinly | 🟢 высокое (типы, compatibility, KB, rules, i18n, contextual rules) | 🔴 низкое (порт на Dart) | 🔴 минимальное (порт ×2) |
| UX | 🟡 ~95% native | 🟢 отличный | 🟢 идеальный |
| Производительность | 🟢 достаточная | 🟢 топ | 🟢 топ |
| Камера | 🟢 expo-camera | 🟢 mobile_scanner | 🟢 AVFoundation / CameraX |
| Barcode сканер | 🟢 expo-barcode-scanner | 🟢 ML Kit | 🟢 Vision / ML Kit |
| AI-функции | 🟢 HTTP, без ограничений | 🟢 HTTP | 🟢 HTTP |
| App Store / Play Store | 🟢 EAS Submit | 🟢 fastlane | 🟢 нативные пайплайны |
| Масштабируемость | 🟢 высокая | 🟢 высокая | 🟡 нужно расширять две команды |
| Push (FCM/APNS) | 🟢 expo-notifications | 🟢 firebase_messaging | 🟢 нативно |
| Deep links / share | 🟢 expo-linking + share | 🟢 plugins | 🟢 нативно |
| Доступность специалистов | 🟢 очень высокая | 🟡 средняя | 🟡 узкая (особенно senior iOS) |
| Совместимость с web-командой | 🟢 один tooling | 🔴 другой стэк | 🔴 разные стэки |

**Победитель для контекста Skinly (маленькая TS-команда, web уже на React/Next): A — React Native + Expo.**

---

## Часть 6. Рекомендуемая архитектура (вариант A)

### 6.1 Monorepo и переиспользование кода

Превратить репозиторий в **PNPM-workspace monorepo** с минимальной перестройкой web:

```
skinly/                                       (root, монорепо)
├── package.json                              workspaces
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                                  ← существующий Next.js (move as-is)
│   │   ├── app/
│   │   ├── components/
│   │   ├── prisma/
│   │   ├── messages/
│   │   ├── middleware.ts
│   │   └── ...
│   └── mobile/                               ← Expo app (новый)
│       ├── app/                              (expo-router)
│       │   ├── _layout.tsx
│       │   ├── index.tsx                     (splash / route)
│       │   ├── welcome.tsx
│       │   ├── (auth)/
│       │   │   ├── login.tsx
│       │   │   └── register.tsx
│       │   ├── (onboarding)/
│       │   │   ├── skin.tsx
│       │   │   ├── hair.tsx
│       │   │   └── complete.tsx
│       │   ├── (app)/                        (tabs)
│       │   │   ├── _layout.tsx               (tabs nav)
│       │   │   ├── dashboard.tsx
│       │   │   ├── history.tsx
│       │   │   ├── favorites.tsx
│       │   │   └── profile.tsx
│       │   ├── scan.tsx
│       │   └── product/[id].tsx
│       ├── components/                       (UI: Button, Card, MatchRing, …)
│       ├── api/                              (HTTP client + endpoints)
│       │   ├── client.ts                     (fetch wrapper + interceptors)
│       │   ├── auth.ts
│       │   ├── profile.ts
│       │   ├── products.ts
│       │   ├── favorites.ts
│       │   └── scans.ts
│       ├── store/                            (zustand)
│       │   ├── auth.ts                       (token persistence)
│       │   ├── guest.ts                      (offline guest state)
│       │   └── ui.ts                         (locale, theme)
│       ├── hooks/                            (useAuth, useProfile, useCompatibility…)
│       ├── lib/                              (mobile-specific: secure storage, push)
│       ├── theme/                            (token mapping from packages/design)
│       ├── assets/                           (icons, splash, font)
│       └── app.config.ts                     (Expo)
└── packages/
    ├── shared-types/                         (TS types — переезжают из apps/web/lib/types.ts)
    ├── compatibility/                        (engine — переезжает из apps/web/lib/compatibility)
    ├── contextual-rules/                     (recommendations — port из apps/web/lib/contextual)
    ├── i18n-messages/                        (ru.json + en.json + типы ключей)
    └── design-tokens/                        (colors, spacing, fonts → JS export
                                               для RN; web остаётся на @theme)
```

> **Минимальный риск:** старый `apps/web/` запускается ровно так же — `npm run dev` в этой папке. Скрипты deploy не меняются, кроме корневых путей. Это **не** «переписывание web» и **не** миграция — это перенос файлов с обновлением `tsconfig` paths.

### 6.2 Backend дополнения (apps/web/app/api/v1/*)

API живёт **в том же Next.js**, на тех же DNS/процессе. Никакого отдельного сервиса. Это даёт:

- Один deployment, одна Postgres-сессия.
- Тот же CI/CD, тот же Caddy, тот же Docker.
- Прямое переиспользование `lib/db/repositories/*` и `lib/compatibility/*`.

Структура API:

```
apps/web/app/api/v1/
├── auth/
│   ├── register/route.ts            POST
│   ├── login/route.ts               POST
│   ├── refresh/route.ts             POST
│   ├── logout/route.ts              POST
│   └── guest/route.ts               POST
├── me/
│   ├── route.ts                     GET (current user)
│   ├── beauty-profile/route.ts      GET, PUT
│   ├── hair-profile/route.ts        GET, PUT
│   ├── favorites/route.ts           GET
│   ├── favorites/[productId]/toggle/route.ts   POST
│   ├── scans/route.ts               GET, POST
│   ├── stats/route.ts               GET
│   ├── migrate-guest/route.ts       POST
│   ├── locale/route.ts              PUT
│   └── devices/route.ts             POST, DELETE (push registration)
├── products/
│   ├── by-barcode/[ean]/route.ts    GET
│   └── [id]/route.ts                GET (full + ingredients)
└── compatibility/
    └── evaluate/route.ts            POST (optional: server-side run)
```

**Auth helper для API:**

```ts
// apps/web/lib/auth/api.ts (новый)
export async function getSessionFromRequest(req: NextRequest): Promise<Session | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifySession(auth.slice(7));  // тот же jose, тот же AUTH_SECRET
}
```

**Стратегия токенов для mobile:**

- Access token: HS256 JWT, TTL 15 минут, поле `type: "access"`.
- Refresh token: длинный opaque-токен в БД (новая таблица `RefreshToken { id, userId, tokenHash, deviceId?, expiresAt }`), TTL 90 дней, **rotation on use**.
- На logout — `DELETE FROM RefreshToken WHERE id = ?`.
- Web продолжает использовать существующий 30-дневный cookie-JWT — **не ломаем**.

### 6.3 Навигация (mobile)

`expo-router` (file-based, аналог Next.js App Router):

- Root stack: `index → welcome → (auth) → (onboarding) → (app)`.
- `(app)` — Bottom Tabs: `dashboard | history | scan(FAB) | favorites | profile`.
- Modal stack: `scan`, `product/[id]`.
- Deep links: `skinly://product/<barcode>`, `https://skinly.msvoronov.com/product/<barcode>` через Universal Links / App Links.

### 6.4 State management

- **Server state** — TanStack Query (react-query): кэш, фоновые рефетчи, mutations, optimistic update. Точно подходит для favorites toggle, scans record.
- **Auth state** — `zustand` + `expo-secure-store` (Keychain/Keystore) для токенов.
- **Guest local state** (профиль/favorites/scans offline) — `zustand` + `react-native-mmkv` (быстрее AsyncStorage, синхронное чтение).
- **UI state** (текущая локаль, тема) — `zustand` + AsyncStorage.

### 6.5 API layer

```ts
// apps/mobile/api/client.ts
const baseUrl = Constants.expoConfig.extra.apiBaseUrl;

export const api = ky.create({
  prefixUrl: `${baseUrl}/api/v1`,
  hooks: {
    beforeRequest: [
      (req) => {
        const token = useAuth.getState().accessToken;
        if (token) req.headers.set("authorization", `Bearer ${token}`);
      },
    ],
    afterResponse: [
      async (req, _opts, res) => {
        if (res.status === 401 && !req.url.includes("/auth/")) {
          const refreshed = await tryRefresh();
          if (refreshed) {
            req.headers.set("authorization", `Bearer ${refreshed}`);
            return ky(req);
          }
        }
      },
    ],
    retry: { limit: 1, methods: ["get"] },
  },
});
```

### 6.6 Offline / кэш

- Read-кэш — TanStack Query (in-memory + persistor `@tanstack/query-async-storage-persister`).
- Guest данные — MMKV, тот же контракт, что web demo store.
- Сканы offline: queue в MMKV → flush при появлении сети (`@react-native-community/netinfo`).

### 6.7 Push, analytics, crash, feature flags, deep links, updates

| Возможность | Решение | Стоимость |
|---|---|---|
| Push (iOS+Android) | `expo-notifications` + FCM + APNS (через EAS) | Бесплатно (Firebase free tier) |
| Crash reporting | `sentry-expo` | Free tier 5k events/month |
| Analytics | PostHog (`posthog-react-native`) или Amplitude | Free до ~1M events/month |
| Feature flags | PostHog flags (если уже выбран) или GrowthBook self-hosted | Free |
| Deep links | `expo-linking` + Universal / App Links | Бесплатно |
| OTA updates | EAS Update (JS-only fixes без прохождения review) | Бесплатно ≤ 1k MAU |
| In-app updates | `expo-updates` + force-update gate (рисуем модал, если ниже `minSupportedVersion`) | — |

---

## Часть 7. Экраны мобильного приложения

| # | Экран | Назначение | Ключевые элементы | API | Переходы |
|---|---|---|---|---|---|
| 1 | **Splash** | Загрузка, проверка сессии | Лого, fade-in | `GET /me` (best-effort) | → Welcome / Dashboard |
| 2 | **Welcome** | 3-tier CTA | Лого, value-steps, CTA: «Начать бесплатно» / «Войти» / «Гость» | `POST /auth/guest` | → Onboarding / Login / Dashboard |
| 3 | **Login** | Email+pass | Form, error states, «Забыли пароль» (future) | `POST /auth/login` | → Dashboard |
| 4 | **Register** | Создание аккаунта | Email, password, name (opt.) | `POST /auth/register` | → Dashboard + автомиграция guest |
| 5 | **Onboarding — Skin (5 шагов)** | Skin profile wizard | Progress bar, multi-select, navigation | `PUT /me/beauty-profile` (на guest — кэш в MMKV) | → Hair-onboarding |
| 6 | **Onboarding — Hair** | Hair profile wizard | Аналогично | `PUT /me/hair-profile` | → Account gate (guest) / Dashboard (user) |
| 7 | **Account gate** | Только guest | Bullets, CTA «Создать аккаунт» / «Войти» / «Гостем» | — | → Register / Login / Dashboard |
| 8 | **Dashboard** | Главный экран | Greeting (time-based), Contextual tip (Open-Meteo), ScanCard, Recommendations, Recent scans | `GET /me`, `GET /me/beauty-profile`, `GET /me/scans?limit=5` | → Scan / Product / History |
| 9 | **Scan** | Камера + сканер | Live camera preview, barcode overlay, manual-input fallback | `GET /products/by-barcode/:ean` → `POST /me/scans` | → Product (на success) |
| 10 | **Product** | Детали и совместимость | Фото, brand+name, MatchRing, VerdictCard, IngredientsList, CompatibilityTable, ActionBar (favorite, rescan) | `GET /products/:idOrBarcode`, `POST /compatibility/evaluate` (опц.), `POST /me/favorites/:id/toggle` | → Назад / Scan |
| 11 | **History** | Список сканов | Sectioned list (today/week/month), фильтр, тапнул → Product | `GET /me/scans?limit=200`, `GET /me/favorites` | → Product |
| 12 | **Favorites** | Сохранённые продукты | Grid 2-col, удалить swipe | `GET /me/favorites`, `POST /me/favorites/:id/toggle` | → Product |
| 13 | **Profile** | Аккаунт, статистика | Header (name/email/avatar), SkinProfileCard, HairProfileCard, StatsRow (avg score, scans, products), Preferences (language), Logout | `GET /me/stats`, `GET /me/beauty-profile`, `GET /me/hair-profile` | → Edit profile / Settings / Onboarding (если незаполнено) |
| 14 | **Settings** | Префы | Язык, push prefs, change password, delete account, about | `PUT /me/locale`, `POST /me/devices`, `DELETE /me/*` | — |
| 15 | **Edit Skin Profile** | Редактирование | Reuse Onboarding wizard в режиме edit | `PUT /me/beauty-profile` | → Profile |
| 16 | **Edit Hair Profile** | Аналогично | — | `PUT /me/hair-profile` | → Profile |
| 17 | **Reminder / Notifications** | (Phase 2) Настройка напоминаний о SPF и т.п. | List of toggles | — | — |
| 18 | **Search (Phase 2)** | Поиск по каталогу | Search bar + результаты | `GET /products?q=…` | → Product |

---

## Часть 8. Mobile-специфичные возможности (фичи поверх Web)

| Фича | Ценность | Сложность | Когда добавить |
|---|---|---|---|
| **Нативный barcode-сканер** (`expo-barcode-scanner` / VisionKit / ML Kit) | 🟢 Высокая. На iOS Safari Web-сканер часто требует zxing fallback и работает хуже | 🟢 Низкая | MVP — must |
| **Push: напоминание про SPF** | 🟢 Высокая (стержневой recurring engagement) | 🟡 Средняя (FCM + APNS + cron на сервере для batch'ей) | Phase mobile-1 (через 2-4 нед после MVP) |
| **Виджет iOS (Home Screen)** «текущий контекстный совет» | 🟡 Средняя (премиум-ощущение) | 🟡 Средняя (нативный widget extension) | Phase mobile-3 |
| **Виджет Android (Glance)** | 🟡 Средняя | 🟡 Средняя | Phase mobile-3 |
| **Фото продукта (упаковка)** — кейс когда нет barcode | 🟢 Высокая | 🟡 Средняя (нужно изображение → ML/AI → распознавание бренда/названия). Можно через Anthropic Claude Vision. | Phase mobile-2 |
| **Фото кожи / hair** для анализа | 🟡 Средняя в MVP, но **очень** маркетинговая | 🔴 Высокая (требует image storage, image privacy policy, vision model). Это **отдельный продуктовый эксперимент** | Phase mobile-3+ |
| **Deep links** `skinly://product/<barcode>` + Universal/App Links | 🟢 Высокая (share + push CTAs) | 🟢 Низкая | MVP |
| **Share Sheet** «Поделиться результатом анализа» | 🟢 Высокая для виральности | 🟢 Низкая | MVP/Beta |
| **Полный offline режим** (просмотр истории / профиля без сети) | 🟡 Средняя | 🟡 Средняя (TanStack persistence + MMKV) | MVP должен иметь read-кэш; полный offline — Phase mobile-2 |
| **Background scan-history sync** | 🟡 Средняя | 🟡 (`expo-task-manager`) | Phase mobile-2 |
| **Биометрия (Face ID / Fingerprint) для логина** | 🟡 Средняя | 🟢 (`expo-local-authentication`) | Phase mobile-1 |
| **OTA-обновления (EAS Update)** | 🟢 Высокая для скорости итераций | 🟢 Низкая | MVP |
| **In-app review prompt** (после N успешных сканов) | 🟢 Высокая для рейтинга в сторах | 🟢 (`expo-store-review`) | Beta |
| **Haptics при удачном скане** | 🟢 Низкая ценность но «премиум» | 🟢 (`expo-haptics`) | MVP polish |
| **Apple Sign In** (требуется политикой App Store, если есть email-auth) | 🔴 **Обязательно для iOS publish, если будет соцлогин**; пока есть только email — можно отложить | 🟡 Средняя | Перед публикацией |

---

## Часть 9. Roadmap

> Оценки — **в человеко-неделях для одного strong-fullstack** (если двое — делите пополам). Подходит как PERT-таб.

### Этап 0 — Подготовка к API (1 нед, web only)

- Завести `apps/web/lib/auth/api.ts` (Bearer-helper).
- Завести таблицу `RefreshToken` (Prisma migration).
- Решить версионирование: `/api/v1/*`.
- Договориться о DTO-нейминге (`camelCase`, `null` вместо `undefined`).
- **Риски:** минимальные. **Зависимости:** нет.

### Этап 1 — Backend API (2–3 нед)

- Реализовать все endpoints из таблицы Части 3.2.
- Access (15m) + Refresh (90d) с rotation.
- Перенести `migrate-guest` (включить `hairProfile` в payload).
- Тонкие интеграционные тесты (vitest + supertest).
- **Риски:** «двойная» поверхность auth (cookie для web + Bearer для mobile) — нужно проверить, что middleware не редиректит API запросы (исключить `/api` из matcher).
- **Зависимости:** Этап 0.

### Этап 2 — Mobile foundation (2 нед)

- Превратить web-репо в monorepo (PNPM workspaces). Web не падает.
- Завести `apps/mobile` (Expo SDK 51+, expo-router, TS, Tailwind через `nativewind` ИЛИ просто styled props).
- Завести `packages/{shared-types, compatibility, contextual-rules, i18n-messages, design-tokens}`.
- API client (`ky` + interceptors), MMKV, Secure-Store.
- Базовая навигация: Welcome → (auth) → (onboarding) → (app) tabs.
- **Риски:** наpр., нюансы tailwind на RN (выберем nativewind или ручной theme provider).
- **Зависимости:** Этап 1 (минимально — для auth endpoints).

### Этап 3 — Authentication & Onboarding (1.5 нед)

- Welcome + 3 CTA, Login, Register, Logout.
- Guest session (`POST /auth/guest` + локальный store).
- Onboarding Skin (5 шагов) + Hair wizard.
- Account gate (для guest).
- Guest → User миграция (auto on register/login).
- **Риски:** дизайн форм для маленького screen (Web уже mobile-first 480px, переиспользуется).
- **Зависимости:** Этап 2.

### Этап 4 — Profile + Settings + Dashboard skeleton (1.5 нед)

- `/me`, `/me/beauty-profile`, `/me/hair-profile`, `/me/stats` интеграция.
- Profile screen, Settings (language, logout, change password в beta).
- Dashboard: greeting + recent scans + contextual tip (Open-Meteo напрямую с устройства, port `recommendations.ts` в `packages/contextual-rules`).
- **Риски:** Open-Meteo требует location permission — нужно бережное запрос пермишена.
- **Зависимости:** Этап 3.

### Этап 5 — Scanning + Product details (2 нед)

- `expo-camera` + `expo-barcode-scanner`, permissions UX (iOS Info.plist + Android manifest).
- Manual barcode input fallback.
- Product screen с реальным compatibility result.
- **Decision-point:** запускать engine на mobile (portирован в `packages/compatibility`) или дёргать API. **Рекомендация — API**, тогда KB обновляется без релиза сторов.
- Favorites toggle + Scan record.
- **Риски:** разные barcode-форматы (EAN-8/13, UPC-A/E), iOS-only permissions race. Hardening — много devices testing.
- **Зависимости:** Этап 4, `GET /products/by-barcode/:ean` (есть), `POST /compatibility/evaluate`.

### Этап 6 — History + Favorites + полировка (1 нед)

- History (sectioned list), Favorites grid, swipe-to-remove.
- Sentry/Crashlytics, PostHog analytics.
- Локализация полностью прошита.
- Haptics, splash, app icon.
- **Зависимости:** Этап 5.

### Этап 7 — Release (Beta + Production) (1.5–2 нед)

- Privacy policy URL (обязательно для обоих сторов).
- Apple Privacy Manifest (`PrivacyInfo.xcprivacy`), Android Data Safety form.
- EAS Build → TestFlight beta → 10–20 тестировщиков.
- Google Play Internal Testing → Closed Beta.
- Метрики, фиксы.
- Submit (Apple review ~1–3 дня, Play review ~часы–день).
- **Риски:** Apple часто отказывает первый раз. **Заранее**: чёткий описательный листинг + видео demo + поддерживаемая user-account demo credentials.

### Этап 8 (после MVP) — Push, deep links, виджеты, фото-продукта (4–6 нед)

- Push (FCM + APNS).
- Reminders.
- Деп links (`skinly://product/...` + Universal/App Links).
- Phase mobile-2: AI explanation, фото-продукта (Claude Vision).

**Итого до Production MVP в сторах:** ~10–13 человеко-недель.

---

## Часть 10. Итоговая рекомендация

### 10.1 Готовность

Skinly **примерно на 70%** готов к мобильному клиенту. Ключевая причина — бизнес-логика уже изолирована в pure-функциях и repositories. Самый дорогой шаг (выделение domain-слоя) **уже сделан** — это видно по тому, как `evaluateCompatibility()` запускается одинаково в RSC, на клиенте и в `<ProductActionBar />` без I/O.

### 10.2 Стек

**React Native + Expo SDK 51+ + EAS Build**, PNPM-monorepo с web. Это даёт:

- Один TS-стэк на всю компанию.
- Переиспользование `packages/{compatibility, contextual-rules, shared-types, i18n-messages}`.
- Один CI, один процесс review для TS-кода.

### 10.3 Что сделать на backend (≈ 3 недели)

1. Завести `app/api/v1/*` (см. Часть 6.2). Тонкие handlers поверх существующих repositories.
2. Добавить refresh-токены (новая Prisma-таблица `RefreshToken`, миграция).
3. Включить `hairProfile` в migrate-guest payload.
4. Вынести inline-queries `app/product/[barcode]/page.tsx` в repo `findProductDeep()`.
5. (опционально, но рекомендуется) `POST /compatibility/evaluate` — чтобы KB обновлялась без релиза сторов.
6. Исключить `/api/*` из middleware matcher (там не cookie, там Bearer).

### 10.4 Что сделать на mobile (≈ 8–10 недель)

1. Monorepo + `apps/mobile` (Expo).
2. API client + auth (Keychain/Keystore).
3. Полный набор экранов (Часть 7).
4. Нативный barcode-сканер (`expo-barcode-scanner`).
5. Sentry + PostHog + EAS Update.
6. Подготовка ListingPage для App Store + Google Play.

### 10.5 Самые рискованные места

1. **Apple Review** (всегда). Заранее: privacy policy, demo-аккаунт, support email, justification для camera permission.
2. **iOS permissions UX** (camera, geolocation, push) — три модальных prompt'а подряд = drop-off. Решение: контекстные «pre-prompt» экраны.
3. **HairProfile gap в migration repo.** Поправить **до** того, как mobile начнёт писать hair-данные guest'у.
4. **Двойная auth-поверхность** (cookie-JWT для web + Bearer для mobile). Нужны тщательные интеграционные тесты, чтобы middleware не пушил API-запросы на `/welcome`.
5. **Compatibility KB на mobile vs server.** Если KB живёт **только в коде**, синхронизация с mobile требует релизов. **Решение:** API `POST /compatibility/evaluate`.
6. **AI explanation (Phase 10.2)** — ключ Anthropic **никогда** не в mobile-бандле. Только через API.
7. **Offline записи сканов** могут дублироваться при ре-синхронизации — окно дедупа 30s в `recordScan` спасает, но нужно проверить под нагрузкой.
8. **Apple Sign In:** если когда-то добавим OAuth (Google/etc.), Apple **обяжет** добавить Apple Sign In для iOS-приложения — заранее держим в голове.

### 10.6 Самый быстрый путь до MVP в сторах

- Не пытаться портировать engine на устройство — **сервер-side compatibility** через API. Минус «mobile сложности» в KB-синхронизации.
- Не делать фото-продукта/фото-кожи в MVP — это растягивает MVP на месяцы. **Только barcode** + manual input.
- Не делать push в MVP — добавим в Beta-1.
- Базовая локализация RU + EN, словари переиспользуем 1-в-1.
- Бета через **TestFlight + Google Play Internal Testing** — за пару дней, без полного store-review.

### 10.7 Оценка трудозатрат

| Веха | Срок (1 dev) | Срок (2 dev) | Что внутри |
|---|---|---|---|
| **MVP** (TestFlight + Play Internal) | 8–10 нед | 5–6 нед | API, monorepo, auth, onboarding, profile, scan, product, history, favorites |
| **Beta** (Open beta в обоих сторах + минимальная аналитика) | +2 нед | +1 нед | Sentry, PostHog, EAS Update, in-app review, haptics, polish |
| **Production Ready** | +4–6 нед | +2–3 нед | Push, deep links, фото-продукт (Claude Vision), AI-explanation, виджеты, биометрия, full offline |

---

## Конкретный план действий на ближайшие 30 дней

> Допущение: один strong-fullstack разработчик ≈ 25 продуктивных часов в неделю, итого ≈ 100 часов на 30 дней. План спрямлён под одного человека; при двух — параллелить Web/Mobile-треки.

### Неделя 1 — Foundation на backend и моно-репо

- День 1–2: **Превратить репо в monorepo.** PNPM workspaces, переместить web в `apps/web/`. Зелёный `npm run dev`, зелёный `docker compose up`.
- День 2–3: **Решение по auth-стратегии.** Документ-1-pager: «access 15m + refresh 90d, rotation, новая таблица RefreshToken, web не трогаем». Прислать на ревью.
- День 4–5: **Prisma migration:** `RefreshToken`. Добавить hairProfile в `GuestStatePayload` и `migrateGuestStateToUser`.
- День 5: **Исключить `/api/*` из middleware matcher**, написать helper `getSessionFromRequest`.

### Неделя 2 — Backend API

- День 6–7: **Auth endpoints**: `register`, `login`, `logout`, `guest`, `refresh`. Тесты на happy path и invalid-token.
- День 8: **Me + Profiles**: `GET /me`, `GET/PUT /me/beauty-profile`, `GET/PUT /me/hair-profile`, `GET /me/stats`.
- День 9: **Products**: `GET /products/by-barcode/:ean`, `GET /products/:idOrBarcode` (+ вынести inline query в repo).
- День 10: **Favorites + Scans + migrate-guest**. Тонкие handlers поверх существующих actions.

### Неделя 3 — Mobile foundation + Auth

- День 11: **Завести `apps/mobile`** через `npx create-expo-app` (SDK 51, TS template, expo-router). `package.json` workspaces.
- День 12: **Packages:** вынести `packages/shared-types`, `packages/i18n-messages`, `packages/compatibility`. Web должен продолжать билдиться.
- День 13: **API client** (`ky` + Bearer interceptor + refresh-on-401). Secure-Store для токенов. Zustand store для auth.
- День 14–15: **Welcome → Login → Register screens** на mobile. End-to-end: открыть приложение, зарегистрироваться, увидеть user-данные с реального сервера (через ngrok или dev-deploy).

### Неделя 4 — Onboarding + Dashboard skeleton

- День 16–17: **Onboarding (skin + hair)**: переиспользуем `OnboardingQuestionDef[]` из `lib/mock/`, переделываем UI на RN.
- День 18: **Account gate + Guest mode** с локальным MMKV-кэшем (зеркало web demo store).
- День 19: **Dashboard skeleton** (greeting + scan card + recent placeholder).
- День 20: **Демо для команды.** Записать видео, проверить flow end-to-end, выписать backlog для следующего спринта (scanner + product details).

### Что на выходе через 30 дней

- Web работает ровно как раньше — **не сломано**.
- Backend поддерживает Bearer-auth, есть `/api/v1/*` с покрытием 80% будущих mobile-нужд.
- Mobile-приложение запускается на симуляторе iOS и эмуляторе Android, можно зарегистрироваться, пройти онбординг, увидеть профиль, увидеть пустой dashboard.
- Готовый план следующих 30 дней (scanner + product + favorites + history + beta-deploy).
