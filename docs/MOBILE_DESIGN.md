# Skinly Mobile — Technical Design (React Native + Expo)

**Контекст:** этот документ — продолжение `MOBILE_ARCHITECTURE.md`. Стек зафиксирован: **React Native + Expo SDK 51+ + EAS** в PNPM-monorepo рядом с web. Бизнес-логика и тонкий HTTP API живут в `apps/web/`; мобильный клиент — в `apps/mobile/`. Shared-код — в `packages/*`.

Цель документа — сжатый архитектурный design без копирования всего проекта.

---

## 1. Структура проекта

```
skinly/                                              ← root monorepo
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                                         ← существующий Next.js
│   └── mobile/                                      ← новый Expo app
│       ├── app/                                     expo-router (file-based)
│       │   ├── _layout.tsx                          Root: QueryClient, NavigationProvider,
│       │   │                                         theme, fonts, i18n provider,
│       │   │                                         <SessionBootstrapper />
│       │   ├── index.tsx                            Splash + первичный routing decision
│       │   ├── welcome.tsx
│       │   ├── (auth)/
│       │   │   ├── _layout.tsx                      гард: если есть session → Redirect /dashboard
│       │   │   ├── login.tsx
│       │   │   └── register.tsx
│       │   ├── (onboarding)/
│       │   │   ├── _layout.tsx                      гард: нужна любая session
│       │   │   ├── skin.tsx
│       │   │   ├── hair.tsx                         (Beta — не в MVP)
│       │   │   └── complete.tsx                     account gate (только guest)
│       │   ├── (app)/
│       │   │   ├── _layout.tsx                      Tabs nav + auth-gate
│       │   │   ├── dashboard.tsx
│       │   │   ├── history.tsx
│       │   │   ├── favorites.tsx
│       │   │   └── profile.tsx
│       │   ├── scan.tsx                             modal (full-screen camera)
│       │   ├── product/[id].tsx                     deep-linkable product details
│       │   └── settings.tsx                         modal
│       │
│       ├── src/
│       │   ├── api/                                 HTTP layer
│       │   │   ├── client.ts                        ky instance + interceptors
│       │   │   ├── refresh.ts                       single-flight refresh
│       │   │   ├── auth.ts                          login/register/guest/refresh/logout
│       │   │   ├── profile.ts                       me, beauty-profile, hair-profile, stats
│       │   │   ├── products.ts                      by-barcode, details
│       │   │   ├── favorites.ts                     list, toggle
│       │   │   ├── scans.ts                         list, record
│       │   │   ├── compatibility.ts                 evaluate
│       │   │   └── migration.ts                     migrate-guest
│       │   │
│       │   ├── stores/                              Zustand
│       │   │   ├── auth.store.ts
│       │   │   ├── guest.store.ts                   зеркало web demo-store
│       │   │   ├── ui.store.ts                      locale, tutorial seen, theme
│       │   │   └── persist.ts                       MMKV + SecureStore adapters
│       │   │
│       │   ├── hooks/                               TanStack Query bindings
│       │   │   ├── useMe.ts
│       │   │   ├── useBeautyProfile.ts
│       │   │   ├── useScans.ts
│       │   │   ├── useFavorites.ts
│       │   │   ├── useProduct.ts
│       │   │   ├── useToggleFavorite.ts
│       │   │   ├── useRecordScan.ts
│       │   │   ├── useCompatibility.ts
│       │   │   └── useContextualTip.ts              greeting + weather + recommendations
│       │   │
│       │   ├── components/
│       │   │   ├── ui/                              Button, Card, Tag, Input,
│       │   │   │                                     ProgressBar, MatchRing, Toggle
│       │   │   ├── layout/                          Screen, BottomTabBar
│       │   │   ├── product/                         ProductCard, VerdictCard,
│       │   │   │                                     IngredientsList,
│       │   │   │                                     CompatibilityTable,
│       │   │   │                                     LiveMatchBadge
│       │   │   ├── scanner/                         ScannerView, AnalyzingOverlay
│       │   │   ├── dashboard/                       Greeting, ContextualTip, ScanCard
│       │   │   ├── onboarding/                      WizardStep, MultiSelect
│       │   │   └── profile/                         ProfileHeader, SkinProfileCard,
│       │   │                                         StatsRow
│       │   │
│       │   ├── theme/
│       │   │   ├── tokens.ts                        импорт из packages/design-tokens
│       │   │   ├── colors.ts
│       │   │   └── typography.ts
│       │   │
│       │   ├── lib/
│       │   │   ├── secure-store.ts                  expo-secure-store wrapper
│       │   │   ├── mmkv.ts                          react-native-mmkv instance
│       │   │   ├── i18n.ts                          i18next setup
│       │   │   ├── notifications.ts                 push registration
│       │   │   ├── linking.ts                       deep links config
│       │   │   ├── analytics.ts                     PostHog wrapper
│       │   │   ├── crash.ts                         Sentry init
│       │   │   └── permissions.ts                   camera/location/notif gates
│       │   │
│       │   ├── features/                            экранно-специфичная логика
│       │   │   ├── scan/                            decodeBarcode, dedup
│       │   │   ├── onboarding/                      validators, step transitions
│       │   │   └── product/                         compatibility view-model
│       │   │
│       │   └── constants.ts
│       │
│       ├── assets/                                  splash, icons, font, lottie
│       ├── app.config.ts                            Expo config (env-aware)
│       ├── babel.config.js
│       ├── metro.config.js                          monorepo aware
│       ├── eas.json                                 EAS Build/Submit profiles
│       └── tsconfig.json                            extends ../../tsconfig.base.json
│
└── packages/
    ├── shared-types/                                Prisma-derived TS types
    │   └── src/{user,profile,product,enums}.ts
    ├── compatibility/                               COPY из apps/web/lib/compatibility
    │   └── src/{types,ingredients,rules,score,explain,adapters,index}.ts
    ├── contextual-rules/                            COPY из apps/web/lib/contextual
    │   └── src/{types,greeting,recommendations}.ts  (без weather.ts — он DOM-specific)
    ├── i18n-messages/
    │   ├── ru.json
    │   ├── en.json
    │   └── src/index.ts                             типы ключей + типобезопасный t()
    └── design-tokens/                               canonical токены
        └── src/{colors,spacing,radius,fonts}.ts     (web читает их через @theme,
                                                      mobile импортит как JS)
```

