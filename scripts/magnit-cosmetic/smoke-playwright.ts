/**
 * SMOKE + ENDURANCE TEST: жизнеспособен ли браузерный транспорт (Chrome)
 * для cosmetic.magnit.ru за защитой QRATOR. Никаких попыток обхода —
 * только фиксация фактов для принятия решения.
 *
 * Этап 1 (smoke): установленный Google Chrome (channel: "chrome"), headful,
 *   persistent context; каталог → карточка обычной навигацией; артефакты.
 * Этап 2 (endurance, только после успешного smoke): в ТОЙ ЖЕ сессии,
 *   без перезапуска и очистки cookies, последовательно 20–30 случайных
 *   карточек из sitemap, не быстрее 1 карточки/сек. По каждой: status,
 *   H1, изображение, описание, время, признаки блокировки. В конце —
 *   сводка: успешно/заблокировано, среднее время, после какой карточки
 *   появились первые признаки блокировки.
 *
 * Запуск:
 *   npm run smoke:magnit
 *   npm run smoke:magnit -- --endurance-count 30
 *   npm run smoke:magnit -- --skip-endurance
 *   npm run smoke:magnit -- --product-url "https://cosmetic.magnit.ru/product/..."
 *   npm run smoke:magnit -- --keep-open
 *
 * Артефакты: data/magnit-cosmetic/smoke/
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";

const BASE = "https://cosmetic.magnit.ru";
const CATALOG_URL = `${BASE}/catalog`;
const SITEMAP_PRODUCTS_URL = `${BASE}/__sitemap__/products.xml`;

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "data", "magnit-cosmetic", "smoke");
const PROFILE_DIR = path.join(ROOT, "data", "magnit-cosmetic", "chrome-profile");

const { values: args } = parseArgs({
  options: {
    "product-url": { type: "string" },
    "keep-open": { type: "boolean", default: false },
    "skip-endurance": { type: "boolean", default: false },
    "endurance-count": { type: "string", default: "25" },
    timeout: { type: "string", default: "45000" },
  },
});
const NAV_TIMEOUT = parseInt(args.timeout ?? "45000", 10) || 45000;
const ENDURANCE_COUNT = Math.min(50, Math.max(5, parseInt(args["endurance-count"] ?? "25", 10) || 25));

const ts = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────── общие проверки ───────── */

interface NetEntry {
  url: string;
  status: number;
  server: string | null;
  type: string;
}

interface PageProbe {
  url: string;
  documentStatus: number | null;
  title: string;
  h1: string | null;
  hasDescription: boolean;
  hasComposition: boolean;
  qratorSuspected: boolean;
  htmlBytes: number;
}

function looksLikeQrator(html: string, server: string | null, status: number | null): boolean {
  return (
    status === 403 ||
    status === 423 ||
    status === 429 ||
    /qrator/i.test(server ?? "") ||
    /qrator|ddos|checking your browser|проверка браузера|доступ ограничен|access denied/i.test(
      html.slice(0, 5000),
    )
  );
}

async function serverHeader(res: Response | null): Promise<string | null> {
  if (!res) return null;
  const headers = (await res.allHeaders().catch(() => ({}))) as Record<string, string>;
  return headers["server"] ?? null;
}

async function probePage(page: Page, documentResponse: Response | null, label: string): Promise<PageProbe> {
  const html = await page.content();
  const title = await page.title();
  const h1 = await page.locator("h1").first().textContent({ timeout: 3000 }).catch(() => null);
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const server = await serverHeader(documentResponse);
  const status = documentResponse?.status() ?? null;

  const probe: PageProbe = {
    url: page.url(),
    documentStatus: status,
    title,
    h1: h1?.trim() ?? null,
    hasDescription: /Описание/.test(bodyText),
    hasComposition: /Состав/.test(bodyText),
    qratorSuspected: looksLikeQrator(html, server, status),
    htmlBytes: html.length,
  };

  await fs.writeFile(path.join(OUT_DIR, `${label}.html`), html, "utf-8");
  await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), fullPage: false });
  ts(
    `${label}: status=${probe.documentStatus ?? "spa"} title="${title.slice(0, 60)}" h1=${probe.h1 ? `"${probe.h1.slice(0, 50)}"` : "НЕТ"} desc=${probe.hasDescription} qrator=${probe.qratorSuspected}`,
  );
  return probe;
}

