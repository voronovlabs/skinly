/**
 * Skinly · адаптер источника · Care to Beauty
 *
 * ДВА staging-приёмника, оба пополняются за один проход:
 *   1) scrape.external_product_identifiers (source='caretobeauty') — GTIN-поток,
 *      работает РОВНО как раньше (его не трогаем по контракту);
 *   2) scrape.caretobeauty_products — ВЫДЕЛЕННЫЙ полный слепок Care to Beauty
 *      (название/бренд/картинка/INCI/описание/объём/категория), сырьём.
 *
 * Перечисление — через product-sitemap (gz), отбор по slug'у бренда. По
 * умолчанию сканируем ТОЛЬКО разрешённый список брендов (не весь sitemap).
 *
 * Запуск (tools-контейнер):
 *   npm run scrape:caretobeauty
 *   npm run scrape:caretobeauty -- --brand "Uriage" --max-per-brand 200 --debug
 *
 * НИЧЕГО не пишет в Product. unique: external (source,ean), c2b (ean).
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { isValidEan } from "./farera/barcode-list";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";
import {
  ALLOWED_BRANDS,
  BASE_URL,
  DEFAULT_STORE,
  MAX_SITEMAP_PARTS,
  productSitemapUrl,
  specForBrand,
  type BrandSpec,
} from "./caretobeauty/config";
import { fetchHtml, fetchSitemapXml, FetchError } from "./caretobeauty/client";
import { decodeEntities, parseProduct } from "./caretobeauty/parser";

const SOURCE = "caretobeauty";
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

/* ───────── CLI ───────── */

interface CliArgs {
  brands: BrandSpec[];
  store: string;
  limit: number;
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
  const names = brandVals
    .flatMap((b) => b.split("||"))
    .map((b) => b.trim())
    .filter(Boolean);
  // Дефолт — РОВНО разрешённый список. --brand → резолвим в spec (с slug-map).
  const brands = names.length ? names.map(specForBrand) : ALLOWED_BRANDS;

  const limit = parseInt(String(values.limit), 10);
  const maxPerBrand = parseInt(String(values["max-per-brand"]), 10);
  return {
    brands,
    store: String(values.store),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    maxPerBrand: Number.isFinite(maxPerBrand) && maxPerBrand > 0 ? maxPerBrand : 400,
    debug: Boolean(values.debug),
  };
}

/* ───────── sitemap ───────── */

const LOC_RE = /<loc>([^<]+)<\/loc>/gi;

