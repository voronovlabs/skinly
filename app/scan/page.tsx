import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScannerView } from "@/components/scanner";
import { MOCK_PRODUCTS } from "@/lib/mock";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scanner");
  return { title: t("metaTitle") };
}

/**
 * /scan — фуллскрин-сканер штрихкода (mock).
 * Передаём весь demo-каталог: ScannerView сам выбирает случайный продукт
 * на каждый клик «Симуляция скана».
 */
export default function ScanPage() {
  const demoBarcodes = MOCK_PRODUCTS.map((p) => p.barcode);
  return <ScannerView demoBarcodes={demoBarcodes} />;
}
