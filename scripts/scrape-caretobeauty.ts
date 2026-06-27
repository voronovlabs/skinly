/**
 * Skinly · адаптер источника · Care to Beauty → scrape.external_product_identifiers
 *
 * Ещё один EAN-адаптер в УНИВЕРСАЛЬНЫЙ пул (source='caretobeauty'). Care to
 * Beauty отдаёт GTIN прямо в `<meta property="product:gtin">`, поэтому это
 * один из самых чистых источников.
 *
 * Алгоритм (без хрупких CSS-селекторов):
 *   1. Берём бренды из scrape.inn_skin_products_normalized (или --brand / дефолт).
 *   2. Тянем product-sitemap магазина (gz) → все URL товаров.
 *   3. Фильтруем URL по slug'у бренда (URL начинается с `/us/<brand-slug>-`).
 *   4. Качаем каждую страницу, вытаскиваем product:gtin + og:brand + og:title.
 *   5. Валидируем EAN по контрольной сумме (reuse isValidEan из farera).
 *   6. Upsert в external_product_identifiers с source='caretobeauty'.
 *
 * Запуск (через tools-контейнер):
 *   npm run scrape:caretobeauty
 *   npm run scrape:caretobeauty -- --brand "Uriage" --max-per-brand 200
 *   npm run scrape:caretobeauty -- --limit 50 --debug
 *
 * НИЧЕГО не пишет в Product. unique остаётся (source, ean).
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { isValidEan } from "./farera/barcode-list";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";
import {
  BASE_URL,
  DEFAULT_BRANDS,
  DEFAULT_STORE,
  MAX_SITEMAP_PARTS,
  brandSlug,
  productSitemapUrl,
} from "./caretobeauty/config";
import { fetchHtml, fetchSitemapXml, FetchError } from "./caretobeauty/client";

const SOURCE = "caretobeauty";
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

/* ───────── CLI ───────── */

interface CliArgs {
  brands: string[] | null;
  store: string;
  limit: number; // 0 = без общего лимита
  maxPerBrand: number;
  debug: boolean;
}
function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      brand: { type: "string", multiple: true },
      store: { type: "string", default: DEFAULT_STORE },
      limit: { type: "string", default: "0" },
      "max-per-brand": { type: "string", default: "400" },
      debug: { type: "boolean", default: false },
    },
  });
  const brandVals = (values.brand as string[] | undefined) ?? [];
  const brands = brandVals
    .flatMap((b) => b.split("||"))
    .map((b) => b.trim())
    .filter(Boolean);
  const limit = parseInt(String(values.limit), 10);
  const maxPerBrand = parseInt(String(values["max-per-brand"]), 10);
  return {
    brands: brands.length ? brands : null,
    store: String(values.store),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    maxPerBrand: Number.isFinite(maxPerBrand) && maxPerBrand > 0 ? maxPerBrand : 400,
    debug: Boolean(values.debug),
  };
}

/* ───────── HTML meta extraction (no brittle selectors) ───────── */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
}

/** Достаёт content из <meta property="<prop>" ...>, независимо от порядка атрибутов. */
function metaContent(html: string, prop: string): string | null {
  const propEsc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagRe = new RegExp(`<meta\\b[^>]*\\bproperty=["']${propEsc}["'][^>]*>`, "i");
  const tag = tagRe.exec(html)?.[0];
  if (!tag) return null;
  const c = /\bcontent=["']([^"']*)["']/i.exec(tag);
  return c ? decodeEntities(c[1]).trim() : null;
}

interface ProductFields {
  gtin: string | null;
  brand: string | null;
  name: string | null;
  url: string | null;
  image: string | null;
  itemGroupId: string | null;
  retailerItemId: string | null;
}
function parseProduct(html: string, fallbackUrl: string): ProductFields {
  return {
    gtin: metaContent(html, "product:gtin"),
    brand: metaContent(html, "og:brand"),
    name: metaContent(html, "og:title"),
    url: metaContent(html, "og:url") ?? fallbackUrl,
    image: metaContent(html, "og:image"),
    itemGroupId: metaContent(html, "product:item_group_id"),
    retailerItemId: metaContent(html, "product:retailer_item_id"),
  };
}

