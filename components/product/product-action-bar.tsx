"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Heart, Layers, Plus } from "lucide-react";
import { buttonClassName } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDemoStore } from "@/lib/demo-store";

/**
 * ProductActionBar — нижняя зафиксированная панель на /product/[id].
 *
 * Phase 5:
 *   - heart toggle добавляет/убирает продукт в demo store favorites;
 *   - plus toggle — в compare-list;
 *   - на mount: записываем «просмотр» в history, чтобы и переход через
 *     сканер, и переход через избранное/историю формировали историю.
 *     Дедуп 30 секунд предотвращает повторные записи при ре-рендере.
 *
 * Phase 6: source может быть как mock-Product, так и DB-Product. Поэтому
 * принимаем минимальную форму — только `id`.
 */

export interface ProductActionBarProps {
  product: { id: string };
}

export function ProductActionBar({ product }: ProductActionBarProps) {
  const t = useTranslations("product");
  const { addScan, toggleFavorite, toggleCompare, isFavorite, isInCompare, hydrated } =
    useDemoStore();

  // record on view (with 30s dedupe in reducer)
  useEffect(() => {
    if (!hydrated) return;
    addScan(product.id);
  }, [hydrated, product.id, addScan]);

  const fav = isFavorite(product.id);
  const cmp = isInCompare(product.id);

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
        onClick={() => toggleFavorite(product.id)}
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
