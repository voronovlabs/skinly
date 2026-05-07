import type { ScanRecord } from "@/lib/types";
import { MOCK_PRODUCTS } from "./products";

/**
 * Mock-история сканирований. Phase 3: relativeLabel убран — относительные
 * метки времени строим в HistoryItem через next-intl ICU.
 */
export const MOCK_SCANS: ScanRecord[] = [
  {
    id: "scan-1",
    productId: MOCK_PRODUCTS[0].id,
    product: MOCK_PRODUCTS[0],
    scannedAt: hoursAgo(2),
    bucket: "today",
  },
  {
    id: "scan-2",
    productId: MOCK_PRODUCTS[1].id,
    product: MOCK_PRODUCTS[1],
    scannedAt: hoursAgo(28),
    bucket: "yesterday",
  },
  {
    id: "scan-3",
    productId: MOCK_PRODUCTS[4].id,
    product: MOCK_PRODUCTS[4],
    scannedAt: hoursAgo(30),
    bucket: "yesterday",
  },
];

export const MOCK_FAVORITE_IDS: string[] = [
  MOCK_PRODUCTS[1].id,
  MOCK_PRODUCTS[2].id,
  MOCK_PRODUCTS[3].id,
];

export const MOCK_RECOMMENDATION_IDS: string[] = [
  MOCK_PRODUCTS[1].id,
  MOCK_PRODUCTS[2].id,
  MOCK_PRODUCTS[3].id,
];

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}
