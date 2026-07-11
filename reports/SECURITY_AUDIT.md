# Skinly — Security Audit (Pre-Release)

**Роль аудитора:** Senior Security Engineer (OWASP Top 10, Cloud / API / Mobile Security, DevSecOps)
**Область:** web (Next.js 15 + Prisma + Postgres), mobile (Expo/React Native), Docker/compose, Caddy, конфиги, зависимости.
**Метод:** статический разбор кода обоих репозиториев (`skinly`, `skinly-mobile`) по строкам, threat modeling, архитектурный разбор.
**Дата:** 2026-07.
**Вопрос заказчика:** «Если завтра публичный релиз — насколько легко его сломать?»

> **Короткий ответ.** Ядро логики авторизации написано аккуратно: каждый запрос к пользовательским данным скоупится по `userId` из подписанной сессии, Prisma параметризован, SQL-инъекций в рантайме нет, токены на мобиле лежат в Keychain/Keystore. Это выше среднего для pet-scale проекта. **Но к массовому публичному релизу проект не готов.** Отсутствуют базовые контроли уровня платформы: rate limiting, отзыв сессий, security-заголовки/CSP, верификация email, а прод-compose публикует web напрямую в интернет по plaintext HTTP. Это не «дыры в коде», это отсутствующие слои защиты, без которых при 100 000 пользователей проект ломается предсказуемыми, полностью автоматизируемыми атаками (credential stuffing, спам-регистрации, DoS).
>
> **Общая оценка: 5 / 10.** Хорошая кодовая гигиена, слабая production-безопасность платформы.

---

## Содержание

1. Карта системы
2. Trust boundaries
3. Threat modeling (по типам атакующих)
4. Архитектурные риски
5. Находки по категориям (Critical → Info)
6. Итоговая таблица + оценка
7. Roadmap исправлений (1 неделя / 1 месяц / 3 месяца)
8. Architecture Security Roadmap (P0–P3)
9. Ответ на вопрос «100 000 пользователей»

---

## 1. Карта системы

```
┌─────────────┐      ┌──────────────┐
│ Mobile app  │      │ Web browser  │
│ Expo/RN     │      │ (Next client)│
│ SecureStore │      │ cookie       │
│ Bearer JWT  │      │ skinly_session│
└──────┬──────┘      └──────┬───────┘
       │ HTTPS               │ HTTPS
       │ Authorization:      │ Cookie
       │ Bearer <access>     │
       ▼                     ▼
┌─────────────────────────────────────────────┐
│           ИНТЕРНЕТ (публично)                 │
│  Caddy (TLS)  ──►  порт 3000                  │
│  ⚠ compose ТАКЖЕ публикует 0.0.0.0:3000       │  ← обход Caddy
└───────────────────────┬───────────────────────┘
                        ▼
┌─────────────────────────────────────────────┐
│  Next.js (монолит, standalone, uid 1001)     │
│  ├─ middleware.ts   (Edge, verify JWT)        │
│  ├─ Server Actions  (web, POST)               │
│  ├─ /api/v1/*       (mobile REST, Bearer)     │
│  ├─ lib/auth        (jose HS256, bcryptjs)    │
│  ├─ lib/compatibility (детерминированный движок)│
│  └─ lib/recommendations, contextual           │
└──────────┬───────────────────────┬────────────┘
           │ Prisma                 │ outbound fetch
           ▼                        ▼
┌────────────────────┐   ┌────────────────────────┐
│ PostgreSQL 16      │   │ Open-Meteo (погода)     │
│ Docker network     │   │ внешние image URL / CDN │
│ НЕ опубликован     │   │ (рендерятся <img> у     │
│ (prod)             │   │  клиента, не проксируются)│
└────────────────────┘   └────────────────────────┘

Offline (не в рантайме, за HTTP недостижимо):
  scripts/* — скрейперы/нормализаторы/импорт (tsx, профиль "tools")
```

Потоки данных:
- **Auth/session:** web → cookie `skinly_session` (HS256 JWT); mobile → `access` (15 мин) + `refresh` (30 дней) в Keychain/Keystore, оба подписаны тем же `AUTH_SECRET`.
- **Персональные данные (PII):** email + bcrypt-hash пароля, beauty-profile (тип кожи, чувствительность, concerns, avoided-ингредиенты — health-adjacent), scan history, favorites, reviews. Всё в одной Postgres.
- **Каталог:** публичный read-only (по дизайну), пагинация ограничена (`MAX_LIMIT = 50`).
- **Guest flow:** гость работает на клиентском demo-store; при register/login данные мигрируют в Postgres.

---

## 2. Trust boundaries

