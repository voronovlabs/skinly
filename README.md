# Skinly

Персональный ИИ бьюти-ассистент: сканирование косметики по штрихкоду, разбор состава и персональная совместимость с профилем кожи.

## Стек

- **Next.js 15** (App Router) + **TypeScript** + **React 19**
- **Tailwind CSS v4** (CSS-first config через `@theme`)
- **Prisma 6** + **PostgreSQL 16**
- **Docker Compose** (postgres + web)
- Mobile-first, RU/EN i18n
- Auth: email/password + guest mode (Phase 4)

## Roadmap

| Фаза | Статус | Содержимое |
|---|---|---|
| 0. Bootstrap | ✅ | Каркас Next.js, дизайн-токены, Prisma stub, Docker, `/welcome` |
| 1. UI primitives | ⏳ | Button, Card, Tag, Input, Toggle, ProgressBar, MatchRing, BottomNav |
| 2. Static screens | ⏳ | Welcome, Dashboard, History, Favorites, Profile, Analysis (mocks) |
| 3. i18n | ⏳ | next-intl, RU/EN, переключатель |
| 4. Auth + Guest | ⏳ | Auth.js, регистрация, вход, гостевая сессия, миграция |
| 5. Onboarding | ⏳ | 5-шаговый wizard профиля кожи |
| 6. Domain | ⏳ | Полная Prisma-схема, seed, compatibility-engine, `/api/products/[barcode]` |
| 7. Scanner | ⏳ | ZXing, реальный barcode-скан |
| 8. History / Favorites / Ratings | ⏳ | API + RSC, фильтры |
| 9. PWA + Polish | ⏳ | manifest, иконки |
| 10. Docker + Deploy | ⏳ | Dockerfile финализация, инструкции для Linux-сервера |
| 11. Tests + CI | ⏳ | Vitest + Playwright |

Полный план — см. [`CLAUDE.md`](./CLAUDE.md).

## Структура проекта

```
skinly/
├── app/                          # Next.js App Router
│   ├── (marketing)/welcome/      # публичный лендинг
│   ├── globals.css               # дизайн-токены + Tailwind v4
│   ├── layout.tsx                # root layout, Inter font
│   └── page.tsx                  # redirect → /welcome
├── lib/
│   └── prisma.ts                 # Prisma client singleton
├── prisma/
│   └── schema.prisma             # Phase 0 — заглушка HealthCheck
├── public/                       # статика
├── index.html                    # ← UI-прототип, остаётся как референс
├── CLAUDE.md                     # описание MVP
├── docker-compose.yml            # postgres + web
├── Dockerfile                    # multi-stage standalone build
├── next.config.ts
├── tailwind v4 — настроен в globals.css через @theme
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
├── .env.example
└── package.json
```

## Локальный запуск

### 1. Зависимости

```bash
npm install
cp .env.example .env
```

### 2. PostgreSQL через Docker

Поднять только базу для локальной разработки:

```bash
docker compose up -d postgres
```

Проверить, что база жива:

```bash
docker compose ps
docker compose logs postgres | tail
```

### 3. Prisma

Сгенерировать клиент и применить миграцию (на Phase 0 в схеме только `HealthCheck` — это нормально):

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

### 4. Dev-сервер

```bash
npm run dev
```

Открой [http://localhost:3000](http://localhost:3000) — должно перебросить на `/welcome`.

### 5. Проверки

| Что | Команда / шаг |
|---|---|
| Lint | `npm run lint` |
| Типы | `npm run type-check` |
| Prisma Studio | `npm run prisma:studio` → [localhost:5555](http://localhost:5555) |
| Сброс БД (dev) | `npm run prisma:reset` |

## Production / Deploy на Linux-сервер

На сервере (Ubuntu/Debian) с установленными `docker` и `docker compose`:

```bash
git clone <repo> /opt/skinly && cd /opt/skinly
cp .env.example .env
# отредактируй .env: AUTH_SECRET, пароли БД, NEXT_PUBLIC_APP_URL=https://your-domain.tld

docker compose up -d --build
docker compose exec web npx prisma migrate deploy
```

Веб поднимется на `127.0.0.1:3000`. Дальше прокидываешь его через **Caddy** или **Nginx** на твой домен с TLS.

Минимальный `Caddyfile`:

```caddyfile
your-domain.tld {
    reverse_proxy 127.0.0.1:3000
}
```

## Полезные команды

```bash
npm run dev              # dev-сервер
npm run build            # prod-сборка (использует output: standalone)
npm run start            # запустить собранный prod-сервер локально
npm run lint
npm run type-check

npm run prisma:generate
npm run prisma:migrate    # создать миграцию
npm run prisma:deploy     # применить миграции на сервере
npm run prisma:studio
npm run prisma:reset      # ⚠ удаляет все данные

docker compose up -d postgres        # только база (для local dev)
docker compose up -d --build         # вся стопа: postgres + web
docker compose logs -f web
docker compose down
```

## Что нельзя ломать

- Visual style из `index.html` (premium minimal beauty-tech).
- Русский язык по умолчанию, переключатель RU/EN.
- Mobile-first (контейнер `max-width: 480px`).
- Дизайн-токены — только через `@theme` в `app/globals.css`.
