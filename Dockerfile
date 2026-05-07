# syntax=docker/dockerfile:1.7

# =============================================================================
# Skinly — production multi-stage Dockerfile
# Использует output: "standalone" для минимального финального образа.
# =============================================================================

# --- Stage 1: deps ---
#
# Устанавливаем зависимости отдельным слоем для кэша.
#
# ВАЖНО: package.json содержит `"postinstall": "prisma generate"`.
# Поэтому ДО `npm ci` обязательно копируем `prisma/` — иначе postinstall
# падает с "Could not find Prisma Schema". Локальный `npm install` это не
# трогает (prisma/ всегда лежит в репо), а layer-кэш почти не страдает:
# `prisma/schema.prisma` меняется реже, чем код, и почти всегда вместе с
# package.json (новые модели = новые миграции).
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# Если lockfile есть — используем npm ci, иначе fallback на install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi


# --- Stage 2: builder — собираем Next ---
#
# Prisma client уже сгенерирован postinstall'ом в deps. Запускаем `prisma
# generate` ещё раз — идемпотентно и спасает, если кто-то поменял схему
# после первого install'а в long-running CI.
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


# --- Stage 3: runner — финальный минимальный образ ---
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone server и статика
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma engines + сгенерированный клиент нужны в рантайме
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
