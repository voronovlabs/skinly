/**
 * ДИАГНОСТИКА: чистый headful Playwright-Chrome с НОВЫМ временным профилем
 * против блокировки `x-rkn-status: on` («Выключите VPN»).
 *
 * Цель — установить различие между обычным Chrome (открывает сайт) и
 * Playwright-сессией (получает 423), НЕ обходя защиту:
 *   - временный профиль (mkdtemp), НЕ data/magnit-cosmetic/chrome-profile;
 *   - channel: "chrome", headful;
 *   - никаких кастомных args (--no-sandbox и прочее не передаётся);
 *   - никаких proxy-настроек;
 *   - перед запуском логируются proxy-переменные окружения — главный
 *     подозреваемый: Playwright-Chrome может унаследовать HTTP(S)_PROXY
 *     из терминала, тогда как обычный Chrome ходит через системную сеть.
 *
 * Открывает ОДНУ карточку, сохраняет status / headers / HTML / screenshot
 * в data/magnit-cosmetic/diag/ и печатает вердикт.
 *
 * Запуск:
 *   npm run diag:magnit
 *   npm run diag:magnit -- --product-url "https://cosmetic.magnit.ru/product/..."
 *
 * Шаг 7 (вручную): открой ту же карточку в своём обычном Chrome и сравни.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const DEFAULT_PRODUCT =
  "https://cosmetic.magnit.ru/product/8000067077-mixit_hair_expert_konditsioner_d_v_collagen_keratin_1000ml";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "data", "magnit-cosmetic", "diag");

const { values: args } = parseArgs({
  options: { "product-url": { type: "string" } },
});
const PRODUCT_URL = args["product-url"] ?? DEFAULT_PRODUCT;

const ts = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  /* ── 5. окружение ДО запуска ── */
  console.log("─── ENV ───");
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    console.log(`${key}=${process.env[key] ?? "(не задана)"}`);
  }

  /* ── 1–4. чистый запуск: временный профиль, headful, без args/proxy ── */
  const tmpProfile = await fs.mkdtemp(path.join(os.tmpdir(), "magnit-diag-profile-"));
  ts(`временный профиль: ${tmpProfile}`);
  ts(`launch: channel=chrome headless=false, кастомные args НЕ передаются, proxy НЕ задан`);

  const context = await chromium.launchPersistentContext(tmpProfile, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultNavigationTimeout(45_000);

  console.log(`browser version: ${context.browser()?.version() ?? "unknown"}`);

  // Фактическая командная строка Chrome (что реально передал Playwright)
  try {
    const cdp = await context.newCDPSession(page);
    const cmd = (await cdp.send("Browser.getBrowserCommandLine" as never)) as unknown as {
      arguments?: string[];
    };
    console.log("─── ФАКТИЧЕСКИЕ LAUNCH ARGS (CDP) ───");
    for (const a of cmd.arguments ?? []) console.log(`  ${a}`);
    await cdp.detach().catch(() => undefined);
  } catch (e) {
    ts(`CDP getBrowserCommandLine недоступен (${(e as Error).message.slice(0, 80)}) — не критично`);
  }

  /* ── 6. одна карточка ── */
  ts(`opening ${PRODUCT_URL}`);
  const res = await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const status = res?.status() ?? null;
  const headers = res ? ((await res.allHeaders().catch(() => ({}))) as Record<string, string>) : {};
  const html = await page.content();
  const title = await page.title();
  const h1 = await page.locator("h1").first().textContent({ timeout: 3000 }).catch(() => null);

  const rknMarker = /x-rkn-status|Выключите VPN|statusCode:\s*423/i.test(html);
  const rknHeader = Object.entries(headers).find(([k]) => /rkn/i.test(k));

  await fs.writeFile(path.join(OUT_DIR, "product.html"), html, "utf-8");
  await page.screenshot({ path: path.join(OUT_DIR, "product.png"), fullPage: false });

  const summary = {
    when: new Date().toISOString(),
    profile: "temporary (mkdtemp)",
    url: PRODUCT_URL,
    documentStatus: status,
    server: headers["server"] ?? null,
    rknHeader: rknHeader ? `${rknHeader[0]}: ${rknHeader[1]}` : null,
    title,
    h1: h1?.trim() ?? null,
    rknBlockDetected: rknMarker || status === 423,
    env: {
      HTTP_PROXY: process.env.HTTP_PROXY ?? process.env.http_proxy ?? null,
      HTTPS_PROXY: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null,
      ALL_PROXY: process.env.ALL_PROXY ?? process.env.all_proxy ?? null,
      NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy ?? null,
    },
  };
  await fs.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");

  console.log("\n─── DIAG SUMMARY ───");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nАртефакты: ${OUT_DIR}`);

  if (summary.rknBlockDetected) {
    console.log(
      "\nВЕРДИКТ: чистый headful Playwright с новым профилем ТОЖЕ получает rkn-блокировку.\n" +
        "Проблема не в профиле и не в аргументах запуска — источник непригоден для\n" +
        "автономного парсинга из текущей сети. Селекторы/retry/headless не трогаем.\n" +
        "Шаг 7: открой эту же карточку в обычном Chrome и сравни — если там открывается,\n" +
        "разница на уровне сетевого маршрута процесса (VPN/proxy per-app).",
    );
  } else {
    console.log(
      "\nВЕРДИКТ: чистый headful Playwright карточку ОТКРЫВАЕТ.\n" +
        "Значит, блокировку ловил persistent-профиль или окружение прежнего запуска —\n" +
        "чиним запуск основного парсера и возвращаемся к dry-run на 5 товарах.",
    );
  }

  await context.close();
  await fs.rm(tmpProfile, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