async function loadProductUrls(store: string): Promise<string[]> {
  const urls: string[] = [];
  for (let part = 1; part <= MAX_SITEMAP_PARTS; part++) {
    let xml: string;
    try {
      xml = await fetchSitemapXml(productSitemapUrl(store, part), log);
    } catch (e) {
      if (e instanceof FetchError && e.status === 404) break;
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

function urlMatchesBrand(url: string, store: string, slugs: string[]): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return slugs.some((s) => path.startsWith(`/${store}/${s}-`));
  } catch {
    return false;
  }
}

/* ───────── stats ───────── */

interface BrandStat {
  brand: string;
  urls: number;
  fetched: number;
  ean: number;
  image: number;
  ingredients: number;
  description: number;
  volume: number;
  saved: number;
}
interface Sample {
  brand: string;
  name: string;
  ean: string;
  img: boolean;
  inci: boolean;
  desc: boolean;
  vol: string | null;
}

async function main(): Promise<void> {
  const args = parseCli();
  log(`[scrape caretobeauty] store=${args.store} brands=${args.brands.length} limit=${args.limit || "∞"} maxPerBrand=${args.maxPerBrand}`);
  log(`scope: ${args.brands.map((b) => `${b.brand}[${b.slugs.join("|")}]`).join(", ")}`);

  await ensureSchema(log);
  const prisma = getPrisma();

  log("[c2b] загружаю product-sitemap…");
  const allUrls = await loadProductUrls(args.store);
  log(`[c2b] всего товаров в sitemap: ${allUrls.length}`);

  const stats: BrandStat[] = [];
  const samples: Sample[] = [];
  let fetchedTotal = 0;

  for (const spec of args.brands) {
    const st: BrandStat = {
      brand: spec.brand, urls: 0, fetched: 0, ean: 0, image: 0,
      ingredients: 0, description: 0, volume: 0, saved: 0,
    };
    const matched = allUrls.filter((u) => urlMatchesBrand(u, args.store, spec.slugs));
    st.urls = matched.length;
    const cap = Math.min(matched.length, args.maxPerBrand);

    for (let i = 0; i < cap; i++) {
      if (args.limit && fetchedTotal >= args.limit) break;
      const url = matched[i];
      try {
        const html = await fetchHtml(url, log);
        st.fetched++;
        fetchedTotal++;
        const p = parseProduct(html, url);

        if (!p.ean || !isValidEan(p.ean)) {
          if (args.debug) log(`[MISS-EAN] ${url} gtin=${p.ean ?? "—"}`);
          continue;
        }
        st.ean++;
        if (p.imageUrl) st.image++;
        if (p.ingredientsRaw) st.ingredients++;
        if (p.description) st.description++;
        if (p.volume) st.volume++;

        // (1) GTIN-поток в общий пул — БЕЗ ИЗМЕНЕНИЙ.
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO scrape.external_product_identifiers (
            id, source, source_query, source_url, ean, product_name,
            brand_guess, normalized_name_key, raw_payload, scraped_at, updated_at
          ) VALUES (
            ${randomUUID()}, ${SOURCE}, ${spec.brand}, ${p.url}, ${p.ean},
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

        // (2) Выделенный полный staging Care to Beauty.
        // COALESCE(NULLIF(...)) — НИКОГДА не затираем непустое поле пустым.
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO scrape.caretobeauty_products (
            ean, brand, product_name, image_url, ingredients_raw, description,
            volume, category, source_url, raw_payload, scraped_at, updated_at
          ) VALUES (
            ${p.ean}, ${p.brand}, ${p.name}, ${p.imageUrl}, ${p.ingredientsRaw},
            ${p.description}, ${p.volume}, ${p.category}, ${p.url},
            ${JSON.stringify(p)}::jsonb, now(), now()
          )
          ON CONFLICT (ean) DO UPDATE SET
            brand           = COALESCE(NULLIF(EXCLUDED.brand,''),           scrape.caretobeauty_products.brand),
            product_name    = COALESCE(NULLIF(EXCLUDED.product_name,''),    scrape.caretobeauty_products.product_name),
            image_url       = COALESCE(NULLIF(EXCLUDED.image_url,''),       scrape.caretobeauty_products.image_url),
            -- description / ingredients_raw — это извлекаемые поля парсера:
            -- при ре-скрейпе ПЕРЕЗАПИСЫВАЕМ (в т.ч. в NULL), чтобы чинить
            -- старые «грязные» значения. NULL у ingredients = INCI не найден.
            ingredients_raw = EXCLUDED.ingredients_raw,
            description     = EXCLUDED.description,
            volume          = COALESCE(NULLIF(EXCLUDED.volume,''),          scrape.caretobeauty_products.volume),
            category        = COALESCE(NULLIF(EXCLUDED.category,''),        scrape.caretobeauty_products.category),
            source_url      = COALESCE(NULLIF(EXCLUDED.source_url,''),      scrape.caretobeauty_products.source_url),
            raw_payload     = EXCLUDED.raw_payload,
            updated_at      = now()
        `);
        st.saved++;

        if (samples.length < 5 && p.name) {
          samples.push({
            brand: spec.brand, name: p.name, ean: p.ean,
            img: !!p.imageUrl, inci: !!p.ingredientsRaw,
            desc: !!p.description, vol: p.volume,
          });
        }
      } catch (e) {
        log(`[FAIL] ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }

    stats.push(st);
    log(
      `[BRAND] "${spec.brand}" urls=${st.urls} fetched=${st.fetched} EAN=${st.ean} ` +
        `img=${st.image} inci=${st.ingredients} desc=${st.description} vol=${st.volume} saved=${st.saved}`,
    );
    if (args.limit && fetchedTotal >= args.limit) {
      log(`[c2b] достигнут общий --limit ${args.limit}, стоп`);
      break;
    }
  }

  /* ── отчёт ── */
  log("");
  log("════════════ Care to Beauty · STAGING REPORT ════════════");
  log(`store=${args.store} · sitemap=${allUrls.length} товаров · base=${BASE_URL}`);
  log("");
  log("по брендам (urls / fetched / EAN / image / ingredients / description / volume):");
  log(
    "  " + "BRAND".padEnd(16) + "urls".padStart(6) + "fetch".padStart(6) +
      "ean".padStart(5) + "img".padStart(5) + "inci".padStart(6) +
      "desc".padStart(6) + "vol".padStart(5),
  );
  const t = { urls: 0, fetched: 0, ean: 0, image: 0, ingredients: 0, description: 0, volume: 0 };
  for (const s of stats) {
    log(
      "  " + s.brand.padEnd(16) + String(s.urls).padStart(6) + String(s.fetched).padStart(6) +
        String(s.ean).padStart(5) + String(s.image).padStart(5) + String(s.ingredients).padStart(6) +
        String(s.description).padStart(6) + String(s.volume).padStart(5),
    );
    t.urls += s.urls; t.fetched += s.fetched; t.ean += s.ean; t.image += s.image;
    t.ingredients += s.ingredients; t.description += s.description; t.volume += s.volume;
  }
  log("  " + "—".repeat(55));
  log(
    "  " + "TOTAL".padEnd(16) + String(t.urls).padStart(6) + String(t.fetched).padStart(6) +
      String(t.ean).padStart(5) + String(t.image).padStart(5) + String(t.ingredients).padStart(6) +
      String(t.description).padStart(6) + String(t.volume).padStart(5),
  );
  log("");
  log("5 примеров строк:");
  if (samples.length === 0) log("  (нет)");
  for (const s of samples) {
    log(
      `  • [${s.brand}] ${trunc(s.name, 44)} | ean=${s.ean} | ` +
        `img=${s.img ? "y" : "n"} inci=${s.inci ? "y" : "n"} desc=${s.desc ? "y" : "n"} vol=${s.vol ?? "—"}`,
    );
  }
  log("");
  log("ПОЛИТИКА: 0 записей в Product. Чистый staging (external_product_identifiers + caretobeauty_products).");
  log("══════════════════════════════════════════════════════════");
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