**Ключевые архитектурные решения:**

- **expo-router**, а не react-navigation напрямую — file-based рутинг повторяет паттерн `apps/web/app/`, и команде проще держать ментальную модель.
- Все экранные файлы — *тонкие*; вся логика в `src/hooks/` и `src/features/`.
- **`packages/compatibility` — это buy-once, use-twice**: web сейчас импортит из `lib/compatibility`; после превращения в пакет — оба клиента читают один источник правды.
- **`packages/design-tokens`** — JS-объект; web подмешивает его в `@theme` через codegen, mobile импортит как обычный модуль. Так Tailwind v4 на web и StyleSheet на mobile видят одни и те же значения.

---

## 2. MVP-экраны

Из 18 экранов аудита оставляем в MVP **минимально достаточный набор** (не «всё что в web», а «всё что закрывает основной flow»):

| # | Экран | Зачем в MVP | Что отложено |
|---|---|---|---|
| 1 | Splash (`index.tsx`) | Решение «куда ехать» по session | — |
| 2 | Welcome | 3-tier CTA | — |
| 3 | Login | Возвращающиеся users | Forgot password — Beta |
| 4 | Register | Регистрация | Apple/Google sign-in — Beta |
| 5 | Onboarding — Skin | Skin-профиль | Hair-онбординг — Beta |
| 6 | Account gate (`complete`) | Конверсия guest → user | — |
| 7 | Dashboard | Главный экран | — |
| 8 | Scan | Камера + штрихкод | Фото-продукт (Vision AI) — Beta+ |
| 9 | Product | Результат + composition + favorite | AI-объяснение — Beta |
| 10 | History | Recent scans, deep-link в Product | Фильтры/поиск — Beta |
| 11 | Favorites | Сохранённое | — |
| 12 | Profile | Шапка + skin-карточка + статистика | Hair-карточка — Beta |
| 13 | Settings | Язык, logout, delete account | Push prefs, biometric — Beta |

**Чего НЕ делаем в MVP:** Hair onboarding/edit, поиск по каталогу, push, виджеты, фото-продукт, AI-объяснение, deep-link share-cards.

---

## 3. API endpoints (контракт mobile ↔ backend)

Все endpoints живут в `apps/web/app/api/v1/*/route.ts`, версионируются префиксом `/v1`, общаются через JSON (UTF-8), используют **Bearer** Authorization.

### Auth

```
POST   /api/v1/auth/register
       body  { email, password, name? }
       resp  { user: {id,email,name,locale}, accessToken, refreshToken,
               expiresIn: 900 }

POST   /api/v1/auth/login
       body  { email, password }
       resp  { user, accessToken, refreshToken, expiresIn }

POST   /api/v1/auth/guest
       body  { }
       resp  { guestId, accessToken, expiresIn }
                                # refreshToken не нужен — guest сессия
                                # пере-выпускается на /auth/guest

POST   /api/v1/auth/refresh
       body  { refreshToken }
       resp  { accessToken, refreshToken, expiresIn }
                                # rotation: старый refreshToken инвалидируется

POST   /api/v1/auth/logout
       header Authorization: Bearer …
       body  { refreshToken? }
       resp  204
```

