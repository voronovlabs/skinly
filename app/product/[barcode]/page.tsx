import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, MoreVertical, Sparkles } from "lucide-react";
import { Card, Tag } from "@/components/ui";
import {
  CompatibilityTable,
  IngredientCard,
  ProductActionBar,
  VerdictCard,
} from "@/components/product";
import { findProductByBarcode } from "@/lib/mock";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * /product/<id-or-barcode>
 *
 * Историческое имя сегмента — `[barcode]` (так было в Phase 5 demo). С Phase 6
 * сюда приходят реальные `Product.id` (cuid) из БД, поэтому handler сначала
 * ищет в БД по `id`, потом по `barcode`, и только в самом конце — fallback
 * на mock каталог по barcode.
 *
 * TODO: переименовать каталог сегмента на `[id]` через git mv (физически
 * удалить эту папку нельзя из этого окружения).
 */

interface Params {
  /** Слэш-сегмент: cuid (Product.id) или EAN-13 (Product.barcode). */
  barcode: string;
}

type DbProductWithIngredients = Prisma.ProductGetPayload<{
  include: {
    ingredients: {
      include: { ingredient: true };
    };
  };
}>;

async function findInDb(
  idOrBarcode: string,
): Promise<DbProductWithIngredients | null> {
  const include = {
    ingredients: {
      include: { ingredient: true },
      orderBy: { position: "asc" } as const,
    },
  };
  try {
    const byId = await prisma.product.findUnique({
      where: { id: idOrBarcode },
      include,
    });
    if (byId) return byId;
    return await prisma.product.findUnique({
      where: { barcode: idOrBarcode },
      include,
    });
  } catch (e) {
    console.error("[product/page] DB lookup failed:", e);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { barcode } = await params;
  const t = await getTranslations("product");
  const db = await findInDb(barcode);
  if (db) {
    return { title: `${db.brand} · ${db.name}` };
  }
  const mock = findProductByBarcode(barcode);
  return {
    title: mock ? `${mock.brand} · ${mock.name}` : t("notFoundTitle"),
  };
}

export default async function ProductAnalysisPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { barcode: idOrBarcode } = await params;
  const t = await getTranslations("product");

  // 1) DB по id, потом по barcode
  const db = await findInDb(idOrBarcode);
  if (db) {
    return <DbProductView product={db} />;
  }

  // 2) Demo / Phase 5 fallback
  const mock = findProductByBarcode(idOrBarcode);
  if (mock) {
    return (
      <main className="relative mx-auto min-h-screen w-full max-w-[480px] bg-warm-white pb-32 animate-fade-in">
        <header className="sticky top-0 z-10 bg-gradient-to-br from-soft-beige to-warm-white px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <Link
              href="/dashboard"
              aria-label={t("back")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            </Link>
            <button
              type="button"
              aria-label={t("menu")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
            >
              <MoreVertical className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>

          <div className="flex items-center gap-5">
            <div
              className="flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center rounded-lg bg-pure-white text-[60px] shadow-soft-lg"
              aria-hidden
            >
              {mock.emoji}
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-graphite mb-1">
                {mock.brand.toUpperCase()}
              </p>
              <h1 className="text-h2 text-graphite mb-2">{mock.name}</h1>
              <Tag>{mock.category}</Tag>
            </div>
          </div>
        </header>

        <div className="px-6 pt-6">
          <VerdictCard
            tone={mock.verdict}
            title={mock.verdictTitle}
            subtitle={mock.verdictSubtitle}
            matchScore={mock.matchScore}
          />
        </div>

        <section className="px-6 mt-8">
          <h3 className="text-h3 text-graphite mb-3">{t("keyIngredients")}</h3>
          <div className="space-y-2">
            {mock.ingredients.map((ing) => (
              <IngredientCard key={ing.id} ingredient={ing} />
            ))}
          </div>
        </section>

        <section className="px-6 mt-8">
          <h3 className="text-h3 text-graphite mb-3">{t("skinCompatibility")}</h3>
          <CompatibilityTable rows={mock.compatibility} />
        </section>

        <section className="px-6 mt-8 mb-8">
          <h3 className="text-h3 text-graphite mb-3">{t("aiExplanation")}</h3>
          <Card
            className="bg-gradient-to-br from-soft-lavender to-pure-white"
            padding="default"
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-lavender-deep text-pure-white"
                aria-hidden
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="space-y-2">
                {mock.aiExplanation.map((p, i) => (
                  <p
                    key={i}
                    className={`text-body-sm ${
                      i === 0 ? "text-graphite" : "text-muted-graphite"
                    }`}
                  >
                    {p}
                  </p>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <ProductActionBar product={{ id: mock.id }} />
      </main>
    );
  }

  // 3) Ничего не нашли — 404
  notFound();
}

/* ───────── DB view ─────────
 *
 * Минимальная подача: header (brand/name/barcode/category/imageUrl) +
 * список ингредиентов из ProductIngredient. Verdict/AI/compatibility
 * не показываем — engine для DB-продуктов появится в Phase 6.2.
 */
async function DbProductView({
  product,
}: {
  product: DbProductWithIngredients;
}) {
  const t = await getTranslations("product");
  const locale = await getLocale();
  const isEn = locale === "en";

  const categoryLabel =
    product.category && product.category !== "OTHER"
      ? product.category.replace(/_/g, " ").toLowerCase()
      : null;

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[480px] bg-warm-white pb-32 animate-fade-in">
      <header className="sticky top-0 z-10 bg-gradient-to-br from-soft-beige to-warm-white px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/dashboard"
            aria-label={t("back")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </Link>
          <button
            type="button"
            aria-label={t("menu")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
          >
            <MoreVertical className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="flex items-center gap-5">
          <div
            className="flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-pure-white shadow-soft-lg"
            aria-hidden
          >
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-[60px]">{product.emoji ?? "🧴"}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-caption text-muted-graphite mb-1 truncate">
              {product.brand.toUpperCase()}
            </p>
            <h1 className="text-h2 text-graphite mb-1 line-clamp-3">
              {product.name}
            </h1>
            <p className="text-body-sm text-muted-graphite mb-2 font-mono">
              {product.barcode}
            </p>
            {categoryLabel && <Tag>{categoryLabel}</Tag>}
          </div>
        </div>
      </header>

      <section className="px-6 mt-8 mb-8">
        <h3 className="text-h3 text-graphite mb-3">{t("keyIngredients")}</h3>

        {product.ingredients.length === 0 ? (
          <Card padding="default">
            <p className="text-body-sm text-muted-graphite">—</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {product.ingredients.map(({ ingredient, position }) => {
              const display = isEn
                ? ingredient.displayNameEn
                : ingredient.displayNameRu;
              const description = isEn
                ? ingredient.descriptionEn
                : ingredient.descriptionRu;
              return (
                <li
                  key={ingredient.id}
                  className="rounded-md bg-pure-white p-4 shadow-soft-sm"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-body text-graphite">{display}</span>
                    <span className="text-caption text-light-graphite">
                      #{position}
                    </span>
                  </div>
                  {description && (
                    <p className="text-body-sm text-muted-graphite mt-1">
                      {description}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ProductActionBar product={{ id: product.id }} />
    </main>
  );
}
