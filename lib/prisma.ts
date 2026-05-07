import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * В dev-режиме Next.js делает hot-reload и каждый раз пересоздаёт модули,
 * что приводит к утечкам соединений с БД. Кэшируем клиент на globalThis.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