### Me / Profile

```
GET    /api/v1/me                      → { id, email, name, locale, createdAt }
PATCH  /api/v1/me                      ← { name?, locale? }
DELETE /api/v1/me                      → 204 (cascade)

GET    /api/v1/me/beauty-profile       → BeautyProfileDTO | null
PUT    /api/v1/me/beauty-profile       ← { skinType, sensitivity, concerns,
                                           avoidedList, goal, completion }
                                       → BeautyProfileDTO

GET    /api/v1/me/hair-profile         → HairProfileDTO | null    (Beta)
PUT    /api/v1/me/hair-profile         ← { … }                     (Beta)

GET    /api/v1/me/stats                → { scans, products, avgMatch }

POST   /api/v1/me/migrate-guest        ← GuestStatePayload (как в web)
                                       → { stats: MigrationStats }
```

### Products

```
GET    /api/v1/products/by-barcode/:ean
       resp  { found: true,  product: ProductDTO } |
             { found: false, reason: "invalid"|"not_found" }

GET    /api/v1/products/:idOrBarcode
       resp  ProductDeepDTO {
         id, barcode, brand, name, category, emoji, imageUrl,
         descriptionRu, descriptionEn,
         ingredients: [{
           position, concentration,
           inci, displayNameRu, displayNameEn, safety
         }]
       }
```

### Favorites / Scans

```
GET    /api/v1/me/favorites             → ProductDTO[]
POST   /api/v1/me/favorites/:productId/toggle
                                        → { isFavorite: boolean }

GET    /api/v1/me/scans?limit=200       → ScanDTO[]   (DESC по scannedAt)
POST   /api/v1/me/scans                 ← { productId, matchScore? }
                                        → { deduped: boolean }
```

### Compatibility (опционально — server-side run)

```
POST   /api/v1/compatibility/evaluate
       body  { profile: CompatibilityProfile, facts: IngredientFact[] }
       resp  CompatibilityResult
```

> На MVP пускаем engine **на клиенте** через `packages/compatibility` (мгновенный отклик, нет round-trip). Endpoint держим в API на случай, когда KB начнёт разрастаться — переключение управляется feature flag'ом без релиза.

### Контракты ошибок

Единый формат: `{ error: { code: "validation"|"unauthorized"|"forbidden"|"not_found"|"conflict"|"rate_limited"|"server_error", message, fields? } }`. HTTP-коды строго ожидаемые (401, 403, 404, 409, 422, 429, 500).

---

## 4. Что переиспользуется из существующего backend

| Источник (web) | Куда едет | Изменения |
|---|---|---|
| `apps/web/lib/db/repositories/*` | **остаётся в web**, вызывается из `apps/web/app/api/v1/*/route.ts` | без изменений |
| `apps/web/lib/auth/session.ts` (jose JWT) | остаётся; mobile валидирует тем же `AUTH_SECRET` | в payload добавить `type: "access" \| "refresh"`, `kid` |
| `apps/web/lib/auth/password.ts` (bcryptjs) | остаётся | без изменений |
| `apps/web/lib/compatibility/*` | → `packages/compatibility/` | плоский move; web переходит на import из пакета |
| `apps/web/lib/contextual/recommendations.ts` + `greeting.ts` + `types.ts` | → `packages/contextual-rules/` | weather.ts остаётся в web (DOM-зависимая часть); mobile делает свою тонкую обёртку через `expo-location` + fetch |
| `apps/web/messages/{ru,en}.json` | → `packages/i18n-messages/` | web и mobile импортят один словарь |
| `apps/web/lib/types.ts` | → `packages/shared-types/` | Prisma generated client остаётся в web, но *публичные* DTO/enum'ы — в пакете |
| `apps/web/lib/mock/onboarding-questions.ts` | → `packages/i18n-messages/` (как JSON data) или `packages/shared-types/onboarding.ts` | вопросы превращаются в данные, не TS-код |
| Server actions `app/actions/*` | **остаются**, web продолжает их использовать; mobile звонит API | без изменений |
| `prisma/schema.prisma` | без изменений + новая таблица `RefreshToken` + миграция | новая миграция |
| Open-Meteo URL | mobile дёргает напрямую теми же query-params | — |

**Чего mobile касаться НЕ должен:**

