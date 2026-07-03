/**
 * goldapple.ru scraper — Playwright client, retries, rate-limit, shutdown.
 *
 * goldapple.ru is a JS-heavy SPA behind an anti-bot interstitial
 * ("Gold Apple — checking device"). Plain HTTP returns a stub page, so all
 * traffic goes through a real Chromium context. API replay requests are done
 * via `context.request` — it shares the cookie jar (incl. the anti-bot
 * clearance cookies) with the page.
 */

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const BASE_URL = "https://goldapple.ru";

export interface ClientOptions {
  headful?: boolean;
  navTimeoutMs?: number;
}

export interface GaClient {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function createClient(opts: ClientOptions = {}): Promise<GaClient> {
  const browser = await chromium.launch({
    headless: !opts.headful,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "accept-language": "ru-RU,ru;q=0.9,en;q=0.8" },
  });

  // Minimal fingerprint smoothing — enough to pass the JS challenge.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en"] });
    // @ts-expect-error page context
    window.chrome = window.chrome ?? { runtime: {} };
  });

  const page = await context.newPage();
  page.setDefaultTimeout(opts.navTimeoutMs ?? 45_000);
  page.setDefaultNavigationTimeout(opts.navTimeoutMs ?? 45_000);

  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

/**
 * Waits until the anti-bot interstitial is gone and the SPA has rendered.
 */
export async function waitForChallenge(page: Page, timeoutMs = 30_000): Promise<void> {
  await page
    .waitForFunction(
      () =>
        !/checking device/i.test(document.title) &&
        document.body != null &&
        document.body.innerText.trim().length > 200,
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => {
      warn("challenge wait timed out — continuing anyway");
    });
}

// ---------------------------------------------------------------------------
// timing / retries
// ---------------------------------------------------------------------------

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Random delay in [min, max] — polite rate limit between product cards. */
export function jitter(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * Math.max(0, maxMs - minMs));
}

export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 1500,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        const delay = baseDelayMs * i;
        warn(`${label}: attempt ${i}/${attempts} failed (${errMessage(e)}), retry in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label}: ${String(lastErr)}`);
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`[${ts()}] ⚠ ${msg}`);
}

export function errLog(msg: string): void {
  console.error(`[${ts()}] ✖ ${msg}`);
}

// ---------------------------------------------------------------------------
// graceful shutdown
// ---------------------------------------------------------------------------

export interface Shutdown {
  requested: () => boolean;
}

/**
 * First SIGINT/SIGTERM → finish current card, flush results, exit.
 * Second signal → hard exit.
 */
export function installShutdown(): Shutdown {
  let requested = false;
  const handler = (signal: string) => {
    if (requested) {
      errLog(`${signal} received twice — hard exit`);
      process.exit(130);
    }
    requested = true;
    warn(`${signal} received — finishing current item, then saving partial results…`);
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
  return { requested: () => requested };
}
