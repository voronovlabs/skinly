"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Zap } from "lucide-react";
import { Button } from "@/components/ui";
import { useDemoStore } from "@/lib/demo-store";
import { findProductByBarcode } from "@/lib/mock";
import { AnalyzingOverlay } from "./analyzing-overlay";

/**
 * ScannerView — mock-сканер штрихкода.
 *
 * Phase 5:
 *   - принимает массив барк-кодов и при «симуляции» выбирает случайный,
 *     чтобы demo-flow выдавал разные продукты;
 *   - перед редиректом записывает скан в demo store (localStorage),
 *     даже если у нас нет БД.
 */

export interface ScannerViewProps {
  /** Все barcodes демо-каталога. */
  demoBarcodes: string[];
}

export function ScannerView({ demoBarcodes }: ScannerViewProps) {
  const router = useRouter();
  const t = useTranslations("scanner");
  const { addScan } = useDemoStore();
  const [analyzing, setAnalyzing] = useState(false);

  const handleSimulate = () => {
    if (demoBarcodes.length === 0) return;
    setAnalyzing(true);
    const next =
      demoBarcodes[Math.floor(Math.random() * demoBarcodes.length)];

    setTimeout(() => {
      const product = findProductByBarcode(next);
      if (product) addScan(product.id);
      router.push(`/product/${next}`);
    }, 2200);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div
        className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] to-[#16213e]"
        aria-hidden
      />
      <div className="absolute inset-0 bg-black/50" aria-hidden />

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-6 text-pure-white">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-pure-white backdrop-blur-md"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <span className="text-h3 text-pure-white">{t("title")}</span>
        <button
          type="button"
          aria-label={t("flash")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-pure-white backdrop-blur-md"
        >
          <Zap className="h-5 w-5" strokeWidth={2} />
        </button>
      </header>

      <div
        className="absolute left-1/2 top-1/2 h-[200px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-xl"
        aria-hidden
      >
        <Corner pos="tl" />
        <Corner pos="tr" />
        <Corner pos="bl" />
        <Corner pos="br" />
        <div className="absolute left-0 top-0 h-[2px] w-full bg-pure-white/80 shadow-[0_0_4px_rgba(255,255,255,0.8)] animate-scanner-laser" />
      </div>

      <div className="absolute inset-x-0 bottom-[120px] z-10 flex flex-col items-center gap-3 px-6">
        <p className="text-body-sm text-pure-white/90 text-center">
          {t("alignBarcode")}
        </p>
        <Button
          variant="secondary"
          fullWidth={false}
          onClick={handleSimulate}
          className="bg-white/20 text-pure-white border-white/30 backdrop-blur-md hover:bg-white/30"
        >
          {t("simulateScan")}
        </Button>
      </div>

      <AnalyzingOverlay visible={analyzing} />
    </div>
  );
}

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = "absolute h-6 w-6 border-2 border-pure-white";
  const variants: Record<typeof pos, string> = {
    tl: "left-[-2px] top-[-2px] border-r-0 border-b-0",
    tr: "right-[-2px] top-[-2px] border-l-0 border-b-0",
    bl: "left-[-2px] bottom-[-2px] border-r-0 border-t-0",
    br: "right-[-2px] bottom-[-2px] border-l-0 border-t-0",
  };
  return <div className={`${base} ${variants[pos]}`} />;
}
