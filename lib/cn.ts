/**
 * Минимальный zero-dep helper для склейки className-ов.
 * Поддерживает строки, falsy-значения и вложенные массивы.
 *
 * Если в проекте появятся реальные коллизии utility-классов —
 * заменим на clsx + tailwind-merge.
 */

export type ClassValue =
  | string
  | number
  | undefined
  | null
  | false
  | 0
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === "string" || typeof input === "number") {
      out.push(String(input));
      continue;
    }

    if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) out.push(nested);
    }
  }

  return out.join(" ");
}