| Зона | Что | Доверие |
|---|---|---|
| **Клиент (untrusted)** | mobile-бандл, web JS, demo-store, MMKV, cookie, Bearer в памяти/Keychain, `X-Anon-Id`, тело server-action, тело `/api/v1/*` | 0. Всё контролируется атакующим. |
| **Публичный интернет** | Caddy:443, **web:3000 (0.0.0.0 — ошибка)** | Периметр. Единственная точка входа должна быть Caddy. |
| **Внутри Docker network** | postgres:5432 (в prod не опубликован), web↔postgres | Полу-доверенная. Компрометация web = доступ к БД. |
| **Секреты** | `AUTH_SECRET`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `ANTHROPIC_API_KEY` — только env, не в git (`.env` в `.gitignore`), не build-args | ОК по хранению; слабые дефолты (см. F-DB). |
| **PII-поток** | пароль-хэш, beauty-profile, история — Postgres + (гость) клиентский MMKV в открытом виде | Нет шифрования на клиенте гостя; нет бэкапов на сервере. |
| **Компоненты, которые могут быть скомпрометированы** | внешний image-CDN (poisoned URL → beacon у всех зрителей), Open-Meteo, npm-зависимости, один VPS (SPOF) | Внешний image-источник — не доверенный, но рендерится без allowlist. |

**Главный архитектурный дефект границ:** прод-`docker-compose.yml` публикует `3000:3000` на `0.0.0.0`, хотя весь дизайн (README, комментарии) предполагает `127.0.0.1` за Caddy. Trust boundary «только Caddy смотрит в интернет» фактически нарушена.

---

## 3. Threat modeling

Формат: вход → что может → какие данные → влияние на других → может ли положить сервис → что есть / чего нет.

### 3.1 Атакующий без аккаунта
- **Вход:** публичные страницы, `/api/v1/auth/*`, `/api/v1/products*`, `/api/v1/events`, server-actions каталога, порт 3000.
- **Может:** неограниченно брутить login / спамить register (нет rate limit, нет lockout, нет CAPTCHA, email не верифицируется); перечислять зарегистрированные email (register отдаёт `409 email_taken`); форжить поведенческие события под чужой `X-Anon-Id`; читать весь каталог; при доступе к :3000 — снимать креды по plaintext HTTP.
- **Данные:** факт существования email; публичный каталог.
- **На других:** отравление рекомендаций через `X-Anon-Id`; накрутка/подделка агрегатного рейтинга через фермы аккаунтов.
- **Положить сервис:** да — см. раздел DDoS (auth-эндпоинты, поиск, insert-флуд событий).
- **Есть:** подпись JWT проверяется, bcrypt, uniform-ошибка на login. **Нет:** rate limit, verification, WAF, TLS-принуждение на :3000.

### 3.2 Атакующий с обычным аккаунтом
- **Вход:** все `/api/v1/*` с Bearer, все мутирующие server-actions.
- **Может:** mass-assignment — задать `userId` строке `BeautyProfile` через object-spread (`create: { userId, ...input }`), теоретически создать профиль от имени жертвы (ограничено непубличностью внутренних cuid); слать неограниченные массивы (`getProductsByIdsAction`, миграция) — мягкий DoS; спамить reviews/events.
- **Данные:** только свои (скоуп по `userId` соблюдён везде — IDOR на чтение/изменение чужого **не найден**).
- **На других:** порча персонализации жертвы (при знании её cuid); накрутка рейтингов.
- **Есть:** сквозной скоуп `session.userId`, `@@unique(userId, productId)` на favorites/reviews. **Нет:** whitelisting полей записи, лимитов на размер массивов.

### 3.3 Атакующий с украденным JWT
- **Вход:** cookie или Bearer.
- **Может:** пользоваться сессией **до 30 дней**. Logout только чистит cookie — серверного отзыва нет (нет `jti`/`tokenVersion`/blocklist). Refresh (`/api/v1/auth/refresh`) бесконечно продлевает цепочку без reuse-detection. Даже удаление аккаунта не инвалидирует выданные токены на уровне middleware.
- **Bonus:** token-type confusion — refresh-токен (30 дней) можно подставить в cookie `skinly_session`: `verifySession` не проверяет `tokenType`.
- **Положить сервис:** нет, но полный аккаунт-тейковер жертвы.
- **Есть:** короткий access (15 мин). **Нет:** отзыв, ротация с reuse-detection, разделение аудитории токенов.

### 3.4 Атакующий с доступом к мобильному приложению (reverse engineering / MITM)
- **Вход:** бандл, устройство, сеть.
- **Может:** при установленном пользовательском/вредоносном root-CA перехватить трафик, включая креды и токены (**нет certificate pinning**); на rooted-устройстве прочитать guest beauty-profile/историю из **незашифрованного MMKV**; вытащить прод-`console.log` из logcat (нет `transform-remove-console`); over-privileged `RECORD_AUDIO`.
- **Есть:** access/refresh в SecureStore (Keychain/Keystore) — корректно; баркод валидируется regex; нет хардкод-секретов в бандле. **Нет:** pinning, шифрование MMKV, strip console в проде.

