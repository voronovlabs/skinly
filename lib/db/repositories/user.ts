import { prisma } from "@/lib/prisma";

/**
 * User repository. Минимум, что нужно для server-rendered экранов и для
 * preferences (locale). Регистрация / login пишут через `app/actions/auth.ts`.
 */

export async function getUserById(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function updateUserLocale(
  userId: string,
  locale: "ru" | "en",
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { locale },
  });
}

export async function updateUserName(
  userId: string,
  name: string | null,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { name },
  });
}
