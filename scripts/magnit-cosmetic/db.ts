/**
 * Запись в Prisma `Product` с дедупликацией и merge-защитой.
 *
 * Ключ дедупликации: `source + externalId`. Составного unique-индекса в
 * схеме нет (и мы её не меняем) — ищем через findFirst; есть
 * дополнительная страховка по unique(barcode).
 *
 * ⚠ Рекомендация на будущее (отдельной миграцией):
 *   @@unique([source, externalId]) на Product — сделает upsert атомарным.
 *
 * Merge-правила при update (newValue ?? existing, пустые строки = отсутствие):
 *   - barcode существующей записи НИКОГДА не перезаписывается (там может
 *     быть настоящий EAN, добавленный этапом 2 или другим источником);
 *   - descriptionEn никогда не трогаем;
 *   - изображения: при импорте imageUrl = sourceImageUrl = исходный URL
 *     Магнит Косметик. Если imageUrl уже локализован (внутренний URL
 *     /product-images/ после migrate-product-images) — пару не трогаем;
 *     sourceImageUrl никогда не обнуляется;
 *   - id / createdAt не меняются; updatedAt — @updatedAt Prisma.
 */

import { PrismaClient } from "@prisma/client";
import { BARCODE_PREFIX } from "./config";
import type { NormalizedMagnitProduct, UpsertResult } from "./types";
import { ts } from "./logger";

let prismaClient: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({ log: ["error", "warn"] });
  }
  return prismaClient;
}

export async function closeDb(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

function present(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function upsertProduct(
  p: NormalizedMagnitProduct,
  opts: { force?: boolean; client?: PrismaClient } = {},
): Promise<UpsertResult> {
  const prisma = opts.client ?? getPrisma();

  // 1) основной ключ: source + externalId
  let existing = await prisma.product.findFirst({
    where: { source: p.source, externalId: p.externalId },
  });

  // 2) страховка: тот же barcode мог быть создан ранее (unique-коллизия)
  if (!existing) {
    existing =
      (await prisma.product.findUnique({ where: { barcode: p.barcode } })) ?? null;
    if (existing) {
      ts(
        `product ${p.externalId}: found by barcode ${p.barcode} (source=${existing.source}) — updating in place`,
      );
    }
  }

  if (!existing) {
    await prisma.product.create({
      data: {
        barcode: p.barcode,
        brand: p.brand,
        name: p.name,
        category: p.category,
        emoji: p.emoji,
        imageUrl: p.imageUrl,
        // исходный URL Магнит Косметик — сохраняем сразу в оба поля;
        // локализация потом заменит только imageUrl
        sourceImageUrl: p.sourceImageUrl,
        descriptionRu: p.descriptionRu,
        // descriptionEn не задаём — остаётся null
        source: p.source,
        externalId: p.externalId,
      },
    });
    return "created";
  }

  /* ── merge: только валидные новые значения, пустое не затирает хорошее ── */
  const data: Record<string, unknown> = {};

  if (present(p.name) && p.name !== existing.name) data.name = p.name;

  // Unknown не затирает известный бренд
  if (present(p.brand) && p.brand !== "Unknown" && p.brand !== existing.brand) {
    data.brand = p.brand;
  } else if (p.brand === "Unknown" && !present(existing.brand)) {
    data.brand = "Unknown";
  }

  // OTHER не понижает более специфичную категорию (если не --force)
  if (p.category !== existing.category && (p.category !== "OTHER" || opts.force)) {
    data.category = p.category;
  }

  if (p.emoji && !existing.emoji) data.emoji = p.emoji;

  // Изображения. Локализованный imageUrl (внутренний URL хранилища после
  // migrate-product-images) не трогаем; пустым ничего не затираем.
  const imageLocalized =
    present(existing.imageUrl) &&
    (existing.imageUrl.startsWith("/") ||
      existing.imageUrl.includes("/product-images/"));
  if (present(p.imageUrl)) {
    if (!imageLocalized && p.imageUrl !== existing.imageUrl) {
      data.imageUrl = p.imageUrl;
    }
    // sourceImageUrl: заполняем пустой всегда; при не-локализованной картинке
    // держим синхронным с новым исходным URL. Никогда не обнуляем.
    if (!present(existing.sourceImageUrl)) {
      data.sourceImageUrl = p.imageUrl;
    } else if (!imageLocalized && p.imageUrl !== existing.sourceImageUrl) {
      data.sourceImageUrl = p.imageUrl;
    }
  }

  if (present(p.descriptionRu) && p.descriptionRu !== existing.descriptionRu) {
    data.descriptionRu = p.descriptionRu;
  }

  // фиксируем принадлежность источнику (запись могла быть найдена по barcode)
  if (existing.source !== p.source) data.source = p.source;
  if (existing.externalId !== p.externalId) data.externalId = p.externalId;

  // Единственное разрешённое изменение barcode: апгрейд технического
  // `mc:<externalId>` до настоящего EAN (этап 4 → 5). Настоящий barcode
  // существующей записи по-прежнему НИКОГДА не перезаписывается. Перед
  // апгрейдом проверяем unique(barcode)-коллизию с другим товаром.
  if (
    present(p.barcode) &&
    !p.barcode.startsWith(BARCODE_PREFIX) &&
    existing.barcode.startsWith(BARCODE_PREFIX) &&
    p.barcode !== existing.barcode
  ) {
    const clash = await prisma.product.findUnique({ where: { barcode: p.barcode } });
    if (!clash) {
      data.barcode = p.barcode;
      ts(`product ${p.externalId}: barcode upgrade ${existing.barcode} → ${p.barcode}`);
    } else {
      ts(`product ${p.externalId}: EAN ${p.barcode} уже занят (product id=${clash.id}) — barcode не меняю`);
    }
  }

  // настоящий barcode / descriptionEn / id / createdAt — не трогаем никогда

  if (Object.keys(data).length === 0) return "unchanged";

  await prisma.product.update({ where: { id: existing.id }, data });
  return "updated";
}
