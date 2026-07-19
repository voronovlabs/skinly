/**
 * Браузерный транспорт (Playwright + установленный Google Chrome).
 * Основной и единственный способ получения карточек: сайт за QRATOR,
 * обычный HTTP-клиент блокируется (423/403), полноценный Chrome проходит
 * (подтверждено smoke-тестом).
 *
 * Принципы:
 *   - headless по умолчанию, --headful только для отладки;
 *   - один долгоживущий persistent context на весь прогон;
 *   - никаких networkidle: goto(domcontentloaded) → ожидание нужного
 *     элемента с таймаутом;
 *   - модалки («Не сейчас» — выбор магазина, «Хорошо, закрыть» — cookies)
 *     закрываются автоматически; их отсутствие — не ошибка;
 *   - каждый этап ограничен таймаутом, процесс не может зависнуть.
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import {
  NAV_TIMEOUT_MS,
  OVERLAY_TIMEOUT_MS,
  PATHS,
  SELECTOR_TIMEOUT_MS,
} from "./config";
import { debug, ts } from "./logger";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export async function openBrowser(opts: { headful?: boolean } = {}): Promise<BrowserSession> {
  ts(
    `browser: launching Google Chrome (${opts.headful ? "headful — режим отладки" : "headless"}, profile: ${PATHS.chromeProfile})`,
  );
  const context = await chromium.launchPersistentContext(PATHS.chromeProfile, {
    channel: "chrome",
    headless: !opts.headful,
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(SELECTOR_TIMEOUT_MS);
  return { context, page };
}

export async function closeBrowser(session: BrowserSession | null): Promise<void> {
  if (!session) return;
  await session.context.close().catch(() => undefined);
}

/** Тексты кнопок закрытия модалок. */
const OVERLAY_BUTTONS = ["Не сейчас", "Хорошо, закрыть"];

/**
 * Закрывает модалки. `wait: true` (прогрев) — даём модалке время появиться;
 * `wait: false` (каждая навигация) — мгновенная проверка без ожидания.
 * Отсутствие модалок — штатная ситуация, ошибок не бросаем.
 */
export async function dismissOverlays(page: Page, opts: { wait: boolean }): Promise<void> {
  for (const name of OVERLAY_BUTTONS) {
    try {
      const btn = page.locator(`button:has-text("${name}")`).first();
      if (opts.wait) {
        await btn.waitFor({ state: "visible", timeout: OVERLAY_TIMEOUT_MS });
      } else if (!(await btn.isVisible().catch(() => false))) {
        continue;
      }
      await btn.click({ timeout: OVERLAY_TIMEOUT_MS });
      ts(`browser: закрыл модалку «${name}»`);
      await page.waitForTimeout(300);
    } catch {
      debug(`overlay «${name}» не появился — ок`);
    }
  }
}

/* ───────── 404-страница Магнит Косметик ───────── */

/**
 * Удалённый товар: SPA рендерит заглушку «Здесь ничего не нашлось»
 * (класс .app-empty-404). Это НЕ временная ошибка — retry бессмысленен.
 */
export class ProductNotFoundError extends Error {
  readonly code = "PRODUCT_NOT_FOUND" as const;
  constructor(readonly url: string) {
    super(`PRODUCT_NOT_FOUND: ${url}`);
    this.name = "ProductNotFoundError";
  }
}

const NOT_FOUND_TEXT = "Здесь ничего не нашлось";
/** CSS-маркеры 404 (класс + текстовый fallback на случай смены Nuxt-хэшей). */
const NOT_FOUND_SELECTOR = `.app-empty-404, [class*="app-empty-404"], main:has-text("${NOT_FOUND_TEXT}")`;

/** Страница — 404-заглушка? Класс проверяем первым (дёшево), текст — fallback. */
async function isNotFoundPage(page: Page): Promise<boolean> {
  if ((await page.locator('.app-empty-404, [class*="app-empty-404"]').count()) > 0) {
    return true;
  }
  return page
    .evaluate((text) => document.body?.innerText.includes(text) ?? false, NOT_FOUND_TEXT)
    .catch(() => false);
}

/**
 * Навигация + ожидание ОДНОГО ИЗ двух состояний: ключевой элемент
 * (карточка/листинг) ИЛИ 404-заглушка. Заглушка распознаётся сразу, без
 * прожигания SELECTOR_TIMEOUT_MS, и бросает ProductNotFoundError.
 * Без networkidle. Возвращает HTTP-статус документа (null для SPA-переходов).
 * Бросает при таймауте навигации/элемента — обработка у вызывающего.
 */
export async function gotoAndWait(
  page: Page,
  url: string,
  selector: string,
): Promise<{ status: number | null }> {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await dismissOverlays(page, { wait: false });
  // объединённый селектор: резолвится первым появившимся состоянием
  await page.waitForSelector(`${selector}, ${NOT_FOUND_SELECTOR}`, {
    timeout: SELECTOR_TIMEOUT_MS,
  });
  if (await isNotFoundPage(page)) throw new ProductNotFoundError(url);
  return { status: res?.status() ?? null };
}

/**
 * Текстовый ресурс (sitemap XML) браузерным fetch внутри страницы —
 * та же сессия и cookies, HTTP-клиент вне браузера не используется.
 */
export async function browserFetchText(page: Page, url: string): Promise<string> {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }, url);
}

/** Прогрев сессии: каталог + закрытие модалок с ожиданием. */
export async function warmupSession(page: Page, catalogUrl: string): Promise<void> {
  ts(`browser: warmup ${catalogUrl}`);
  await page.goto(catalogUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await dismissOverlays(page, { wait: true });
  await page
    .waitForSelector('a[href*="/product/"]', { timeout: SELECTOR_TIMEOUT_MS })
    .catch(() => ts("browser: warmup — товары в каталоге не дождались (продолжаем, признак разберём по карточкам)"));
}
