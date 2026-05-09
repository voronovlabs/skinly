import type {
  Product as DbProduct,
  ScanHistory as DbScanHistory,
} from "@prisma/client";
import type {
  HistoryBucket,
  Product as DisplayProduct,
  ScanRecord,
} from "@/lib/types";

/**
 * Адаптеры DB → display-shape, который ожидают UI-компоненты
 * (`ProductCard`, `HistoryItem`). Verdict / AI / compatibility / matchScore
 * заглушаются, потому что compatibility-engine ещё не включён.
 */

export function dbProductToDisplay(p: DbProduct): DisplayProduct {
  return {
    id: p.id,
    barcode: p.barcode,
    brand: p.brand,
    name: p.name,
    category: p.category, // enum-string, например "OTHER"
    emoji: p.emoji ?? "🧴",
    matchScore: 0,
    verdict: "good",
    verdictTitle: "",
    verdictSubtitle: "",
    aiExplanation: [],
    ingredients: [],
    compatibility: [],
  };
}

export function bucketFromDate(d: Date, now = Date.now()): HistoryBucket {
  const day = 24 * 60 * 60 * 1000;
  const diff = now - d.getTime();
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return "week";
  return "older";
}

export function dbScanToScanRecord(
  scan: DbScanHistory & { product: DbProduct },
): ScanRecord {
  return {
    id: scan.id,
    productId: scan.productId,
    product: {
      ...dbProductToDisplay(scan.product),
      matchScore: scan.matchScore || 0,
    },
    scannedAt: scan.scannedAt,
    bucket: bucketFromDate(scan.scannedAt),
  };
}