/* ───────── sitemap enumeration ───────── */

const LOC_RE = /<loc>([^<]+)<\/loc>/gi;

async function loadProductUrls(store: string): Promise<string[]> {
  const urls: string[] = [];
  for (let part = 1; part <= MAX_SITEMAP_PARTS; part++) {
    const sm = productSitemapUrl(store, part);
    let xml: string;
    try {
      xml = await fetchSitemapXml(sm, log);
    } catch (e) {
      if (e instanceof FetchError && e.status === 404) break; // частей больше нет
      log(`[c2b] sitemap part ${part} fail: ${e instanceof Error ? e.message : e}`);
      break;
    }
    let m: RegExpExecArray | null;
    let n = 0;
    LOC_RE.lastIndex = 0;
    while ((m = LOC_RE.exec(xml)) !== null) {
      const u = decodeEntities(m[1].trim());
      if (u.includes(`/${store}/`) && !u.includes("/sitemaps/")) {
        urls.push(u);
        n++;
      }
    }
    log(`[c2b] sitemap part ${part}: +${n} product urls`);
    if (n === 0) break;
  }
  return urls;
}

/** Путь URL начинается со slug'а бренда: `/us/<slug>-...`. */
function urlMatchesBrand(url: string, store: string, slug: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.startsWith(`/${store}/${slug}-`);
  } catch {
    return false;
  }
}

/* ───────── brands source ───────── */

async function resolveBrands(args: CliArgs): Promise<string[]> {
  if (args.brands) return args.brands;
  const prisma = getPrisma();
  try {
    const rows = await prisma.$queryRaw<{ brand_normalized: string | null }[]>(
      Prisma.sql`
        SELECT DISTINCT brand_normalized
        FROM scrape.inn_skin_products_normalized
        WHERE coalesce(brand_normalized,'') <> ''
      `,
    );
    const brands = rows
      .map((r) => r.brand_normalized)
      .filter((b): b is string => !!b);
    if (brands.length) return brands;
  } catch {
    /* таблицы ещё нет */
  }
  log("[c2b] inn-skin staging пуст → беру дефолтный список брендов");
  return DEFAULT_BRANDS;
}

/* ───────── stats ───────── */

interface BrandStat {
  brand: string;
  slug: string;
  urlsMatched: number;
  fetched: number;
  validEan: number;
  invalidOrMissing: number;
  saved: number;
}