- `apps/web/middleware.ts` — это Web cookie-flow.
- `apps/web/lib/demo-store/*` — web localStorage; на mobile своя реализация на MMKV (контракт совпадает).
- `apps/web/lib/auth/server.ts` (`cookies()`) — Node-Next only.

---

## 5. Expo-библиотеки

| Возможность | Библиотека | Заметки |
|---|---|---|
| Camera + сканер штрихкодов | **`expo-camera`** (включает barcode scanner с SDK 51+) | `expo-barcode-scanner` deprecated; новый `CameraView` поддерживает форматы `ean13`, `ean8`, `upc_a`, `upc_e`, `code128` и т.п. |
| Permissions UX | `expo-camera` встроенные хуки + кастомный pre-prompt экран | три модала подряд (camera/location/notif) = drop-off. Pre-prompt'ы обязательны |
| Локация | `expo-location` | для Open-Meteo (contextual tip). Опциональна — fallback на time-based tip |
| Secure storage (токены) | **`expo-secure-store`** | Keychain (iOS) / Keystore (Android). Только для refresh/access токенов |
| Быстрый локальный store | **`react-native-mmkv`** | для guest state, query persistence, feature flags. Синхронный, в разы быстрее AsyncStorage |
| Notifications (push) | **`expo-notifications`** + FCM (Android) + APNS (iOS через EAS) | Beta. На MVP не нужно |
| Deep links | **`expo-linking`** + `expo-router` config | `skinly://product/<id>`, `https://skinly.msvoronov.com/product/<id>` через Universal Links / App Links |
| Routing | **`expo-router`** v3+ | file-based, в духе Next.js App Router |
| Share | **`expo-sharing`** | поделиться карточкой продукта |
| OTA updates | **`expo-updates`** (управляется через EAS Update) | дешёвые JS-only фиксы без прохождения store review |
| Биометрия | `expo-local-authentication` | Beta-фича: Face ID / Touch ID для unlock |
| Haptics | `expo-haptics` | feedback при удачном скане |
| In-app review | `expo-store-review` | после N успешных сканов |
| Crash reporting | **`@sentry/react-native`** (через `sentry-expo` plugin) | source maps автоматом через EAS |
| Analytics | **`posthog-react-native`** | feature flags + events; можно заменить на Amplitude |
| i18n | `i18next` + `react-i18next` + `expo-localization` | язык устройства как hint, override через Settings |
| Animations | `react-native-reanimated` 3 + `moti` для микро-анимаций | в Expo SDK уже стоит |
| Bottom sheets | `@gorhom/bottom-sheet` | для filter modals в History/Favorites |
| Network state | `@react-native-community/netinfo` | для retry/offline queue логики |
| Fonts | `expo-font` + Inter (как в web) | — |

**О стилях:** Tailwind v4 (`@theme`) на mobile **не транслируется напрямую**. Два варианта:

- **A (рекомендую):** `StyleSheet.create(...)` + `packages/design-tokens` как канонический источник цветов/spacing'а. Просто, типобезопасно, без рантайм-парсера.
- **B:** `nativewind` v4 — почти-Tailwind на RN, но это runtime-парсер; для премиум-приложения добавляет ~15-30мс на mount экранов.

Выбираем **A** для MVP, B можно прикрутить позже.

---

## 6. Zustand stores

Три store'а — больше не нужно. Server state живёт в TanStack Query, не в Zustand.

### 6.1 `auth.store.ts`

```ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { secureStoreAdapter } from "@/lib/secure-store";

export type AuthSession =
  | { kind: "user"; userId: string; email: string; name: string | null }
  | { kind: "guest"; guestId: string }
  | null;

interface AuthState {
  session: AuthSession;
  accessToken: string | null;
  refreshToken: string | null;             // только для user-сессии
  expiresAt: number | null;                // UNIX ms, для proactive refresh

  hydrated: boolean;                       // прочитан ли SecureStore

  /* actions */
  setUserSession: (s: Extract<AuthSession, { kind: "user" }>,
                   tokens: { access: string; refresh: string;
                             expiresIn: number }) => Promise<void>;
  setGuestSession: (guestId: string, accessToken: string,
                    expiresIn: number) => Promise<void>;
  applyRefresh: (tokens: { access: string; refresh: string;
                           expiresIn: number }) => Promise<void>;
  clear: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      hydrated: false,

      setUserSession: async (s, { access, refresh, expiresIn }) => {
        set({
          session: s,
          accessToken: access,
          refreshToken: refresh,
          expiresAt: Date.now() + expiresIn * 1000,
        });
      },
      setGuestSession: async (guestId, access, expiresIn) => {
        set({
          session: { kind: "guest", guestId },
          accessToken: access,
          refreshToken: null,
          expiresAt: Date.now() + expiresIn * 1000,
        });
      },
      applyRefresh: async ({ access, refresh, expiresIn }) => {
        set({
          accessToken: access,
          refreshToken: refresh,
          expiresAt: Date.now() + expiresIn * 1000,
        });
      },
      clear: async () => {
        set({ session: null, accessToken: null,
              refreshToken: null, expiresAt: null });
      },
    }),
    {
      name: "skinly.auth.v1",
      storage: createJSONStorage(() => secureStoreAdapter),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
```