### 3.5 Атакующий с доступом к публичному API
- **Вход:** `/api/v1/*` (middleware их НЕ покрывает — matcher исключает `api`; auth проверяется в каждом хендлере вручную).
- **Может:** любая забытая проверка в новом хендлере = публичный эндпоинт (fail-open). Wildcard CORS `*` на всём `/api/v1`, включая auth и `DELETE /me`.
- **Есть:** сейчас все мутации отбивают не-user 401. **Нет:** централизованного auth-wrapper, defense-in-depth, scoped CORS.

### 3.6 Бот / скрейпер
- Каталог публичный и пагинируемый — выкачивается целиком. Событийный эндпоинт принимает произвольный `X-Anon-Id` без подписи. Нет anti-automation. Влияние: кража каталога, шум в аналитике/рекомендациях, рост таблиц.

### 3.7 DDoS
- Нет rate limit ни на прокси, ни в приложении; нет WAF/CDN перед сервером; один VPS. Дешёвые L7-цели: `/api/v1/auth/login` (bcrypt cost 10 — CPU на каждый запрос), поиск/каталог (запросы к Postgres), insert-флуд `/api/v1/events`. См. раздел 11.

### 3.8 Компрометация внешнего image/CDN
- `imageUrl` из скрейпленных данных рендерится сырым `<img src>` без allowlist и без CSP `img-src`. Отравленная строка каталога → браузер каждого зрителя стучится на хост атакующего (утечка IP/UA, трекинг-пиксель, mixed-content). Не XSS (img не исполняет JS), но неконтролируемый outbound у всех клиентов.

### 3.9 Компрометация сервера / утечка .env / DATABASE_URL
- Один VPS — SPOF. `.env` не в git (хорошо), но слабые дефолты `POSTGRES_PASSWORD=skinly`, `AUTH_SECRET` пустой по умолчанию. Утечка `AUTH_SECRET` = форж любых сессий (нет ротации ключей/`kid`). Утечка `DATABASE_URL` = вся PII. Нет бэкапов/restore-процедуры и нет централизованного логирования/алертов — компрометацию нечем детектировать.

---

## 4. Архитектурные риски

| Риск | Статус | Комментарий |
|---|---|---|
| Монолитность Next.js | Приемлемо на старте | Один процесс = auth+API+SSR+рекомендации. Простой blast radius, но и SPOF на уровне приложения. |
| Rate limit | **Отсутствует** | Ни прокси, ни приложение. Ключевой пробел. |
| Единая БД | Приемлемо | Нормально до заметного масштаба; нет реплики для чтения. |
| Очереди | Отсутствуют | Нет фоновой обработки; тяжёлое (скрейп/нормализация) — offline-скрипты, ОК. |
| WAF / CDN | **Отсутствует** | Нет фильтрации L7, нет absorb для DDoS. |
| Object storage для картинок | Отсутствует | Зависимость от внешних URL (см. 3.8). |
| Зависимость от внешних image URL | **Риск** | Нет allowlist, нет проксирования/кэша, нет контроля доступности. |
| Фоновые воркеры | Отсутствуют | Не критично сейчас. |
| Централизованное логирование | **Отсутствует** | Только `docker compose logs`. |
| Алерты | **Отсутствуют** | Инциденты незаметны. |
| Бэкапы + restore | **Отсутствуют** | `pg_dump`/WAL не настроены; данные в named volume. Риск полной потери. |
| Нехватка диска | Не контролируется | Рост `ScanHistory`/`UserProductEvent` (insert-флуд) + логи → заполнение диска. |
| Один VPS = SPOF | **Да** | Нет HA, нет failover. |

---

## 5. Находки

Формат каждой находки: **Severity · Описание · Почему опасно · Эксплуатация · Вероятность · Влияние · Исправление · Сложность фикса**.

---

### 🔴 CRITICAL

#### C-1. Полное отсутствие rate limiting / lockout на аутентификации
- **Описание.** Ни на Caddy, ни в приложении нет throttle/lockout/CAPTCHA. Код `rate_limited` объявлен (`lib/api/respond.ts:48`), но нигде не эмитится. Затрагивает `POST /api/v1/auth/{login,register,refresh}`, web `loginAction`/`registerAction`, `POST /reviews`, `POST /events`.
- **Почему опасно.** Это единственный барьер против самой массовой реальной атаки на публичный сервис — credential stuffing / password spraying / спам-регистраций.
- **Эксплуатация.** Скрипт гонит тысячи `login` на утёкших парах email:pароль; параллельно фермит аккаунты через `register`. bcrypt cost 10 только замедляет, не останавливает (и одновременно превращается в CPU-DoS, см. C-2/раздел 11).
- **Вероятность:** очень высокая (автоматизируется в первый день после публикации).
- **Влияние:** массовый аккаунт-тейковер + деградация/отказ сервиса + мусорные аккаунты.
- **Исправление.** Per-IP + per-account token bucket (Redis/Upstash) на `/api/v1/auth/*` и auth-actions; прогрессивный lockout после N неудач; CAPTCHA при аномалиях; отдать существующий `429 rate_limited`. Дополнительно — `rate_limit` на Caddy для auth-путей.
- **Сложность:** Средняя.

