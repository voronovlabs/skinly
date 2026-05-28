"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

interface BackButtonProps {
  label?: string;
  className?: string;
}

/**
 * BackButton — использует router.back() чтобы не пушить новую запись
 * в browser history. Это исправляет двойной переход назад (catalog → product
 * → catalog → product) при использовании <Link href=…> вместо back().
 */
export function BackButton({ label = "Назад", className }: BackButtonProps) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label={label}
      className={className}
    >
      <ChevronLeft className="h-5 w-5" strokeWidth={2} />
    </button>
  );
}
