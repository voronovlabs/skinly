import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { MoreVertical } from "lucide-react";
import { BackButton, Card, Tag } from "@/components/ui";
import {
  IngredientsList,
  ProductActionBar,
  ProductCompatibilitySection,
  SimilarProducts,
  type IngredientsListItem,
} from "@/components/product";
import { findProductByBarcode } from "@/lib/mock";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { getBeautyProfileByUserId } from "@/lib/db/repositories/beauty-profile";
import {
  emptyProfile,
  inciToFact,
  summaryProfileToEngine,
  type IngredientFact,
  type SkinProfileSummaryLike,
} from "@/lib/compatibility";
import { resolveCompatibility } from "@/lib/compatibility/resolve-compatibility";
import {
  createCompatTimer,
  NOOP_COMPAT_TIMER,
  type CompatTimer,
} from "@/lib/compatibility/timing";

/**
 * /product/<id-or-barcode>
 *
 * Phase 10.1:
 *   - На сервере: загружаем продукт (DB или mock fallback) и опц. profile
 *     текущего user'а. Готовим IngredientFact[]'ы (engine input).
 *   - На клиенте: <ProductCompatibilitySection /> + <IngredientsList />
 *     сами берут профиль (server-injected для user'а / demo store для guest)
 *     и считают engine локально. Один UI для guest и user.
 *   - matchScore прокидывается в <ProductActionBar /> только если профиль
 *     известен на сервере (user). Для guest-mode score сохраняется в
 *     demo-store через addScan() — UI score badge поверх engine result.
 *
 * Не ломаем:
 *   - mock fallback всё ещё работает (для legacy mock-каталога Phase 5).
 *   - Action bar / scanner / favorites / history — без изменений.
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
  timer: CompatTimer = NOOP_COMPAT_TIMER,
): Promise<DbProductWithIngredients | null> {
  const include = {
    ingredients: {
      include: { ingredient: true },
      orderBy: { position: "asc" } as const,
    },
  };
  try {
    const byId = await timer.time("productLoad.byId", () =>
      prisma.product.findUnique({ where: { id: idOrBarcode }, include }),
    );
    if (byId) return byId;
    return await timer.time("productLoad.byBarcode", () =>
      prisma.product.findUnique({ where: { barcode: idOrBarcode }, include }),
    );
  } catch (e) {
    console.error("[product/page] DB lookup failed:", e);
    return null;
  }
}

async function loadServerProfile(
  timer: CompatTimer = NOOP_COMPAT_TIMER,
): Promise<{
  mode: "user" | "guest";
  serverProfile: SkinProfileSummaryLike | null;
}> {
  const user = await timer.time("auth", () => getCurrentUser());
  if (!user) return { mode: "guest", serverProfile: null };
  try {
    const p = await timer.time("profileLoad", () =>
      getBeautyProfileByUserId(user.id),
    );
    if (!p) return { mode: "user", serverProfile: null };
    return {
      mode: "user",
      serverProfile: {
        skinType: p.skinType.toLowerCase(),
        sensitivity: p.sensitivity.toLowerCase(),
        concerns: p.concerns.map((c) => c.toLowerCase()),
        avoidedList: p.avoidedList.map((a) => a.toLowerCase()),
        goal: p.goal.toLowerCase(),
      },
    };
  } catch (e) {
    console.error("[product/page] profile load failed:", e);
    return { mode: "guest", serverProfile: null };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { barcode } = await params;
  const t = await getTranslations("product");
  // ⚠️ Этот findInDb — ВТОРАЯ загрузка того же товара на просмотр страницы
  // (page тоже зовёт findInDb; react cache() не используется). COMPAT_TIMING
  // покажет это отдельной строкой scope=web:metadata.
  const metaTimer = createCompatTimer();
  const db = await findInDb(barcode, metaTimer);
  if (metaTimer.enabled) {
    metaTimer.note(`idOrBarcode=${barcode} dup=generateMetadata`);
    metaTimer.flush("web:metadata");
  }
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
  const locale = await getLocale();

  // COMPAT_TIMING=1: полный серверный путь web-карточки. Обратите внимание:
  // auth/profileLoad и productLoad идут ПОСЛЕДОВАТЕЛЬНО (waterfall).
  const timer = createCompatTimer();

  const session = await loadServerProfile(timer);

  // 1) DB lookup
  const db = await findInDb(idOrBarcode, timer);
  if (db) {
    return (
      <DbProductView
        product={db}
        locale={locale}
        mode={session.mode}
        serverProfile={session.serverProfile}
        t={t}
        timer={timer}
      />
    );
  }

  // 2) Mock fallback (Phase 5 каталог)
  const mock = findProductByBarcode(idOrBarcode);
  if (mock) {
    const facts: IngredientFact[] = mock.ingredients.map((ing, i) =>
      inciToFact(ing.inci, i + 1),
    );
    const items: IngredientsListItem[] = mock.ingredients.map((ing, i) => ({
      id: ing.id,
      inci: ing.inci,
      position: i + 1,
      displayName: ing.displayName,
      description: ing.description,
    }));

    return (
      <main className="relative mx-auto min-h-screen w-full max-w-[480px] bg-warm-white pb-32 animate-fade-in">
        <header className="sticky top-0 z-10 bg-gradient-to-br from-soft-beige to-warm-white px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <BackButton
              label={t("back")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
            />
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
          <ProductCompatibilitySection
            mode={session.mode}
            facts={facts}
            serverProfile={session.serverProfile}
          />
        </div>

        <section className="px-6 mt-8">
          <h3 className="text-h3 text-graphite mb-3">{t("keyIngredients")}</h3>
          <IngredientsList
            mode={session.mode}
            items={items}
            facts={facts}
            serverProfile={session.serverProfile}
          />
        </section>

        <section className="px-6 mt-10">
          <SimilarProducts
            barcode={mock.barcode}
            mode={session.mode}
            serverProfile={session.serverProfile}
          />
        </section>

        <ProductActionBar
          product={{ id: mock.id }}
          scoringContext={{
            mode: session.mode,
            inciList: mock.ingredients.map((ing, i) => ({
              inci: ing.inci,
              position: i + 1,
            })),
            serverProfile: session.serverProfile,
          }}
        />
      </main>
    );
  }

  // 3) Ничего не нашли — 404
  notFound();
}

/* ───────── DB view ───────── */