#### C-2. Web-контейнер опубликован в интернет по plaintext (`0.0.0.0:3000`), обход Caddy/TLS
- **Описание.** `docker-compose.yml:72-73` → `ports: ["3000:3000"]` биндит на все интерфейсы, хотя дизайн предполагает `127.0.0.1` за Caddy (README, комментарий `docker-compose.yml:6`).
- **Почему опасно.** `http://<server-ip>:3000/login` доступен всем по HTTP: обход TLS, HSTS и любых прокси-контролей; cookie с `secure:true` не отправляется, но приложение отдаёт формы логина/регистрации по cleartext.
- **Эксплуатация.** Сетевой наблюдатель/провайдер/Wi-Fi-MITM снимает креды в открытом виде; сканеры (Shodan/массовые) сразу находят открытый порт.
- **Вероятность:** высокая (порт индексируется автоматически).
- **Влияние:** перехват учётных данных, обход всей периметровой защиты.
- **Исправление.** `- "127.0.0.1:3000:3000"` или `expose: ["3000"]` + Caddy в той же docker-сети. Убедиться, что фаервол VPS закрывает 3000 снаружи.
- **Сложность:** Низкая (одна строка + firewall).

> Обе Critical — не «баги в коде», а отсутствующие/неверные production-контроли. Для «релиз завтра» именно они — реальные, тривиально эксплуатируемые и высокоимпактные.

---

### 🟠 HIGH

#### H-1. Захардкоженный dev-fallback JWT-секрет, защита только через `NODE_ENV`
- **Описание.** `DEV_FALLBACK_SECRET = "dev-only-skinly-secret-change-me-please-32chars-min"` продублирован в `lib/auth/session.ts:22` и `lib/auth/tokens.ts:33`. Прод-гард срабатывает только при `NODE_ENV === "production"`.
- **Почему опасно.** Любой деплой без явного `NODE_ENV=production` (staging, preview, `next start` без env, кривой PaaS) молча подписывает все сессии публично известной строкой из репозитория.
- **Эксплуатация.** Атакующий подписывает `{type:"user",userId:"<cuid>",email}` этим секретом (HS256) → валидная сессия → тейковер любого пользователя по cuid.
- **Вероятность:** средняя (документированный Docker-путь падает при пустом `AUTH_SECRET` — fail-closed, это плюс; риск на нестандартных деплоях).
- **Влияние:** полный аккаунт-тейковер, форж произвольных сессий.
- **Исправление.** Убрать fallback совсем; требовать `AUTH_SECRET` (≥32 байт) во всех окружениях, бросать на старте независимо от `NODE_ENV`; вынести резолвинг секрета в один модуль; pre-commit secret-scanning.
- **Сложность:** Низкая.

#### H-2. Нет серверного отзыва сессий; logout = только очистка cookie; украденный/refresh-токен живёт 30 дней
- **Описание.** `logoutAction` (`app/actions/auth.ts:118`) только `clearSessionCookie()`. Нет `jti`/`tokenVersion`/blocklist. `/api/v1/auth/refresh` бесконечно продлевает без reuse-detection. Middleware не ходит в БД, поэтому даже удалённый пользователь проходит проверку до истечения токена.
- **Почему опасно.** Украденный токен нельзя погасить; «выйти со всех устройств», отзыв при смене пароля — невозможны.
- **Эксплуатация.** Любой утёкший токен (шаринг устройства, лог, копия cookie, утечка refresh на мобиле) = доступ до 30 дней даже после logout.
- **Вероятность:** средняя. **Влияние:** длительный несанкционированный доступ.
- **Исправление.** Серверное состояние сессий: таблица `Session` с `jti` и отзывом, **или** `tokenVersion` в `User`, сверяемый при verify; инкремент при logout/смене пароля/удалении; для refresh — ротация с reuse-detection.
- **Сложность:** Средняя.

