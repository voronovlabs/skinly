"use server";

/**
 * Product lookup actions.
 *
 * "use server" → экспортируем ТОЛЬКО async-функции (правило Next 15).
 * Никаких типов/констант здесь — типы инлайнятся, потребители импортят
 * только функцию.
 */

import { prisma } from "@/lib/prisma";

const BARCODE_RE = /^\d{8,14}$/;

/**
 * Возвращает компактный ответ: найден ли продукт по barcode.
 * Не бросает на DB-ошибках — для скрытия ошибок в UI клиент
 * получит `{ found: false, reason: "db_unavailable" }` и предложит
 * ручной ввод / "попробовать снова".
 */
export async function getProductByBarcodeAction(
  barcode: string,
): Promise<
  | { found: true; productId: string; barcode: string }
  | { found: false; reason: "invalid" | "not_found" | "db_unavailable" }
> {
  const trimmed = (barcode ?? "").trim();
  if (!BARCODE_RE.test(trimmed)) {
    return { found: false, reason: "invalid" };
  }

  try {
    const p = await prisma.product.findUnique({
      where: { barcode: trimmed },
      select: { id: true, barcode: true },
    });
    if (!p) return { found: false, reason: "not_found" };
    return { found: true, productId: p.id, barcode: p.barcode };
  } catch (e) {
    console.error("[actions/products] lookup error:", e);
    return { found: false, reason: "db_unavailable" };
  }
}