Токены кладутся **только в SecureStore** (Keychain/Keystore), не в MMKV. Это критично — MMKV не шифруется по умолчанию.

### 6.2 `guest.store.ts` — зеркало web demo-store

```ts
interface GuestSkinProfile { /* как в lib/demo-store/types.ts */ }
interface GuestScan { id: string; productId: string; scannedAt: number; }

interface GuestState {
  version: 1;
  skinProfile: GuestSkinProfile | null;
  hairProfile: GuestHairProfile | null;       // Beta
  favoriteIds: string[];
  history: GuestScan[];                       // max 100, freshest first

  setSkinProfile: (p: GuestSkinProfile) => void;
  toggleFavorite: (productId: string) => void;
  addScan: (productId: string) => void;
  reset: () => void;

  /** Сериализованный payload для POST /me/migrate-guest. */
  exportForMigration: () => GuestStatePayload;
}

export const useGuestStore = create<GuestState>()(
  persist(/* … */, { name: "skinly.guest.v1",
                     storage: createJSONStorage(() => mmkvAdapter) }),
);
```

Контракт ровно совпадает с web demo-store → миграция работает через тот же `POST /me/migrate-guest` без extra полей.

### 6.3 `ui.store.ts`

```ts
interface UIState {
  locale: "ru" | "en";
  hasSeenTutorial: boolean;
  hasSeenScannerPermissionRationale: boolean;
  hasSeenLocationRationale: boolean;

  setLocale: (l: "ru" | "en") => void;
  markTutorialSeen: () => void;
  markScannerRationaleSeen: () => void;
  markLocationRationaleSeen: () => void;
}
```

Persistence — MMKV.

### Что **НЕ** держим в Zustand

