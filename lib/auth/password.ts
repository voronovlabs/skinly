import bcrypt from "bcryptjs";

/**
 * Bcrypt-обёртки. Раундов 10 — стандарт для bcryptjs (≈ 100 ms на ноутбуке,
 * можно поднять до 12 в проде, если CPU позволяет).
 */

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return await bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return await bcrypt.compare(plain, hash);
}
