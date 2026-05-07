import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, MoreVertical, Sparkles } from "lucide-react";
import { Card, Tag } from "@/components/ui";
import {
  CompatibilityTable,
  IngredientCard,
  ProductActionBar,
  VerdictCard,
} from "@/components/product";
import { findProductByBarcode } from "@/lib/mock";

interface Params {
  barcode: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { barcode } = await params;
  const product = findProductByBarcode(barcode);
  const t = await getTranslations("product");
  return {
    title: product
      ? `${product.brand} · ${product.name}`
      : t("notFoundTitle"),
  };
}

export default async function ProductAnalysisPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { barcode } = await params;
  const product = findProductByBarcode(barcode);
  if (!product) notFound();

  const t = await getTranslations("product");

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[480px] bg-warm-white pb-32 animate-fade-in">
      {/* Header (sticky) */}
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
            className="
              flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center
              rounded-lg bg-pure-white text-[60px] shadow-soft-lg
            "
            aria-hidden
          >
            {product.emoji}
          </div>
          <div className="min-w-0">
            <p className="text-caption text-muted-graphite mb-1">
              {product.brand.toUpperCase()}
            </p>
            <h1 className="text-h2 text-graphite mb-2">{product.name}</h1>
            <Tag>{product.category}</Tag>
          </div>
        </div>
      </header>

      {/* Verdict */}
      <div className="px-6 pt-6">
        <VerdictCard
          tone={product.verdict}
          title={product.verdictTitle}
          subtitle={product.verdictSubtitle}
          matchScore={product.matchScore}
        />
      </div>

      {/* Key ingredients */}
      <section className="px-6 mt-8">
        <h3 className="text-h3 text-graphite mb-3">{t("keyIngredients")}</h3>
        <div className="space-y-2">
          {product.ingredients.map((ing) => (
            <IngredientCard key={ing.id} ingredient={ing} />
          ))}
        </div>
      </section>

      {/* Compatibility */}
      <section className="px-6 mt-8">
        <h3 className="text-h3 text-graphite mb-3">{t("skinCompatibility")}</h3>
        <CompatibilityTable rows={product.compatibility} />
      </section>

      {/* AI explanation */}
      <section className="px-6 mt-8 mb-8">
        <h3 className="text-h3 text-graphite mb-3">{t("aiExplanation")}</h3>
        <Card
          className="bg-gradient-to-br from-soft-lavender to-pure-white"
          padding="default"
        >
          <div className="flex items-start gap-3">
            <div
              className="
                flex h-8 w-8 flex-shrink-0 items-center justify-center
                rounded-full bg-lavender-deep text-pure-white
              "
              aria-hidden
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="space-y-2">
              {product.aiExplanation.map((p, i) => (
                <p
                  key={i}
                  className={`text-body-sm ${i === 0 ? "text-graphite" : "text-muted-graphite"}`}
                >
                  {p}
                </p>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* Action bar (client) */}
      <ProductActionBar product={product} />
    </main>
  );
}
