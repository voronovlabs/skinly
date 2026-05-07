import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * ScreenContainer — обёртка экрана MVP.
 * Соответствует `.screen` из прототипа: max-width 480px, mx-auto,
 * fade-in анимация, опциональный bottom-padding под фиксированную навигацию.
 *
 * Используется как корневой элемент любой страницы внутри `(app)` группы.
 */

export type ScreenBackground = "default" | "transparent";

export interface ScreenContainerProps {
  children: ReactNode;
  className?: string;
  /** Добавить горизонтальный padding 24px (часто нужен на простых экранах). */
  padded?: boolean;
  /** Добавить bottom-padding 100px, чтобы контент не уходил под BottomNav. */
  withBottomNav?: boolean;
  /** Прозрачный фон — если экран сам управляет градиентом. */
  background?: ScreenBackground;
  /** HTML-тег корня (по умолчанию `main`). */
  as?: ElementType;
}

export function ScreenContainer({
  children,
  className,
  padded = false,
  withBottomNav = false,
  background = "default",
  as: Tag = "main",
}: ScreenContainerProps) {
  return (
    <Tag
      className={cn(
        "relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col",
        "animate-fade-in",
        background === "default" && "bg-warm-white",
        padded && "px-6",
        withBottomNav && "pb-[100px]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
