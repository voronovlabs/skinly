import { cn } from "@/lib/cn";
import { Tag, type TagTone } from "@/components/ui";
import type { Ingredient, IngredientSafety } from "@/lib/types";

/**
 * IngredientCard — карточка одного ингредиента в анализе.
 * Левая цветная полоса и точка отражают safety-уровень (как в прототипе).
 */

export interface IngredientCardProps {
  ingredient: Ingredient;
  className?: string;
}

const safetyConfig: Record<
  IngredientSafety,
  { borderClass: string; dotClass: string; tagTone: TagTone }
> = {
  beneficial: {
    borderClass: "border-l-success-deep",
    dotClass: "bg-success-deep",
    tagTone: "success",
  },
  neutral: {
    borderClass: "border-l-soft-beige",
    dotClass: "bg-light-graphite",
    tagTone: "neutral",
  },
  caution: {
    borderClass: "border-l-soft-gold",
    dotClass: "bg-soft-gold",
    tagTone: "warning",
  },
  danger: {
    borderClass: "border-l-error-deep",
    dotClass: "bg-error-deep",
    tagTone: "danger",
  },
};

export function IngredientCard({ ingredient, className }: IngredientCardProps) {
  const cfg = safetyConfig[ingredient.safety];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md bg-pure-white p-4",
        "border-l-[3px]",
        cfg.borderClass,
        className,
      )}
    >
      <span
        className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", cfg.dotClass)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-body font-semibold text-graphite truncate">
            {ingredient.displayName}
          </span>
          <Tag tone={cfg.tagTone}>{ingredient.shortLabel}</Tag>
        </div>
        <p className="text-body-sm text-muted-graphite">
          {ingredient.description}
        </p>
      </div>
    </div>
  );
}
