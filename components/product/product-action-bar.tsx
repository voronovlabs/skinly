"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heart, Layers, Plus } from "lucide-react";
import { buttonClassName } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";
import { toggleFavoriteAction } from "@/app/actions/favorites";
import { recordScanAction } from "@/app/actions/scans";

/**
 * ProductActionBar — нижняя зафиксированная панель на /product/[id].
 *
 * Phase 5:
 *   - heart toggle добавляет/убирает продукт в demo store favorites;
 *   - plus toggle — в compare-list;
 *   - на mount: записываем «просмотр» в demo store (history),
 *     чтобы и переход через сканер, и переход через избранное/историю
 *     формировали историю. Дедуп 30 секунд внутри reducer'а.
 *
 * Phase 9 (server persistence):
 *   - Toggle favorite + view scan дублируется через server action.
 *     Для guest action no-op; для user идёт upsert/insert в БД.
 *     UI оптимистичен — БД синхронится в фоне.
 *   - После toggle делаем `router.refresh()`, чтобы серверные страницы
 *     (/favorites, /history, /dashboard) подтянули свежее состояние,
 *     если пользователь зашёл по ним повторно.
 */

export interface ProductActionBarProps {
  product: { id: string };
}

export function ProductActionBar({ product }: ProductActionBarProps) {
  const t = useTranslations("product");
  const router = useRouter();
  const [, startTransition] = useTransition();

  const {
    addScan,
    toggleFavorite,
    toggleCompare,
    isFavorite,
    isInCompare,
    hydrated,
  } = useDemoStore();

  // record on view: demo store (instant) + DB (для user'а)
  useEffect(() => {
    if (!hydrated) return;
    addScan(product.id);
    startTransition(async () => {
      await recordScanAction(product.id, 0);
    });
    // intentionally one-shot per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, product.id]);

  const fav = isFavorite(product.id);
  const cmp = isInCompare(product.id);

  const handleToggleFavorite = () => {
    // optimistic — demo store
    toggleFavorite(product.id);
    // sync — server action (no-op для guest)
    startTransition(async () => {
      await toggleFavoriteAction(product.id);
      router.refresh();
    });
  };

  return (
    <footer
      className="
        fixed bottom-0 left-1/2 z-50 flex w-full max-w-[480px] -translate-x-1/2
        gap-3 bg-pure-white px-6 pb-8 pt-4 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]
      "
    >
      <button
        type="button"
        aria-pressed={fav}
        aria-label={fav ? t("removeFavorite") : t("addFavorite")}
        onClick={handleToggleFavorite}
        className={cn(
          buttonClassName({
            variant: "secondary",
            size: "icon",
            fullWidth: false,
          }),
          fav && "!border-error-deep !text-error-deep !bg-error-blush/40",
        )}
      >
        <Heart
          className="h-5 w-5"
          strokeWidth={2}
          fill={fav ? "currentColor" : "none"}
        />
      </button>

      <button
        type="button"
        aria-pressed={cmp}
        aria-label={cmp ? t("removeList") : t("addList")}
        onClick={() => toggleCompare(product.id)}
        className={cn(
          buttonClassName({
            variant: "secondary",
            size: "icon",
            fullWidth: false,
          }),
          cmp && "!border-lavender-deep !text-lavender-deep !bg-soft-lavender/60",
        )}
      >
        {cmp ? (
          <Layers className="h-5 w-5" strokeWidth={2} />
        ) : (
          <Plus className="h-5 w-5" strokeWidth={2} />
        )}
      </button>

      <Link
        href="/scan"
        className={`${buttonClassName({ variant: "primary" })} flex-1`}
      >
        {t("scanAnother")}
      </Link>
    </footer>
  );
}