/* ───────── endurance ───────── */

interface EnduranceEntry {
  n: number;
  url: string;
  status: number | null;
  ok: boolean;
  h1: boolean;
  image: boolean;
  description: boolean;
  ms: number;
  blocked: boolean;
  blockSignal: string | null;
}

interface EnduranceSummary {
  requested: number;
  opened: number;
  success: number;
  blocked: number;
  errors: number;
  avgMs: number | null;
  avgMsSuccess: number | null;
  firstBlockAt: number | null;
  stoppedEarly: boolean;
  entries: EnduranceEntry[];
}

/** Sitemap читаем браузерным fetch внутри страницы — та же сессия/cookies. */
async function sitemapUrlsViaBrowser(page: Page): Promise<string[]> {
  const xml = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: "include" });
    return r.text();
  }, SITEMAP_PRODUCTS_URL);
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (/\/product\/\d+-/.test(m[1])) urls.push(m[1]);
  }
  return urls;
}

function sample<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

async function runEndurance(page: Page): Promise<EnduranceSummary> {
  ts(`endurance: получаю sitemap через браузерную сессию…`);
  let urls: string[] = [];
  try {
    urls = await sitemapUrlsViaBrowser(page);
    ts(`endurance: в sitemap ${urls.length} карточек, беру случайные ${ENDURANCE_COUNT}`);
  } catch (e) {
    ts(`endurance: sitemap недоступен (${(e as Error).message}) — этап пропущен`);
    return { requested: ENDURANCE_COUNT, opened: 0, success: 0, blocked: 0, errors: 1, avgMs: null, avgMsSuccess: null, firstBlockAt: null, stoppedEarly: true, entries: [] };
  }

  const targets = sample(urls, ENDURANCE_COUNT);
  const entries: EnduranceEntry[] = [];
  let firstBlockAt: number | null = null;
  let consecutiveBlocks = 0;
  let stoppedEarly = false;

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    const t0 = Date.now();
    let entry: EnduranceEntry;

    try {
      const res = await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
      // короткая пауза на гидрацию, затем проверки
      await page.waitForTimeout(400);
      const status = res?.status() ?? null;
      const server = await serverHeader(res);
      const html = await page.content();
      const h1 = await page.locator("h1").first().textContent({ timeout: 2500 }).catch(() => null);
      const image = (await page.locator('img[src*="images-foodtech.magnit.ru"]').count()) > 0;
      const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      const description = /Описание/.test(bodyText);
      const blocked = looksLikeQrator(html, server, status);
      const ok = !blocked && h1 !== null && (status === null || status === 200);

      entry = {
        n: i + 1,
        url,
        status,
        ok,
        h1: h1 !== null,
        image,
        description,
        ms: Date.now() - t0,
        blocked,
        blockSignal: blocked ? `status=${status} server=${server ?? "?"}` : null,
      };
    } catch (e) {
      entry = {
        n: i + 1,
        url,
        status: null,
        ok: false,
        h1: false,
        image: false,
        description: false,
        ms: Date.now() - t0,
        blocked: true,
        blockSignal: `error: ${(e as Error).message.slice(0, 120)}`,
      };
    }

    entries.push(entry);
    ts(
      `endurance ${entry.n}/${targets.length}: ${entry.ok ? "OK" : entry.blocked ? "BLOCKED" : "PARTIAL"} status=${entry.status ?? "?"} h1=${entry.h1} img=${entry.image} desc=${entry.description} ${entry.ms}ms${entry.blockSignal ? ` [${entry.blockSignal}]` : ""}`,
    );

    if (entry.blocked) {
      firstBlockAt = firstBlockAt ?? entry.n;
      consecutiveBlocks++;
      if (consecutiveBlocks >= 5) {
        ts(`endurance: 5 блокировок подряд — дальше не долбим, останавливаюсь`);
        stoppedEarly = true;
        break;
      }
    } else {
      consecutiveBlocks = 0;
    }

    // темп: не быстрее 1 карточки/сек (+джиттер), считая от старта навигации
    const elapsed = Date.now() - t0;
    const pause = Math.max(0, 1000 - elapsed) + 200 + Math.random() * 500;
    await sleep(pause);
  }

  const success = entries.filter((e) => e.ok).length;
  const blockedCount = entries.filter((e) => e.blocked).length;
  const okTimes = entries.filter((e) => e.ok).map((e) => e.ms);
  const summary: EnduranceSummary = {
    requested: ENDURANCE_COUNT,
    opened: entries.length,
    success,
    blocked: blockedCount,
    errors: entries.filter((e) => e.blockSignal?.startsWith("error:")).length,
    avgMs: entries.length ? Math.round(entries.reduce((s, e) => s + e.ms, 0) / entries.length) : null,
    avgMsSuccess: okTimes.length ? Math.round(okTimes.reduce((s, m) => s + m, 0) / okTimes.length) : null,
    firstBlockAt,
    stoppedEarly,
    entries,
  };
  return summary;
}

