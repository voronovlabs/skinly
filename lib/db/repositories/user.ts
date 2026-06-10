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

/**
 * Полностью удаляет пользователя (App Store Guideline 5.1.1 — account deletion).
 *
 * Связанные записи удаляются КАСКАДОМ на уровне БД — FK с `ON DELETE CASCADE`
 * (см. миграции `phase6_domain` / `hair_profile`):
 *   - BeautyProfile (1:1)
 *   - HairProfile   (1:1)
 *   - Favorite      (N)
 *   - ScanHistory   (N)
 * Поэтому достаточно одного `user.delete`, ручная транзакция не нужна.
 *
 * Идемпотентно: если пользователя уже нет (Prisma `P2025`), возвращает `false`
 * вместо throw — вызывающий код трактует это как успешное удаление.
 *
 * @returns `true` если запись была удалена, `false` если её уже не было.
 */
export async function deleteUserById(userId: string): Promise<boolean> {
  try {
    await prisma.user.delete({ where: { id: userId } });
    return true;
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "P2025"
    ) {
      return false;
    }
    throw e;
  }
}
