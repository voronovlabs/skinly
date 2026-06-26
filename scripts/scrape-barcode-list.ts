/**
 * Skinly · адаптер источника · barcode-list.ru → scrape.external_product_identifiers
 *
 * Это ОДИН из адаптеров EAN-источников. Пишет в УНИВЕРСАЛЬНЫЙ пул
 * scrape.external_product_identifiers с source='barcode-list'. Будущие
 * источники (openfoodfacts, gs1, wb, ozon, goldapple) — это новые такие же
 * адаптеры, пишущие в ту же таблицу с другим `source`; схему менять не надо.
 *
 * Переиспользует готовый клиент/парсер scripts/farera/barcode-list.ts
 * (fetch + retry + parse + checksum-валидация EAN) — своя интеграция НЕ
 * пишется.
 *
 * Запуск (через tools-контейнер):
 *   npm run scrape:barcode-list                       # все бренды по умолчанию
 *   npm run scrape:barcode-list -- --brand "Uriage"
 *   npm run scrape:barcode-list -- --brand "Uriage" --brand "Ducray"
 *
 * НИЧЕГО не пишет в Product. barcode-list.ru — краудсорс → это кандидаты-EAN,
 * не истина. Gold Apple article как EAN НЕ используется нигде.
 */

const SOURCE = "barcode-list";

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import {
  fetchSearchHtml,
  isValidEan,
  parseSearchResults,
  buildSearchUrl,
} from "./farera/barcode-list";
import { BARCODE_LIST_BRANDS } from "./inn-skin/config";
import { closeDb, ensureSchema, getPrisma } from "./inn-skin/storage";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

interface CliArgs {
  brands: string[];
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: { brand: { type: "string", multiple: true } },
  });
  const brandVals = (values.brand as string[] | undefined) ?? [];
  const brands = brandVals
    .flatMap((b) => b.split("||")) // запятые встречаются в брендах, поэтому ||
    .map((b) => b.trim())
    .filter(Boolean);
  return { brands: brands.length ? brands : BARCODE_LIST_BRANDS };
}

interface BrandStat {
  brand: string;
  parsed: number;
  validEan: number;
  saved: number;
  invalidEan: number;
}

async function scrapeBrand(brand: string): Promise<BrandStat> {
  const prisma = getPrisma();
  const url = buildSearchUrl(brand);
  const stat: BrandStat = {
    brand,
    parsed: 0,
    validEan: 0,
    saved: 0,
    invalidEan: 0,
  };

  const html = await fetchSearchHtml(brand, log);
  const candidates = parseSearchResults(html);
  stat.parsed = candidates.length;

  const seen = new Set<string>();
  for (const c of candidates) {
    if (!isValidEan(c.barcode)) {
      stat.invalidEan++;
      continue;
    }
    if (seen.has(c.barcode)) continue;
    seen.add(c.barcode);
    stat.validEan++;

    try {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO scrape.external_product_identifiers (
          id, source, source_query, source_url, ean, product_name,
          brand_guess, normalized_name_key, raw_payload, scraped_at, updated_at
        ) VALUES (
          ${randomUUID()}, ${SOURCE}, ${brand}, ${url}, ${c.barcode}, ${c.name},
          ${brand}, dm.name_key(${c.name}), ${JSON.stringify(c)}::jsonb, now(), now()
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
      stat.saved++;
    } catch (e) {
      log(`[DB FAIL] brand="${brand}" ean=${c.barcode}: ${errMsg(e)}`);
    }
  }
  return stat;
}

async function main(): Promise<void> {
  const args = parseCli();
  log(`[scrape barcode-list] brands=${args.brands.length}`);
  log(`brands: ${args.brands.join(" | ")}`);

  await ensureSchema(log);

  const stats: BrandStat[] = [];
  for (const brand of args.brands) {
    try {
      const s = await scrapeBrand(brand);
      stats.push(s);
      log(
        `[BRAND] "${brand}" parsed=${s.parsed} validEAN=${s.validEan} ` +
          `saved=${s.saved} invalidEAN=${s.invalidEan}`,
      );
    } catch (e) {
      log(`[BRAND FAIL] "${brand}": ${errMsg(e)}`);
      stats.push({ brand, parsed: 0, validEan: 0, saved: 0, invalidEan: 0 });
    }
  }

  log("──────────────────────────────────────────────");
  log("[scrape barcode-list] DONE — EAN-строк по брендам:");
  let total = 0;
  for (const s of stats) {
    log(`  ${s.brand.padEnd(22)} saved=${s.saved} (validEAN=${s.validEan})`);
    total += s.saved;
  }
  log(`  TOTAL saved: ${total}`);
  log("──────────────────────────────────────────────");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(closeDb);