/* ───────── main ───────── */

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PROFILE_DIR, { recursive: true });

  const network: NetEntry[] = [];
  const consoleLog: string[] = [];

  ts(`launching installed Google Chrome (headful, persistent profile: ${PROFILE_DIR})`);
  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  page.on("response", async (res) => {
    const url = res.url();
    if (!/magnit\.ru|qrator/i.test(url)) return;
    const type = res.request().resourceType();
    if (!["document", "xhr", "fetch"].includes(type)) return;
    const headers = (await res.allHeaders().catch(() => ({}))) as Record<string, string>;
    if (network.length < 500) {
      network.push({ url: url.slice(0, 200), status: res.status(), server: headers["server"] ?? null, type });
    }
  });
  page.on("console", (msg) => {
    if (consoleLog.length < 200) consoleLog.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
  });

  /* ── 1. каталог ── */
  ts(`opening ${CATALOG_URL}`);
  const catalogResponse = await page.goto(CATALOG_URL, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => ts("networkidle timeout (ок, продолжаем)"));
  await page.waitForTimeout(3000);
  const catalogProbe = await probePage(page, catalogResponse, "catalog");

  /* ── 2. карточка обычной навигацией ── */
  let productResponse: Response | null = null;
  let navMode = "click";

  if (args["product-url"]) {
    navMode = "goto";
    ts(`goto product: ${args["product-url"]}`);
    productResponse = await page.goto(args["product-url"], { waitUntil: "load" });
  } else {
    const link = page.locator('a[href*="/product/"]').first();
    const href = await link.getAttribute("href", { timeout: 5000 }).catch(() => null);
    if (href) {
      ts(`clicking first product link: ${href.slice(0, 100)}`);
      const respPromise = page
        .waitForResponse((r) => r.request().resourceType() === "document" && /\/product\//.test(r.url()), { timeout: 8000 })
        .catch(() => null);
      await link.click();
      await page.waitForURL(/\/product\//, { timeout: NAV_TIMEOUT });
      productResponse = await respPromise;
    } else {
      navMode = "goto-fallback";
      const fallback = `${BASE}/product/8000067077-mixit_hair_expert_konditsioner_d_v_collagen_keratin_1000ml`;
      ts(`ссылок на карточки в каталоге не нашлось — goto ${fallback}`);
      productResponse = await page.goto(fallback, { waitUntil: "load" });
    }
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(3000);
  const productProbe = await probePage(page, productResponse, "product");

  const smokeOk =
    !catalogProbe.qratorSuspected &&
    !productProbe.qratorSuspected &&
    productProbe.h1 !== null &&
    productProbe.hasDescription &&
    (productProbe.documentStatus === null || productProbe.documentStatus === 200);

  /* ── 3. endurance: та же сессия, без перезапуска и очистки cookies ── */
  let endurance: EnduranceSummary | null = null;
  if (smokeOk && !args["skip-endurance"]) {
    ts(`smoke OK → endurance: ${ENDURANCE_COUNT} случайных карточек, той же сессией, ≤1 карточка/сек`);
    endurance = await runEndurance(page);
    await fs.writeFile(path.join(OUT_DIR, "endurance.json"), JSON.stringify(endurance, null, 2), "utf-8");
  } else if (!smokeOk) {
    ts(`smoke НЕ пройден — endurance пропущен (см. артефакты)`);
  }

  /* ── 4. артефакты и вердикт ── */
  const cookies = await context.cookies();
  await fs.writeFile(path.join(OUT_DIR, "cookies.json"), JSON.stringify(cookies, null, 2), "utf-8");
  await fs.writeFile(path.join(OUT_DIR, "network-log.json"), JSON.stringify(network, null, 2), "utf-8");
  await fs.writeFile(path.join(OUT_DIR, "console-log.json"), JSON.stringify(consoleLog, null, 2), "utf-8");

  let verdict: string;
  if (!smokeOk) {
    verdict = "BLOCKED/PARTIAL: smoke не пройден — см. артефакты, решаем целесообразность";
  } else if (!endurance) {
    verdict = "SMOKE OK (endurance пропущен флагом)";
  } else if (endurance.blocked === 0 && endurance.success >= Math.floor(endurance.opened * 0.9)) {
    verdict = `OK: ${endurance.success}/${endurance.opened} карточек без блокировок — Playwright жизнеспособен как основной транспорт`;
  } else {
    verdict = `UNSTABLE: блокировки после ${endurance.firstBlockAt ?? "?"}-й карточки (${endurance.blocked} из ${endurance.opened}) — см. endurance.json`;
  }

  const summary = {
    when: new Date().toISOString(),
    navMode,
    catalog: catalogProbe,
    product: productProbe,
    endurance: endurance
      ? {
          requested: endurance.requested,
          opened: endurance.opened,
          success: endurance.success,
          blocked: endurance.blocked,
          errors: endurance.errors,
          avgMs: endurance.avgMs,
          avgMsSuccess: endurance.avgMsSuccess,
          firstBlockAt: endurance.firstBlockAt,
          stoppedEarly: endurance.stoppedEarly,
        }
      : null,
    cookieCount: cookies.length,
    cookieNames: cookies.map((c) => c.name),
    networkEntries: network.length,
    verdict,
  };
  await fs.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");

  console.log("\n─── SMOKE SUMMARY ───");
  console.log(JSON.stringify(summary, null, 2));
  if (endurance) {
    console.log("\n─── ENDURANCE ───");
    console.log(`Открыто:               ${endurance.opened}/${endurance.requested}`);
    console.log(`Успешно:               ${endurance.success}`);
    console.log(`Заблокировано:         ${endurance.blocked}`);
    console.log(`Ошибок навигации:      ${endurance.errors}`);
    console.log(`Среднее время:         ${endurance.avgMs ?? "—"}ms (успешные: ${endurance.avgMsSuccess ?? "—"}ms)`);
    console.log(`Первая блокировка:     ${endurance.firstBlockAt ? `после ${endurance.firstBlockAt - 1} успешных, на карточке №${endurance.firstBlockAt}` : "не возникла"}`);
  }
  console.log(`\nАртефакты: ${OUT_DIR}`);
  console.log(`ВЕРДИКТ: ${verdict}`);

  if (args["keep-open"]) {
    ts("--keep-open: браузер оставлен открытым, заверши процесс Ctrl+C");
    await new Promise(() => undefined);
  }
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
