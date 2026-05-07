# syntax=docker/dockerfile:1.7

# =============================================================================
# Skinly — production multi-stage Dockerfile
# Использует output: "standalone" для минимального финального образа.
# =============================================================================

# --- Stage 1: deps — устанавливаем зависимости отдельно для лучшего кэша ---
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json* ./
# Если lockfile есть — используем npm ci, иначе fallback на install (актуально на Phase 0).
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi


# --- Stage 2: builder — генерируем Prisma клиент и собираем Next ---
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma клиент должен быть сгенерирован до next build (RSC может его импортировать)
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
