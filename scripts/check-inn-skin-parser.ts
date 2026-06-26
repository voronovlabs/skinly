/**
 * Skinly · self-check парсера inn-skin.ru
 *
 * Качает известную детальную страницу Uriage и проверяет, что INCI
 * извлекается ПОЛНОСТЬЮ (а не обрезается на первой скобке).
 *
 * Запуск:
 *   npm run check:inn-skin-parser
 *
 * Сеть нужна (идёт реальный fetch на inn-skin.ru). В Product/БД ничего
 * не пишет — это чистая проверка парсера. Exit code 1 при провале.
 */

import { productUrl } from "./inn-skin/config";
import { fetchHtml } from "./inn-skin/fetcher";
import { parseDetailPage } from "./inn-skin/parser";

const log = (m: string) => console.log(m);

const FIXTURE_ID = "85b30096-432b-4d0e-8263-9a0b510ef8ed";
const BRAND = "Uriage";
const MUST_CONTAIN = [
  "PARAFFINUM LIQUIDUM",
  "BUTYROSPERMUM PARKII",
  "ALOE BARBADENSIS LEAF EXTRACT",
];

async function main(): Promise<void> {
  log(`[check] fetching detail ${FIXTURE_ID} …`);
  const html = await fetchHtml(productUrl(FIXTURE_ID), log);
  const d = parseDetailPage(html, BRAND);

  const inci = d.ingredientsRaw ?? "";
  log(`[check] product:  ${d.productName ?? "—"} | brand=${d.brand ?? "—"}`);
  log(`[check] INCI len:  ${inci.length} chars`);
  log(`[check] INCI head: ${inci.slice(0, 90)}${inci.length > 90 ? " …" : ""}`);

  const failures = MUST_CONTAIN.filter((t) => !inci.toUpperCase().includes(t));

  for (const t of MUST_CONTAIN) {
    log(`  ${inci.toUpperCase().includes(t) ? "PASS" : "FAIL"}  contains: ${t}`);
  }

  // Грубые ожидания пилота: полный состав длинный, не обрезок.
  if (inci.length < 80) {
    failures.push(`INCI too short (${inci.length} < 80) — похоже на обрезку`);
  }

  if (failures.length > 0) {
    log("");
    log(`[check] ❌ FAILED: ${failures.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  log("");
  log("[check] ✅ OK — полный INCI извлечён корректно");
}

main().catch((e) => {
  console.error("[check] FATAL", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