#### H-3. Нет никаких security-заголовков и CSP
- **Описание.** `next.config.ts` без `headers()` и `poweredByHeader:false`; middleware заголовки не ставит; committed Caddyfile отсутствует (в README — голый `reverse_proxy`). Нет CSP, HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Течёт `X-Powered-By: Next.js`.
- **Почему опасно.** Нет defense-in-depth против XSS (любая будущая инъекция → полноценный XSS); clickjacking авторизованного дашборда/скана; MIME-sniffing; камера/гео не ограничены Permissions-Policy; без HSTS возможен SSL-strip (усиливает C-2).
- **Эксплуатация.** iframe-обёртка дашборда для clickjacking; фингерпринт стека; при найденной инъекции — эксфильтрация без CSP-преграды.
- **Вероятность:** средняя. **Влияние:** от clickjacking до эскалации любой XSS.
- **Исправление.** `headers()` в `next.config.ts` (строгий CSP: `default-src 'self'`, явный `img-src` allowlist, `frame-ancestors 'none'`) + HSTS/nosniff/Referrer-Policy/Permissions-Policy; `poweredByHeader:false`; продублировать на Caddy.
- **Сложность:** Низкая–средняя (настроить CSP под inline-стили Next/Tailwind).

#### H-4. Нет верификации email и нет password reset
- **Описание.** В `User` (`schema.prisma`) нет `emailVerified` и полей reset-токена; соответствующих маршрутов/писем нет.
- **Почему опасно.** Регистрация на чужой email (импертонация, спам); нет восстановления → пользователи ставят слабые/переиспользуемые пароли; усиливает enumeration (H-6).
- **Эксплуатация.** Массовая регистрация на произвольные адреса; невозможность легитимного восстановления.
- **Вероятность:** высокая (абьюз), **влияние:** среднее.
- **Исправление.** Email-верификация при регистрации; подписанный одноразовый короткоживущий reset-токен (хранить хэш+expiry), инвалидация сессий при сбросе (связать с H-2).
- **Сложность:** Средняя.

#### H-5. Слабые дефолтные креды БД в compose и `DATABASE_URL`
- **Описание.** `POSTGRES_PASSWORD:-skinly`, `POSTGRES_USER:-skinly`; `DATABASE_URL` собирается из тех же дефолтов; `.env.example` содержит `skinly:skinly`.
- **Почему опасно.** Если оператор не выставил пароль — БД поднимается с `skinly:skinly`. При любой достижимости Postgres (будущий port-publish, соседний сервис в docker-сети, escape) — тривиальный доступ ко всей PII и хэшам.
- **Эксплуатация.** Подбор `skinly:skinly` при появлении сетевого пути к 5432.
- **Вероятность:** низкая-средняя (в prod 5432 не опубликован — смягчает), **влияние:** высокое (вся БД).
- **Исправление.** `${POSTGRES_PASSWORD:?required}` (compose падает без сильного секрета); `.env.example` с пустым плейсхолдером и `openssl rand`.
- **Сложность:** Низкая.

---

### 🟡 MEDIUM

#### M-1. Token-type confusion: Bearer-токены принимаются как web-cookie
- **Описание.** `signAccessToken`/`signRefreshToken` (`lib/auth/tokens.ts`) подписывают ту же payload тем же `AUTH_SECRET`, отличаясь лишь claim `tokenType`; `verifySession` его не проверяет.
- **Эксплуатация.** Refresh-токен (30 дней) подставляется в cookie `skinly_session` и принимается как полноценная web-сессия — обходит замысел короткого access.
- **Вероятность:** средняя. **Влияние:** удлинение окна украденного токена. **Фикс:** `verifySession` отвергает токены с `tokenType`, либо ввести `aud` (`web-cookie` vs `mobile-access`) и проверять. **Сложность:** Низкая.

#### M-2. Mass assignment: клиент может задать `userId` строки через object-spread
- **Описание.** `beauty-profile.ts:33` `create: { userId, ...input }` и `migration.ts:96` — `...input`/`...payload.skinProfile` после `userId` перезаписывают его; поля `id/createdAt` тоже. `upsertBeautyProfileAction` валидирует только `completion`.
- **Эксплуатация.** Аутентифицированный клиент шлёт `{...profile, userId:"<victimCuid>"}` → строка создаётся от имени жертвы (ограничено непубличностью cuid; `@@unique(userId)` отбивает, если профиль жертвы уже есть).
- **Вероятность:** низкая (нужен чужой внутренний id, он не светится в API). **Влияние:** нарушение изоляции арендаторов на запись. **Фикс:** не спредить недоверенный ввод — собирать явный whitelist полей (как уже сделано в `lib/api/mappers.ts` для мобильного PUT). **Сложность:** Низкая.

#### M-3. Флаг `secure` у cookie завязан на `NODE_ENV`
- **Описание.** `lib/auth/server.ts` — `secure: NODE_ENV === "production"`. Та же хрупкость, что H-1: любое не-prod окружение отдаёт сессию по HTTP. **Фикс:** `secure:true` безусловно (dev-исключение через явный флаг), рассмотреть префикс `__Host-`. **Сложность:** Низкая.

#### M-4. Слабая парольная политика; bcrypt обрезает >72 байт
- **Описание.** Только `length >= 8` при регистрации, без верхней границы и сложности. bcryptjs молча режет ввод до 72 байт. **Фикс:** min 8–12 + проверка HIBP/zxcvbn, отказ >72 байт (или pre-hash SHA-256), поднять cost до 12 или перейти на argon2id. **Сложность:** Низкая.