async function DbProductView({
  product,
  locale,
  mode,
  serverProfile,
  t,
  timer = NOOP_COMPAT_TIMER,
}: {
  product: DbProductWithIngredients;
  locale: string;
  mode: "user" | "guest";
  serverProfile: SkinProfileSummaryLike | null;
  t: Awaited<ReturnType<typeof getTranslations<"product">>>;
  timer?: CompatTimer;
}) {
  const isEn = locale === "en";

  const categoryLabel =
    product.category && product.category !== "OTHER"
      ? product.category.replace(/_/g, " ").toLowerCase()
      : null;

  // Flag-gated: DM-путь для реальных товаров с barcode, иначе legacy
  // (inciToFact). Берём только facts — клиентские компоненты пересчитывают
  // result под профиль сами. UI и mock-ветка не меняются.
  const { facts } = await resolveCompatibility(
    {
      barcode: product.barcode,
      legacyIngredients: product.ingredients.map((l) => ({
        inci: l.ingredient.inci,
        position: l.position,
      })),
      profile: serverProfile
        ? summaryProfileToEngine(serverProfile)
        : emptyProfile(),
    },
    timer,
  );
  if (timer.enabled) {
    timer.count("facts", facts.length);
    timer.count("legacyIngredients", product.ingredients.length);
    timer.note(
      `barcode=${product.barcode} mode=${mode} ` +
        `factsBytesToClient=${JSON.stringify(facts).length}`,
    );
    timer.flush("web:/product");
  }

  const items: IngredientsListItem[] = product.ingredients.map((l) => ({
    id: `${product.id}_${l.ingredientId}`,
    inci: l.ingredient.inci,
    position: l.position,
    displayName: isEn
      ? l.ingredient.displayNameEn
      : l.ingredient.displayNameRu,
    description:
      (isEn ? l.ingredient.descriptionEn : l.ingredient.descriptionRu) ??
      undefined,
  }));

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[480px] bg-warm-white pb-32 animate-fade-in">
      <header className="sticky top-0 z-10 bg-gradient-to-br from-soft-beige to-warm-white px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <BackButton
            label={t("back")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-soft-beige"
          />
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

      <div className="px-6 pt-6">
        <ProductCompatibilitySection
          mode={mode}
          facts={facts}
          serverProfile={serverProfile}
        />
      </div>

      <section className="px-6 mt-8 mb-8">
        <h3 className="text-h3 text-graphite mb-3">{t("keyIngredients")}</h3>

        {product.ingredients.length === 0 ? (
          <Card padding="default">
            <p className="text-body-sm text-muted-graphite">—</p>
          </Card>
        ) : (
          <IngredientsList
            mode={mode}
            items={items}
            facts={facts}
            serverProfile={serverProfile}
          />
        )}
      </section>

      <section className="px-6 mt-10">
        <SimilarProducts
          barcode={product.barcode}
          mode={mode}
          serverProfile={serverProfile}
        />
      </section>

      <ProductActionBar
        product={{ id: product.id }}
        scoringContext={{
          mode,
          inciList: product.ingredients.map((l) => ({
            inci: l.ingredient.inci,
            position: l.position,
          })),
          serverProfile,
        }}
      />
    </main>
  );
}