- Server-fetched данные (`Product`, `BeautyProfile` user'а, scans-list) — это **TanStack Query**, не store. У Query своя инвалидация, optimistic updates, retry. Дублирование в Zustand приведёт к stale данным.
- Текущий экран / modal / form-state — локальный `useState`.

---

## 7. Навигация (`expo-router`)

### 7.1 Дерево маршрутов

```
/                              index.tsx           — Splash + decision
/welcome                       welcome.tsx
/(auth)/login                  (auth)/login.tsx
/(auth)/register               (auth)/register.tsx
/(onboarding)/skin             (onboarding)/skin.tsx
/(onboarding)/hair             (onboarding)/hair.tsx          [Beta]
/(onboarding)/complete         (onboarding)/complete.tsx       (gate)
/(app)/dashboard               (app)/dashboard.tsx
/(app)/history                 (app)/history.tsx
/(app)/favorites               (app)/favorites.tsx
/(app)/profile                 (app)/profile.tsx
/scan                          scan.tsx                        (modal)
/product/[id]                  product/[id].tsx                (modal/push)
/settings                      settings.tsx                    (modal)
```

### 7.2 Gating через `_layout.tsx`

```tsx
// app/(app)/_layout.tsx
import { Redirect, Tabs } from "expo-router";
import { useAuthStore } from "@/stores/auth.store";

export default function AppLayout() {
  const session = useAuthStore((s) => s.session);
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) return null;            // Splash покажет fallback
  if (!session) return <Redirect href="/welcome" />;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: true }}>
      <Tabs.Screen name="dashboard" options={{ title: "Главная" }} />
      <Tabs.Screen name="history"   options={{ title: "История" }} />
      <Tabs.Screen name="favorites" options={{ title: "Избранное" }} />
      <Tabs.Screen name="profile"   options={{ title: "Профиль" }} />
    </Tabs>
  );
}
```

```tsx
// app/(auth)/_layout.tsx
export default function AuthLayout() {
  const session = useAuthStore((s) => s.session);
  if (session?.kind === "user") return <Redirect href="/(app)/dashboard" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### 7.3 Deep links

`app.config.ts`:

```ts
{
  scheme: "skinly",
  ios: { associatedDomains: ["applinks:skinly.msvoronov.com"] },
  android: { intentFilters: [/* applinks for skinly.msvoronov.com */] },
}
```

Маршруты `skinly://product/<id>` и `https://skinly.msvoronov.com/product/<id>` указывают в **тот же** `product/[id].tsx` файл (expo-router сам разруливает).

### 7.4 FAB-скан

Bottom tabs имеют 4 видимых таба + центральная FAB-кнопка как кастомный компонент, открывающий modal `/scan`. Это не отдельный таб (чтобы не плодить routing-ловушку).

---

## 8. Архитектура API client

### 8.1 Слои

```
hooks/useProduct.ts            ← TanStack Query bindings
        │
        ▼
api/products.ts                ← типизированные функции (getProductByBarcode, …)
        │
        ▼
api/client.ts                  ← ky instance + interceptors
        │
        ▼
fetch (RN polyfilled)
```

### 8.2 Базовый клиент

```ts
// api/client.ts
import ky from "ky";
import Constants from "expo-constants";
import { useAuthStore } from "@/stores/auth.store";
import { refreshAccessToken } from "./refresh";

export const apiBaseUrl: string = Constants.expoConfig?.extra?.apiBaseUrl;

export const api = ky.create({
  prefixUrl: `${apiBaseUrl}/api/v1`,
  timeout: 15_000,
  retry: { limit: 2, methods: ["get"], statusCodes: [408, 502, 503, 504] },
  hooks: {
    beforeRequest: [
      (req) => {
        const { accessToken } = useAuthStore.getState();
        if (accessToken) {
          req.headers.set("authorization", `Bearer ${accessToken}`);
        }
        req.headers.set("accept-language", useUIStore.getState().locale);
      },
    ],
    afterResponse: [
      async (req, _opts, res) => {
        if (res.status !== 401) return;
        if (req.url.includes("/auth/")) return;       // не зацикливаем refresh

        const newAccess = await refreshAccessToken();
        if (!newAccess) return;                       // refresh упал — пускаем 401 наверх

        req.headers.set("authorization", `Bearer ${newAccess}`);
        return ky(req);
      },
    ],
    beforeError: [
      async (err) => {
        // нормализуем ошибки в кастомный ApiError с code/message/fields
        return normalizeError(err);
      },
    ],
  },
});
```

### 8.3 Single-flight refresh

```ts
// api/refresh.ts
let inflight: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { refreshToken, applyRefresh, clear } = useAuthStore.getState();
    if (!refreshToken) return null;

    try {
      const r = await ky.post(`${apiBaseUrl}/api/v1/auth/refresh`, {
        json: { refreshToken },
        retry: 0,
      }).json<{ accessToken: string; refreshToken: string;
                expiresIn: number }>();
      await applyRefresh(r);
      return r.accessToken;
    } catch {
      await clear();              // refresh не валиден → ребросаем на /welcome
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
```

Это закрывает «громовое стадо»: десять параллельных 401-ответов триггерят **один** refresh, остальные ждут результат.

### 8.4 Типизированные endpoint-функции

```ts
// api/products.ts
export async function getProductByBarcode(barcode: string)
  : Promise<ProductLookupResult> {
  return api.get(`products/by-barcode/${barcode}`).json();
}

export async function getProductDeep(idOrBarcode: string)
  : Promise<ProductDeepDTO> {
  return api.get(`products/${idOrBarcode}`).json();
}
```

### 8.5 Hooks слой (TanStack Query)

```ts
// hooks/useProduct.ts
export function useProduct(idOrBarcode: string) {
  return useQuery({
    queryKey: ["product", idOrBarcode],
    queryFn: () => getProductDeep(idOrBarcode),
    staleTime: 5 * 60_000,
  });
}

// hooks/useToggleFavorite.ts
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      api.post(`me/favorites/${productId}/toggle`).json<{ isFavorite: boolean }>(),
    onMutate: async (productId) => {
      await qc.cancelQueries({ queryKey: ["favorites"] });
      const prev = qc.getQueryData<ProductDTO[]>(["favorites"]) ?? [];
      const optimistic = prev.some((p) => p.id === productId)
        ? prev.filter((p) => p.id !== productId)
        : [...prev, { id: productId } as ProductDTO];
      qc.setQueryData(["favorites"], optimistic);
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favorites"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
}
```

### 8.6 QueryClient persistence

```ts
// app/_layout.tsx
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

const persister = createAsyncStoragePersister({ storage: mmkvAdapter });

persistQueryClient({ queryClient, persister, maxAge: 24 * 60 * 60_000 });
```

→ Открытое приложение без сети показывает последние данные сразу, fetch идёт фоном.

---

## 9. Стратегия авторизации

### 9.1 Сводка

| Параметр | Web | Mobile |
|---|---|---|
| Транспорт | `httpOnly` cookie | `Authorization: Bearer …` |
| Тип токена | JWT (HS256, jose), 30 дней | **access** JWT (HS256, 15 мин) + **refresh** opaque (90 дней) |
| Хранение | Browser cookie jar | `expo-secure-store` (Keychain / Keystore) |
| Rotation | нет (длинный JWT) | refresh ротируется на каждый use |
| Revocation | удалить cookie | удалить refresh-row в БД |
| Guest | guestId в том же cookie | guest **access** (15 мин), без refresh; перевыпуск через `POST /auth/guest` при истечении |
| Secret | `AUTH_SECRET` | **тот же** `AUTH_SECRET` |

### 9.2 БД-слой (новая Prisma модель)

```prisma
model RefreshToken {
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String   @unique          // sha256(token) — никогда не храним plain
  deviceId   String?                   // future: device-binding
  userAgent  String?
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?

  user       User     @relation(fields: [userId], references: [id],
                                 onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}
```

### 9.3 Lifecycle

1. **Register / Login** → сервер генерит `access` (15m) и **opaque** `refresh` (`crypto.randomBytes(32).toString("base64url")`). Сохраняет `sha256(refresh)` в `RefreshToken`. Возвращает оба mobile'у. Mobile кладёт оба в SecureStore.
2. **API запрос** → `beforeRequest` подкладывает access в заголовок. 200 — happy path.
3. **Access истёк** → сервер вернёт 401. `afterResponse` идёт в **single-flight `refreshAccessToken()`**, который шлёт `POST /auth/refresh { refreshToken }`. Сервер сверяет sha256, **ротирует** (создаёт новую row, ставит старой `revokedAt`), возвращает новую пару. Mobile обновляет SecureStore и **повторяет** исходный запрос с новым access.
4. **Refresh истёк / revoked / не нашёлся** → `auth.clear()`, маршрутизация на `/welcome`.
5. **Logout** → `POST /auth/logout { refreshToken }` → server ставит `revokedAt`. Mobile стирает SecureStore.
6. **Compromised refresh detection** → если приходит refresh, который уже `revoked`, это **сигнал реюза** (атакующий и легитимный клиент гонятся): инвалидируем **все** refresh-токены этого user'а. Это стандартный паттерн «refresh token reuse detection».

### 9.4 Guest-сессии

`POST /auth/guest` возвращает только access (15m). Mobile хранит его в SecureStore (там же, где user-токены). При истечении просто заново зовём `/auth/guest` (новый guestId не нужен — он живёт в JWT payload).

> **Inv:** guest НЕ может получить refresh. Это ограничение умышленное — guest должен либо мигрировать в user-аккаунт, либо терять «вечную» сессию при долгом простое.

### 9.5 Биометрия (Beta)

`expo-local-authentication`: при наличии Face ID / Touch ID — спросить unlock перед раскрытием refresh-токена. SecureStore с флагом `requireAuthentication: true` делает это нативно на iOS; на Android — отдельный prompt через `LocalAuthentication.authenticateAsync`.

### 9.6 Что НЕ ломаем на web

Web продолжает использовать существующий 30-дневный cookie-JWT. **Ни одна** строка `apps/web/middleware.ts` или server actions не меняется. Mobile-Bearer и Web-cookie живут параллельно, у каждого — свой entry-point в `verifySession()`.

---

## 10. Пример экрана — `product/[id].tsx`

Это **самый показательный** экран: route-параметр, server query, локальный compatibility engine, optimistic mutation, навигация назад в Scan, error/loading states.

```tsx
// apps/mobile/app/product/[id].tsx
import { useMemo } from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { evaluateCompatibility, inciToFact }       // ← packages/compatibility
  from "@skinly/compatibility";

import { useProduct }            from "@/hooks/useProduct";
import { useBeautyProfile }      from "@/hooks/useBeautyProfile";
import { useToggleFavorite }     from "@/hooks/useToggleFavorite";
import { useRecordScan }         from "@/hooks/useRecordScan";
import { useFavoriteIds }        from "@/hooks/useFavorites";
import { useAuthStore }          from "@/stores/auth.store";
import { useGuestStore }         from "@/stores/guest.store";

import { Screen }                from "@/components/layout/Screen";
import { VerdictCard }           from "@/components/product/VerdictCard";
import { IngredientsList }       from "@/components/product/IngredientsList";
import { ProductActionBar }      from "@/components/product/ProductActionBar";
import { ErrorBanner }           from "@/components/ui/ErrorBanner";

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation("product");

  /* ── server state ──────────────────────────────────────── */
  const productQuery = useProduct(id!);
  const profileQuery = useBeautyProfile();        // user → API, guest → guest-store
  const favoriteIds  = useFavoriteIds();          // string[]

  const toggleFavorite = useToggleFavorite();
  const recordScan     = useRecordScan();

  /* ── compatibility (pure, локально) ───────────────────── */
  const compat = useMemo(() => {
    if (!productQuery.data || !profileQuery.data) return null;
    const facts = productQuery.data.ingredients.map((ing, idx) =>
      inciToFact(ing.inci, idx + 1));
    return evaluateCompatibility(profileQuery.data, facts);
  }, [productQuery.data, profileQuery.data]);

  /* ── side-effect: запись в историю при первом успешном маунте ── */
  useRecordScanOnMount(id!, compat?.score ?? 0);

  /* ── render states ────────────────────────────────────── */
  if (productQuery.isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center",
                       justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (productQuery.isError || !productQuery.data) {
    return (
      <Screen>
        <ErrorBanner
          message={t("loadError")}
          onRetry={() => productQuery.refetch()}
          onBack={() => router.back()}
        />
      </Screen>
    );
  }

  const product = productQuery.data;
  const isFavorite = favoriteIds.includes(product.id);

  return (
    <Screen>
      <Stack.Screen options={{
        title: product.brand,
        headerBackTitle: t("back"),
      }} />

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <ProductHero
          brand={product.brand}
          name={product.name}
          imageUrl={product.imageUrl}
          emoji={product.emoji}
        />

        {compat ? (
          <VerdictCard
            score={compat.score}
            verdict={compat.verdict}
            reasons={compat.reasons}
          />
        ) : (
          <ProfileEmptyHint
            onPress={() => router.push("/(onboarding)/skin")}
          />
        )}

        <IngredientsList
          items={compat?.ingredientFindings ?? defaultFindings(product)}
        />
      </ScrollView>

      <ProductActionBar
        isFavorite={isFavorite}
        onToggleFavorite={() => toggleFavorite.mutate(product.id)}
        onRescan={() => router.replace("/scan")}
      />
    </Screen>
  );
}
```

**Что этот экран демонстрирует:**

- **Route params** (`useLocalSearchParams<{id: string}>`).
- **Параллельные queries** (`useProduct`, `useBeautyProfile`, `useFavoriteIds`) — TanStack Query параллелит автоматически.
- **Shared logic из packages**: `evaluateCompatibility` и `inciToFact` импортятся из `@skinly/compatibility` — **тот же код, что у web**.
- **Optimistic mutation**: `useToggleFavorite` (см. §8.5) делает мгновенный update + rollback.
- **Side-effect через хук**: `useRecordScanOnMount` идемпотентен (single-shot guard через `useRef`), за счёт чего `POST /me/scans` отправляется один раз даже при re-render.
- **Guest fallback** — `useBeautyProfile()` сам решает: для user — API-fetch, для guest — `useGuestStore`. Этот экран ничего про режим не знает.
- **Loading/Error/Empty** states — все три явные.
- **Deep-link compatibility** — если открыть `skinly://product/<id>`, expo-router сам сматчит этот файл без модификаций.

Что **остаётся в специализированных модулях** (а не загромождает экран):

- `useRecordScanOnMount` — в `src/features/product/use-record-scan-on-mount.ts`.
- `ProductHero`, `ProfileEmptyHint`, `IngredientsList`, `VerdictCard`, `ProductActionBar` — в `components/product/`.
- `defaultFindings(product)` — fallback (без профиля) в `src/features/product/findings.ts`.

---

## Резюме design-решений

1. **Monorepo PNPM** с `apps/{web,mobile}` и `packages/{compatibility,contextual-rules,shared-types,i18n-messages,design-tokens}` — переиспользование TS-логики без переписывания.
2. **expo-router** + file-based gates через `_layout.tsx`.
3. **TanStack Query** для server state, **Zustand** только для auth/guest/ui — никакого дублирования.
4. **`ky` + single-flight refresh** + автоматический retry для GET.
5. **Access 15m + Refresh 90d** с rotation; refresh — opaque в SecureStore; web остаётся на cookie.
6. **expo-camera** (новый scanner) вместо deprecated `expo-barcode-scanner`.
7. **Engine компатибильности на устройстве** в MVP (мгновенный отклик); опциональный server-side endpoint оставлен как escape hatch.
8. **MMKV для всего, кроме токенов; SecureStore для токенов.**
9. **StyleSheet + design-tokens пакет** вместо nativewind на MVP.
10. **MVP экраны — 13**, всё остальное в Beta / Production-Ready (push, hair, фото-продукт, AI-объяснение, виджеты).