#### M-5. Enumeration email при регистрации
- **Описание.** `register` отдаёт `409 email_taken`, что подтверждает существование аккаунта (login при этом корректно uniform). **Фикс:** generic-ответ + email-верификация, либо спрятать за rate limit. **Сложность:** Низкая.

#### M-6. Timing-oracle на login
- **Описание.** `authenticateUser` не запускает bcrypt, если пользователь не найден → «существует» отвечает медленнее. **Фикс:** всегда сравнивать с dummy-хэшем при отсутствии пользователя. **Сложность:** Низкая.

#### M-7. Нет hardening контейнеров
- **Описание.** Ни у одного сервиса нет `security_opt:[no-new-privileges:true]`, `cap_drop:[ALL]`, `read_only`. **Фикс:** добавить эти директивы; для web — `read_only:true` + tmpfs. (web уже non-root uid 1001 — плюс.) **Сложность:** Низкая.

#### M-8. Нет healthcheck у web; нет бэкапов/мониторинга/алертов/логирования
- **Описание.** У `web` только `restart`, без `healthcheck`; `pg_dump`/WAL/restore-runbook, log-shipping, uptime/error-мониторинг отсутствуют. **Фикс:** `/api/health` + healthcheck; scheduled `pg_dump` с off-host retention + документированный restore; сбор логов и базовые алерты. **Сложность:** Средняя.

#### M-9. Mobile: нет certificate pinning
- **Описание.** `ky`/fetch на системном CA-trust; передаются креды и PII. На устройстве с вредоносным/корпоративным root-CA — MITM. **Фикс:** pinning (react-native-ssl-pinning / Expo config plugin: Android network-security-config + iOS pinning). **Сложность:** Средняя.

#### M-10. Mobile: лишнее разрешение `RECORD_AUDIO`
- **Описание.** `app.json` объявляет `android.permission.RECORD_AUDIO`, хотя сканер использует только камеру. **Почему важно:** приватность + вероятный блокер ревью Google Play. **Фикс:** удалить разрешение. **Сложность:** Тривиальная.

---

### 🟢 LOW

- **L-1. Wildcard CORS на всём `/api/v1`** (`respond.ts:15`), включая auth и `DELETE /me`. Bearer не шлётся автоматически (не классический CSRF), но любой сайт может дёргать API. **Фикс:** scoped origin; `*` оставить только на GET-каталоге. *(Средняя важность на будущее, если появятся cookie-эндпоинты под /api.)*
- **L-2. Внешние `<img>` без allowlist** — poisoned `imageUrl` → beacon у всех зрителей. **Фикс:** валидировать `https://` + allowlist CDN, вернуть `next/image` с `remotePatterns`, CSP `img-src`.
- **L-3. Spoofable `X-Anon-Id`** (`events/route.ts:54`) — подделка/флуд событий, порча рекомендаций. **Фикс:** подписанный device-token + per-subject квоты.
- **L-4. Review sybil** — при бесконтрольной регистрации фермы аккаунтов накручивают `avgRating`; отображаемое имя не модерируется (импертонация бренда). **Фикс:** rate limit + верификация + review только после scan/purchase.
- **L-5. Неограниченные массивы** (`getProductsByIdsAction`, миграция) → большие `IN (...)`/`createMany`. **Фикс:** cap длины (напр. ≤500).
- **L-6. Mobile: нет strip console в проде** (`babel.config.js` без `transform-remove-console`) — метаданные запросов утекают в logcat/Console. **Фикс:** `transform-remove-console` (кроме error/warn), убрать `[DIAG]`-логи токенов.
- **L-7. Mobile: guest beauty-profile/история в НЕзашифрованном MMKV** (`src/lib/mmkv.ts`) — «secure»-инстанс только в комментарии. Health-adjacent PII читается на rooted-устройстве/из бэкапа. **Фикс:** `encryptionKey` из SecureStore.
- **L-8. Deep links только по кастомной схеме** `skinly://` без verified App/Universal Links — сквоттинг перехватывает ссылки (сейчас без токенов — низко). **Фикс:** associatedDomains/autoVerify до появления auth-ссылок.

---

### ⚪ INFO / положительное

**Info-находки:** нет OAuth/Apple/Google (Apple потребует Sign in with Apple, если появится соц-логин); прототип `index.html` в корне использует `innerHTML` (Next его не отдаёт, но лежит в репо); мёртвая ветка `products/by-barcode/${barcode}` без валидации на мобиле; bcrypt cost 10; нет `iss`/`aud`/`kid` и ротации ключей.

