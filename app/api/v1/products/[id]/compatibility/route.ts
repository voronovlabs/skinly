import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  emptyProfile,
  summaryProfileToEngine,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import { resolveCompatibility } from "@/lib/compatibility/resolve-compatibility";
import {
  formatRuleHits,
  type FormattedReason,
} from "@/lib/compatibility/format-reasons";
import {
  compatCacheGet,
  compatCacheKey,
  compatCacheSet,
  profileFingerprint,
} from "@/lib/compatibility/compat-cache";
import { createCompatTimer } from "@/lib/compatibility/timing";
import { apiError, apiJson, apiPreflight } from "@/lib/api/respond";

/**
 * GET /api/v1/products/:idOrBarcode/compatibility
 *
 * Точечная «подходимость» ОДНОГО товара для mobile-карточки.
 *
 * Замена мобильного обходного пути через `GET /products?forMe=1&q=<barcode>`
 * (perf-расследование 2026-07-11: тот путь выполнял searchProducts — Seq Scan
 * по 63k строк, p50 ~2.5 s — ради совместимости одного товара). Здесь только:
 *   findUnique(id → barcode, лёгкий select) →
 *   resolveCompatibility (DM getDmCompatibilityInput(1 barcode) с fallback
 *   на legacy inciToFact) → форматирование reasons → DTO.
 *
 * Каталожный поиск (/products) и рекомендации (/recommendations) не трогаем.
 *
 * Query-профиль — как у /products (forMe) и /recommendations:
 *   skinType, sensitivity, goal — строки; concerns, avoided — CSV.
 * Локаль текстов reasons — accept-language (ru default).
 *
 * DTO (совпадает с mobile CompatibilityResult + метаданные):
 *   { productId, barcode, score, verdict, lowConfidence, source,
 *     reasons: [{key, text, kind}], positives: [...], warnings: [...] }
 *
 * Бизнес-логика score/verdict — существующий evaluateCompatibility, без
 * изменений. Тексты — те же i18n-строки compatibility.*, что видит web.
 *
 * Кэш: in-memory TTL по (idOrBarcode, locale, profile fingerprint) — ответ
 * детерминирован между refresh'ами DM. COMPAT_CACHE=0 отключает.
 * Профилирование: COMPAT_TIMING=1 (этапы + counts + cache hit/miss).
 */
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight();
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface CompatibilityDto {
  productId: string;
  barcode: string;
  score: number;
  verdict: string;
  lowConfidence: boolean;
  source: "dm" | "legacy";
  reasons: FormattedReason[];
  positives: FormattedReason[];
  warnings: FormattedReason[];
}

/** Лёгкий select: для расчёта нужны только barcode и INCI-позиции. */
const PRODUCT_SELECT = {
  id: true,
  barcode: true,
  ingredients: {
    select: {
      position: true,
      ingredient: { select: { inci: true } },
    },
    orderBy: { position: "asc" as const },
  },
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const timer = createCompatTimer();
  const { id } = await ctx.params;
  const idOrBarcode = (id ?? "").trim();
  if (!idOrBarcode) {
    return apiError("validation", "Missing product id", 400);
  }

  const sp = req.nextUrl.searchParams;
  const hasProfile =
    sp.get("skinType") ||
    sp.get("sensitivity") ||
    sp.get("goal") ||
    sp.get("concerns") ||
    sp.get("avoided");
  const profile: SkinProfileSummaryLike | null = hasProfile
    ? {
        skinType: sp.get("skinType") || null,
        sensitivity: sp.get("sensitivity") || null,
        goal: sp.get("goal") || null,
        concerns: csv(sp.get("concerns")),
        avoidedList: csv(sp.get("avoided")),
      }
    : null;

  const locale: "ru" | "en" = (req.headers.get("accept-language") ?? "ru")
    .toLowerCase()
    .startsWith("en")
    ? "en"
    : "ru";

  // ── Кэш: barcode + locale + profile fingerprint ──
  const cacheKey = compatCacheKey(
    idOrBarcode,
    locale,
    profileFingerprint(profile),
  );
  const cached = compatCacheGet<CompatibilityDto>(cacheKey);
  if (cached) {
    const res = timer.timeSync("serialization", () =>
      apiJson(cached, { cache: "no-store" }),
    );
    if (timer.enabled) {
      timer.note(`id=${idOrBarcode} cache=hit`);
      timer.flush("products/:id/compatibility");
    }
    return res;
  }

  try {
    // ── productLoad: точечный lookup (НИКАКОГО searchProducts) ──
    const byId = await timer.time("productLoad.byId", () =>
      prisma.product.findUnique({
        where: { id: idOrBarcode },
        select: PRODUCT_SELECT,
      }),
    );
    const product =
      byId ??
      (await timer.time("productLoad.byBarcode", () =>
        prisma.product.findUnique({
          where: { barcode: idOrBarcode },
          select: PRODUCT_SELECT,
        }),
      ));

    if (!product) {
      return apiError("not_found", "Product not found", 404);
    }

    // ── Совместимость: существующий resolve (DM → fallback legacy) ──
    const engineProfile = profile
      ? summaryProfileToEngine(profile)
      : emptyProfile();
    const resolved = await resolveCompatibility(
      {
        barcode: product.barcode,
        legacyIngredients: product.ingredients.map((l) => ({
          inci: l.ingredient.inci,
          position: l.position,
        })),
        profile: engineProfile,
      },
      timer,
    );

    // ── Объяснения: RuleHit → локализованные строки (как web-блок) ──
    const dto: CompatibilityDto = timer.timeSync("buildExplanation", () => ({
      productId: product.id,
      barcode: product.barcode,
      score: resolved.result.score,
      verdict: resolved.result.verdict,
      lowConfidence: resolved.result.lowConfidence,
      source: resolved.source,
      reasons: formatRuleHits(resolved.result.reasons, locale),
      positives: formatRuleHits(resolved.result.positives, locale),
      warnings: formatRuleHits(resolved.result.warnings, locale),
    }));

    compatCacheSet(cacheKey, dto);

    const res = timer.timeSync("serialization", () =>
      apiJson(dto, { cache: "no-store" }),
    );
    if (timer.enabled) {
      timer.count("legacyIngredients", product.ingredients.length);
      timer.count("facts", resolved.facts.length);
      timer.count("bytes", JSON.stringify(dto).length);
      timer.note(
        `id=${idOrBarcode} cache=miss hit=${byId ? "byId" : "byBarcode"} ` +
          `score=${dto.score} verdict=${dto.verdict}`,
      );
      timer.flush("products/:id/compatibility");
    }
    return res;
  } catch (e) {
    console.error("[api/v1/products/:id/compatibility] failed:", e);
    return apiError("server_error", "Failed to evaluate compatibility", 500);
  }
}