async function main(): Promise<void> {
  const args = parseCli();
  log(`[scrape caretobeauty] store=${args.store} limit=${args.limit || "∞"} maxPerBrand=${args.maxPerBrand}`);

  await ensureSchema(log);
  const prisma = getPrisma();

  const brands = await resolveBrands(args);
  const slugMap = brands.map((b) => ({ brand: b, slug: brandSlug(b) }));
  log(`бренды (${brands.length}): ${slugMap.map((s) => `${s.brand}→${s.slug}`).join(", ")}`);

  log("[c2b] загружаю product-sitemap…");
  const allUrls = await loadProductUrls(args.store);
  log(`[c2b] всего товаров в sitemap: ${allUrls.length}`);

  const stats: BrandStat[] = [];
  const examples: { brand: string; name: string; ean: string }[] = [];
  let fetchedTotal = 0;

  for (const { brand, slug } of slugMap) {
    const st: BrandStat = {
      brand, slug, urlsMatched: 0, fetched: 0, validEan: 0, invalidOrMissing: 0, saved: 0,
    };
    const matched = allUrls.filter((u) => urlMatchesBrand(u, args.store, slug));
    st.urlsMatched = matched.length;

    const cap = Math.min(matched.length, args.maxPerBrand);
    for (let i = 0; i < cap; i++) {
      if (args.limit && fetchedTotal >= args.limit) break;
      const url = matched[i];
      try {
        const html = await fetchHtml(url, log);
        st.fetched++;
        fetchedTotal++;
        const p = parseProduct(html, url);

        if (!p.gtin || !isValidEan(p.gtin)) {
          st.invalidOrMissing++;
          if (args.debug) log(`[MISS] ${url} gtin=${p.gtin ?? "—"}`);
          continue;
        }
        st.validEan++;

        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO scrape.external_product_identifiers (
            id, source, source_query, source_url, ean, product_name,
            brand_guess, normalized_name_key, raw_payload, scraped_at, updated_at
          ) VALUES (
            ${randomUUID()}, ${SOURCE}, ${brand}, ${p.url}, ${p.gtin},
            ${p.name}, ${p.brand}, dm.name_key(${p.name}),
            ${JSON.stringify(p)}::jsonb, now(), now()
          )
          ON CONFLICT (source, ean) DO UPDATE SET
            source_query        = EXCLUDED.source_query,
            source_url          = EXCLUDED.source_url,
            product_name        = EXCLUDED.product_name,
            brand_guess         = EXCLUDED.brand_guess,
            normalized_name_key = EXCLUDED.normalized_name_key,
            raw_payload         = EXCLUDED.raw_payload,
            updated_at          = now()
        `);
        st.saved++;
        if (examples.length < 5 && p.name) {
          examples.push({ brand, name: p.name, ean: p.gtin });
        }
      } catch (e) {
        st.invalidOrMissing++;
        log(`[FAIL] ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }

    stats.push(st);
    log(
      `[BRAND] "${brand}" (${slug}) urls=${st.urlsMatched} fetched=${st.fetched} ` +
        `validEAN=${st.validEan} invalid/missing=${st.invalidOrMissing} saved=${st.saved}`,
    );
    if (args.limit && fetchedTotal >= args.limit) {
      log(`[c2b] достигнут общий --limit ${args.limit}, стоп`);
      break;
    }
  }

  /* ── отчёт ── */
  log("");
  log("════════════ Care to Beauty · GTIN ENRICHMENT REPORT ════════════");
  log(`store=${args.store} · товаров в sitemap=${allUrls.length} · base=${BASE_URL}`);
  log("");
  log("по брендам (URL в sitemap / fetched / valid EAN / invalid|missing / saved):");
  log(
    "  " + "BRAND".padEnd(20) + "urls".padStart(7) + "fetch".padStart(7) +
      "valid".padStart(7) + "inv/miss".padStart(10) + "saved".padStart(7),
  );
  let tUrls = 0, tFetch = 0, tValid = 0, tInv = 0, tSaved = 0;
  for (const s of stats) {
    log(
      "  " + s.brand.padEnd(20) + String(s.urlsMatched).padStart(7) +
        String(s.fetched).padStart(7) + String(s.validEan).padStart(7) +
        String(s.invalidOrMissing).padStart(10) + String(s.saved).padStart(7),
    );
    tUrls += s.urlsMatched; tFetch += s.fetched; tValid += s.validEan;
    tInv += s.invalidOrMissing; tSaved += s.saved;
  }
  log("  " + "—".repeat(58));
  log(
    "  " + "TOTAL".padEnd(20) + String(tUrls).padStart(7) + String(tFetch).padStart(7) +
      String(tValid).padStart(7) + String(tInv).padStart(10) + String(tSaved).padStart(7),
  );
  log("");
  log("примеры (до 5):");
  if (examples.length === 0) log("  (нет)");
  for (const e of examples) log(`  • [${e.brand}] ${trunc(e.name, 50)} → ${e.ean}`);
  log("");
  log("ПОЛИТИКА: 0 записей в Product. Только staging (external_product_identifiers).");
  log("════════════════════════════════════════════════════════════════");
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