**Проверено и признано корректным (evidence-backed):**
- **IDOR не найден** — все пути к пользовательским данным (favorites, scans, beauty-profile, reviews, stats, delete-account) скоупятся по `session.userId`; клиентский `userId` для выбора объекта нигде не принимается.
- **SQL-инъекций в рантайме нет** — весь raw-SQL через `Prisma.sql`; ручной escaper в `product.ts` корректен; `$queryRawUnsafe` только в offline-скриптах (недостижимы по HTTP).
- **Ошибки не текут** — нет stack traces/Prisma-ошибок клиенту; `passwordHash`/email не отдаются в DTO.
- **Валидация** — email regex+длина, enum через `toDbEnum`/`VALID_CATEGORIES` (невалидные дропаются), rating 1..5, barcode `/^\d{8,14}$/`, caps на metadata/пагинацию (`MAX_LIMIT=50`), server-authoritative веса событий.
- **Middleware** проверяет подпись JWT (не только наличие cookie), pinned alg, Edge без БД.
- **Docker:** web non-root (uid 1001), multi-stage standalone, docker.sock нигде не смонтирован, prod-Postgres не опубликован, tools за profile, секреты только env (не build-args), `.env` в `.gitignore`.
- **Next 15.5.15** пропатчен (не подвержен CVE-2025-29927 middleware bypass); prisma 6.19, jose 5.10, bcryptjs 3.0 — актуальны. `xlsx@0.18.5` уязвим (CVE-2023-30533/2024-22363), но только devDependency в offline-tools, в рантайм-образ не попадает.
- **Mobile:** токены в SecureStore (Keychain/Keystore), single-flight refresh с ротацией и auto-logout, баркод валидируется, нет хардкод-секретов, нет диск-персиста authenticated-ответов.

---

## 6. Итоговая таблица

| Severity | Кол-во | Находки |
|---|---|---|
| 🔴 **Critical** | 2 | C-1 rate limiting; C-2 plaintext :3000 |
| 🟠 **High** | 5 | H-1 fallback-секрет; H-2 нет отзыва сессий; H-3 нет headers/CSP; H-4 нет verify/reset; H-5 слабые дефолты БД |
| 🟡 **Medium** | 10 | M-1…M-10 (token confusion, mass-assign, secure-flag, парольная политика, enum, timing, hardening, backups/health, cert-pinning, RECORD_AUDIO) |
| 🟢 **Low** | 8 | L-1…L-8 |
| ⚪ **Info** | 5 | OAuth, index.html, dead path, bcrypt cost, key rotation |

### Общая оценка безопасности: **5 / 10**

Обоснование: **сильный код** (нет IDOR, нет SQLi, аккуратный скоуп, безопасное хранение токенов на мобиле, свежие зависимости) при **слабой платформенной безопасности** (нет rate limit, нет отзыва сессий, нет security-заголовков, plaintext-порт наружу, нет верификации email, нет бэкапов/мониторинга). Для закрытой беты — 6–7. Для публичного релиза на 100k — сейчас 5, лимитируется двумя Critical и пятью High.

---

## 7. Roadmap исправлений

### В течение 1 недели (блокеры релиза — все Critical + быстрые High)
- C-2: убрать `0.0.0.0:3000`, закрыть порт фаерволом (1 строка).
- H-1: убрать fallback-секрет, требовать `AUTH_SECRET` везде.
- H-5: `${POSTGRES_PASSWORD:?required}`, чистый `.env.example`.
- H-3: security-заголовки + CSP + `poweredByHeader:false` + реальный Caddyfile.
- C-1 (первая итерация): базовый per-IP rate limit на `/api/v1/auth/*` (edge/Caddy), пока хотя бы грубый.
- M-2: убрать object-spread, whitelist полей.
- M-3: `secure:true` безусловно.
- M-10: удалить `RECORD_AUDIO`.

### В течение 1 месяца
- C-1 (полноценно): Redis token-bucket per-IP+account, lockout, CAPTCHA, `429`.
- H-2: серверный отзыв (`tokenVersion`/`Session`+`jti`), реальный logout, refresh-rotation с reuse-detection.
- H-4: email-верификация + password reset (инвалидация сессий при сбросе).
- M-1: `aud`/`tokenType`-проверка в `verifySession`.
- M-4/M-5/M-6: парольная политика, generic-register, dummy-bcrypt на timing.
- M-8: healthcheck + `pg_dump`-бэкапы + restore-runbook + базовый мониторинг/алерты.
- M-7: hardening контейнеров.
- L-2: allowlist/проксирование внешних картинок + CSP `img-src`.

### В течение 3 месяцев
- M-9: certificate pinning на мобиле.
- L-1/L-3/L-4/L-5: scoped CORS, подписанные anon-события + квоты, anti-sybil для reviews, caps на массивы.
- L-6/L-7: strip console в проде, шифрование MMKV.
- Ротация ключей (`kid`, dual-key), `iss`/`aud`.
- WAF/CDN (Cloudflare) перед сервером; read-replica при росте; object storage для изображений.
- Централизованное логирование + алертинг + дашборды; план на второй VPS/HA.

---

## 8. Architecture Security Roadmap (P0–P3)

**P0 — срочно (до включения публичного трафика):**
- Закрыть web-порт от интернета (только Caddy) — C-2.
- Требовать сильный `AUTH_SECRET` и `POSTGRES_PASSWORD`, убрать fallback/слабые дефолты — H-1, H-5.
- Базовый rate limit на auth — C-1(v1).

**P1 — до релиза:**
- Security-заголовки + CSP + HSTS — H-3.
- Полноценный rate limit + lockout — C-1(v2).
- Серверный отзыв сессий + реальный logout — H-2.
- Email-верификация + password reset — H-4.
- Whitelist полей записи (mass-assign) — M-2; `secure:true` — M-3; убрать RECORD_AUDIO — M-10.
- Бэкапы Postgres + restore-runbook — M-8.

**P2 — после релиза:**
- Token audience/`tokenType`-enforcement — M-1; парольная политика/timing/enum — M-4/5/6.
- Hardening контейнеров, healthcheck, мониторинг/алерты — M-7/M-8.
- Cert pinning, strip console, шифрование MMKV — M-9/L-6/L-7.
- Allowlist картинок + CSP img-src — L-2; scoped CORS — L-1.

**P3 — масштабирование (10k → 100k):**
- WAF/CDN (Cloudflare) как absorb/фильтр L7 + rate limit на краю.
- Read-replica Postgres, PgBouncer/пул соединений, индексы под тяжёлые запросы.
- Object storage + image-proxy/CDN для картинок каталога, отказ от прямых внешних URL.
- Очередь для фоновой обработки; централизованные логи/трейсинг; SLO/алертинг.
- HA: второй VPS/managed-Postgres, устранение SPOF; ключевая ротация с `kid`.

---

## 9. «Если бы Skinly завтра вышел в App Store и получил 100 000 пользователей — какие реальные атаки наиболее вероятны и что чинить в первую очередь?»

**Наиболее вероятные реальные атаки (в порядке ожидаемости):**

1. **Credential stuffing / password spraying** по `/api/v1/auth/login`. При аудитории 100k утёкшие базы паролей гарантированно дадут совпадения, а защиты — ноль (C-1). Это атака №1 по вероятности и по ущербу (массовый тейковер).
2. **Спам-регистрации и фейковые аккаунты** (H-4 + C-1): фермы аккаунтов, накрутка/подделка рейтингов (L-4), мусор в БД, рост диска.
3. **L7-DDoS дешёвыми запросами**: `login` (bcrypt = CPU на каждый запрос), поиск/каталог (нагрузка на единственный Postgres), insert-флуд `/api/v1/events`. Без WAF/rate limit/CDN один VPS ложится дёшево (раздел 11 threat-модели).
4. **Перехват учётных данных** через открытый `http://<ip>:3000` (C-2) — особенно на публичных сетях; плюс отсутствие HSTS (H-3) облегчает SSL-strip.
5. **Долгоживущий доступ по украденному токену** (H-2): при 100k пользователях доля скомпрометированных устройств/токенов ненулевая, а отозвать нельзя 30 дней.
6. **MITM на мобиле** (M-9) на устройствах с вредоносным CA — перехват токенов и beauty-PII.
7. **Потеря данных без бэкапа** (M-8): один сбой volume/VPS = невосстановимая потеря БД пользователей — репутационно критично на масштабе.

**Что чинить в первую очередь (строго по порядку):**

1. **Rate limiting + lockout на auth** (C-1) — закрывает атаки №1, №2 и половину №3.
2. **Закрыть web-порт, только Caddy + TLS/HSTS** (C-2, H-3) — убирает №4.
3. **Сильные секреты, убрать fallback/слабые дефолты** (H-1, H-5) — убирает форж сессий и лёгкий доступ к БД.
4. **Серверный отзыв сессий + email-верификация/reset** (H-2, H-4) — убирает №5 и абьюз регистраций.
5. **Бэкапы Postgres + restore** (M-8) — страховка от №7.
6. **Перед масштабированием — WAF/CDN (Cloudflare) и пул соединений/read-replica** — устойчивость к №3 на 100k.

**Вывод.** Skinly не «дырявый» на уровне кода — наоборот, авторизационное ядро сделано грамотно. Он **не защищён на уровне платформы**: сломать его при публичном релизе будет легко, но не через хитрые эксплойты, а через тривиальную автоматизацию (стаффинг, спам, DoS) там, где просто нет защитного слоя. Две Critical и пять High полностью закрываются за 1–4 недели без переписывания архитектуры — после этого проект переходит из «5/10, релизить рано» в «7–8/10, можно в паблик».
