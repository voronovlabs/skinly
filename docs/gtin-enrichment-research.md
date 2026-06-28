# GTIN/EAN Enrichment Sources for Skinly — Engineering Research

**Context:** Skinly has ~64,000 cosmetic products with names, brands, INCI, images, and retailer
articles, but is missing **GTIN/EAN**. `barcode-list.ru` is integrated but low-coverage. This report
ranks global sources from a *data-engineering* perspective (can we scrape / integrate / automate /
scale / survive long-term), not as a link list.

**Method & confidence:** Findings come from live page fetches + official docs across 5 parallel
research streams. The fetch tool strips `<script>` tags, so `schema.org` JSON-LD `gtin13` could
**not** be byte-confirmed; where a win is marked **VERIFIED** it was seen in static HTML, a URL
slug, an image filename, or a Shopify `.js` payload (all stronger signals than JSON-LD anyway).
Uncertainties are flagged explicitly.

**Headline:** No single source covers a RU-skewed, EU-pharmacy + K-beauty catalog. The right design
is a **multi-source pipeline** that feeds the universal `scrape.external_product_identifiers` table
(one adapter per `source`) we already built, then runs the cross-language matcher → candidates →
gated merge. Start with one free open dataset + a handful of *structural* first-party scrapers, then
buy commercial gap-fill only for the blocked long tail.

---

## Ranked engineering-evaluation table

Difficulty/Reliability are engineering judgments (Low difficulty = easy to integrate; High
reliability = durable + trustworthy data). "Est. cosmetic products" is order-of-magnitude.

| # | Source | Type | Est. cosmetic products | GTIN coverage | Public API | Hidden API | Price | License | Difficulty | Reliability | Rec. for Skinly | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Open Beauty Facts** | Open dataset | ~66k (barcode-native) | ~100% of its rows (barcode = PK) | Yes (read, no auth) + **bulk dumps** | — | **Free** | ODbL/DbCL (share-alike + attribution) | **Low** | High | **YES** | Use nightly JSONL/Parquet/Mongo dump, not API loop ("1 call = 1 scan"). Test RU/overlap empirically. Backbone. |
| 2 | **Avène / Ducray / A-Derma / La Roche-Posay** (mfr sites) | Manufacturer | Your exact FR brands | **EAN in URL slug** (VERIFIED) | No | — | Free | Site ToS | **Low** | High | **YES** | `\d{13}` regex on `/p/...-<EAN13>-<hash>`; INCI often on same page. Pierre Fabre + L'Oréal. |
| 3 | **Care to Beauty** | Retailer (parapharm) | ~10k, 250+ brands | **`product:gtin` in static `<head>`** (VERIFIED) | No | — | Free | Site ToS | **Low** | High | **YES** | One GET + regex/OG-meta. Exactly LRP/Bioderma/Avène/Uriage + some K-beauty. Lowest-effort win. |
| 4 | **Cocooncenter** | Retailer (parapharm) | ~31k, 1000 brands | **"EAN Code" + INCI in visible HTML table** (VERIFIED) | No (internal AJAX) | partial | Free | Site ToS (`Crawl-delay:10`, block scraper UAs) | Low–Med | High | **YES** | Cleanest visible-HTML EAN+INCI. Use browser UA, polite rate. |
| 5 | **COSRX / SKIN1004** (Shopify) | Manufacturer | Your K-beauty brands | **`variants[].barcode`** via `<product>.js` (VERIFIED) | Yes (Shopify `.js`) | — | Free | Site ToS | **Low** | High | **YES** | Per-product `.js` (collection `products.json` omits barcode). 880x EANs. |
| 6 | **Notino** | Retailer | ~83k (largest) | EAN in CDN image filename + **CJ affiliate feed** | via CDN/feed | Cloudflare | Free (feed needs publisher) | ToS / feed terms | Med | High | **YES** | Biggest breadth. Prefer CJ/Awin feed `ean`; image-filename EAN as fallback. |
| 7 | **dm.de / Rossmann.de** | Retailer (drugstore) | ~20k / ~6k | **EAN-13 in product URL** (VERIFIED scheme) | dm hidden JSON (`gtin`+`dan`) | Akamai (dm) | Free | ToS | Med (dm Akamai; Rossmann blocks ClaudeBot) | High | **YES** | Mass-market brands. dm needs residential proxies; Rossmann SSR-easy but robots disallows Claude UA. |
| 8 | **EAN-Search.org** | Commercial API | 1.2B EAN index | Broad (name/brand level) | Yes | — | Paid (credits; verify tiers) | Proprietary, no bulk storage | Low | Med | **YES (gap-fill)** | brand+name → EAN resolver for the long tail. No deep cosmetic data. |
| 9 | **Keepa** | Commercial (Amazon-backed) | Large (Amazon beauty) | EAN/UPC good fill (Amazon-quality caveats) | Yes (token) | — | €49–€4,499/mo | Proprietary (vs Amazon ToS) | Med | Med–High | **YES (long tail)** | Best durable Amazon-EAN route w/o seller acct. For blocked brands (Dr.Jart+, KIKO, Sesderma, Hada Labo, Some By Mi, Bioderma, CeraVe). |
| 10 | **Verified by GS1** | GS1 registry | Authoritative GTIN/company | Validation only (thin attributes) | Yes (via GS1 MOs) | — | Free lookup / paid batch | **Non-commercial / in-org only — no storage-for-app** | Low | Highest (authoritative) | **YES (validation only)** | Use as checksum + ownership oracle to QA EANs before merge. Never store/redistribute. |
| 11 | Go-UPC | Commercial API | 40M–1B general | General (cosmetics incidental) | Yes | — | $19.95/mo / 5k | Proprietary, per-call | Low | Med | Maybe | Cheap spot-fill; 2 req/s. |
| 12 | UPCitemdb | Commercial API | General aggregator | Incidental | Yes | — | Free 100/day; DEV 20k/day | Proprietary; storage unclear | Low | Med | Maybe | Free tier for tiny gap-fill only. |
| 13 | Barcode Lookup | Commercial API | General | Incidental | Yes | — | ~$99/mo, 100 rpm | Proprietary, reuse-restricted | Low | Med | Maybe | Broad but not beauty-specialized. |
| 14 | Target (RedSky) | Retailer (US) | ~tens of k beauty | **UPC visible in HTML** (VERIFIED) + public-ish API | Yes (RedSky) | — | Free | ToS | Low–Med | Med–High | Maybe | CeraVe/COSRX/K-beauty; cleanest US UPCs. |
| 15 | Walmart | Retailer (US) | Large | UPC+GTIN in official API | Yes (affiliate) | — | Free (affiliate acct) | API terms | Med | High | Maybe | Official Catalog/Lookup API returns gtin. US bias. |
| 16 | iHerb | Retailer | few-k beauty | UPC in specs (VERIFIED exists) | via affiliate feed | Cloudflare+PX | Free (feed) | ToS | High (anti-bot) | Med | Maybe | UPC real but Cloudflare-hard; go via CJ/Awin/Impact feed. |
| 17 | Olive Young Global | Retailer (K-beauty) | tens of k | Maybe in internal `prdtNo` JSON (UNVERIFIED) | internal API | CSRF/CDN | Free | ToS | Med | Med | Spike | Richest K-beauty catalog; do one network-tab spike to confirm EAN field. |
| 18 | Easypara / Newpharma / Pharmacie Lafayette | Retailer (parapharm) | 1k–39k | EAN likely (Magento/Google Merchant feed) — UNVERIFIED surface | feed | DataDome (Easypara) | Free | ToS | Low–Med | Med | Confirm-then-yes | Newpharma *welcomes* ClaudeBot + full sitemaps; verify one PDP `gtin13`/`ean` first. |
| 19 | NIQ Brandbank / 1WorldSync (Syndigo) | Enterprise PIM/GDSN | 50M+ / huge | High, rich attributes | Yes (scoped) | — | $25k–$90k+/yr | Proprietary enterprise | High (onboarding) | High | No (unless budget) | Best quality, wrong cost for a 64k job. |
| 20 | Icecat (Open) | Open-ish catalog | 18M (electronics-heavy) | GTIN-keyed; **thin cosmetics** | Yes (XML/JSON/CSV) | — | Free Open tier | **License bans AI/RAG use** | Low | Med | Caution | GTIN↔name facts only; never feed descriptions to Skinly's AI layer. |
| 21 | Uriage (mfr site) | Manufacturer | Uriage only (FR) | EAN in **image filenames** (VERIFIED, FR-only) | No | — | Free | ToS | Med (fragile) | Med | Partial | Regex over image URLs; international site exposes nothing. |
| 22 | barcode-list.ru | RU barcode DB | RU/CIS | RU-relevant, crowd quality | No | — | Free (scrape) | No clear ToS | Med | Low–Med | Baseline (keep) | Already integrated; RU gap-fill. No API/dump. |
| 23 | Sephora | Retailer | ~13k | **No GTIN in data model** (VERIFIED) | — | Akamai | — | — | High | — | **No** | Keys on internal SKU only. Worst fit. |
| 24 | Amazon (scrape/PA-API) | Retailer | Huge | EAN via SP-API (seller auth); PA-API deprecating 2026-05 | auth only | strongest anti-bot | — | ToS | High | Low | **No** | Use Keepa instead of scraping. |
| 25 | Yuka / Think Dirty / EWG Skin Deep | Beauty apps | large | proprietary | None | private | — | Proprietary; **EWG scores copyright-sensitive** | High | — | **No** | No API; scraping = ToS breach; do not embed their scores. |
| 26 | INCI Beauty / CodeCheck / Cosmethics | Beauty DB (B2B) | EU-strong | good (EU) | **Paid B2B only** | — | Enterprise | Proprietary | Med | Med–High | No (unless partner) | Real coverage but sanctioned route is a paid contract; not free. |
| 27 | Datakick/Brocade · Semantics3 · GS1 GDSN/Digital Link | Misc | small/stale / n/a | low / not outsider-queryable | varies | — | Free / — | varies | — | Low | **No** | Datakick stale (~2020), Semantics3 dormant, GDSN not queryable as outsider. |
| 28 | Stylevana / Jolse / StyleKorean / YesStyle | Retailer (K-beauty) | 10k–large | **No EAN in HTML** (mostly VERIFIED); INCI present | sitemaps/feeds | varies | Free | ToS | Low–High | Med | Content-only | Scrape name+INCI+volume, resolve 880-EAN externally. |

> **Naming-collision warnings** (don't waste time on these): `inciapi.com` / `skincareapi.dev` are
> *unrelated* commercial APIs, **not** INCI Beauty; most "Yuka API" GitHub repos are Open-Food-Facts
> clones or food scrapers, not Yuka's backend; "codecheck" repos are static-analysis tools.

---

## How the big beauty apps actually get barcodes (and why it matters)

- **Open Beauty Facts** is the open backbone. Barcode *is* the primary key; ~66k cosmetics; nightly
  bulk dumps; ODbL.
- **Yuka** started on Open Food Facts, then **forked to its own proprietary DB in Jan 2018**; no
  public/Documented API; reverse-engineering = ToS breach + zero durability.
- **INCI Beauty, CodeCheck, Cosmethics** have real EU coverage but only sell **paid B2B APIs**.
- **EWG Skin Deep / Think Dirty** are editorial hazard DBs with no API and copyright-sensitive
  scores — **do not embed**.

**Takeaway:** there is no free "Yuka API." The legitimate open path everyone ultimately leans on is
OBF + first-party brand/retailer data. Skinly should do the same.

---

## TOP-10 prioritized integration plan

Ordered by value-per-effort for Skinly's specific catalog. Each plugs into the existing
`scrape.external_product_identifiers` (`source`-tagged) + cross-language matcher → candidates → gated
merge. **Nothing auto-writes to `Product`.**

### 1. Open Beauty Facts (bulk dump) — the backbone
- **Why:** Free, legal (ODbL + attribution), barcode-native, ~66k cosmetics, downloadable nightly
  JSONL/Parquet/Mongo. Zero anti-bot. Also enriches images/INCI.
- **Expected GTIN coverage:** High for global/EU brands; **RU overlap unknown — must test** against a
  sample of Skinly barcodes/brands before committing weight to it.
- **Impl complexity:** Low — download dump, filter to cosmetics, join on `dm.name_key`/brand via the
  matcher. New adapter `source='openbeautyfacts'`.
- **Maintenance:** Low — re-pull nightly delta. Stable 12-yr non-profit (minor funding risk).
- **Value:** Highest single source; first pass before paying for anything.

### 2. French dermo-cosmetic manufacturer scrapers (Avène, Ducray, A-Derma, La Roche-Posay)
- **Why:** EAN-13 sits **in the product URL slug** (verified) — exact match for your biggest EU
  pharmacy brands; INCI often on the same page. Free, structural, no keys.
- **Coverage:** Near-complete for these 4 brands' current ranges.
- **Impl:** Low — crawl sitemap, `\d{13}` regex on slug, checksum-validate. One adapter per
  platform (Pierre Fabre pattern shared across 3).
- **Maintenance:** Low — URL scheme is ad-driven (Shopping feeds) so it's durable.
- **Value:** High; precisely your hardest-to-find EU brands, for free.

### 3. Care to Beauty
- **Why:** `product:gtin` in static `<head>` (verified) + benign anti-bot; carries LRP/Bioderma/
  Avène/Uriage + some K-beauty — exactly Skinly's mix. Lowest-effort retailer win.
- **Coverage:** ~10k SKUs across 250+ pharmacy brands.
- **Impl:** Low — one GET + OG-meta regex. `source='caretobeauty'`.
- **Maintenance:** Low (meta feeds their Shopping/Meta ads → stable).
- **Value:** High; broad EU-pharmacy fill in days.

### 4. Cocooncenter
- **Why:** Visible "EAN Code" row **plus full INCI** in server HTML (verified); ~31k products.
- **Coverage:** Wide EU pharmacy/derm range.
- **Impl:** Low–Med — parse spec table; browser UA, `Crawl-delay: 10`.
- **Maintenance:** Low.
- **Value:** High; EAN *and* INCI enrichment together.

### 5. Korean Shopify `.js` (COSRX, SKIN1004; pattern reusable for any Shopify brand)
- **Why:** `variants[].barcode` exposed via per-product `.js` (verified) — free K-beauty 880-EANs.
- **Coverage:** Full current range for Shopify-hosted K-brands; the technique generalizes to any
  Shopify store you encounter.
- **Impl:** Low — `products.json` to enumerate, then per-product `.js` for `barcode`.
- **Maintenance:** Low — Shopify's `.js` contract is stable platform-wide.
- **Value:** High for the K-beauty slice that retailers hide.

### 6. Notino (CJ/Awin feed, image-filename fallback)
- **Why:** Largest catalog (~83k); EAN in CDN image filenames and in the affiliate product feed.
- **Coverage:** Broadest single retailer; strong EU + mass brands.
- **Impl:** Med — preferred path is the CJ/Awin feed (`ean` column) → requires publisher approval;
  fallback regex on `cdn.notinoimg.com` filenames.
- **Maintenance:** Med — feed is clean/stable; scraping path needs Cloudflare handling.
- **Value:** High breadth; good for the general long tail.

### 7. dm.de + Rossmann.de
- **Why:** EAN-13 **in the product URL** (verified) — clean barcode→page mapping for German
  drugstore / mass-market brands (CeraVe, Bioderma, Nivea, etc.).
- **Coverage:** ~20k (dm) + ~6k (Rossmann) mass-market SKUs.
- **Impl:** Med — dm is behind Akamai (needs residential proxies / headless); Rossmann is SSR-easy
  but its `robots.txt` disallows the Claude crawler UA (use a standard browser UA, respect rate).
- **Maintenance:** Med (anti-bot drift on dm).
- **Value:** Med–High for mainstream brands OBF/parapharmacies miss.

### 8. EAN-Search.org (or Go-UPC) — commercial brand+name → EAN resolver
- **Why:** Cheap per-call resolver to fill barcodes the structural sources miss, keyed on the
  brand+name+volume Skinly already has. 1.2B EAN index.
- **Coverage:** Broad but shallow (validates/returns EAN, not deep cosmetic data).
- **Impl:** Low — REST per-call; rate-limited. `source='ean-search'`.
- **Maintenance:** Low; **note proprietary ToS — store EANs in your own records only, don't
  redistribute the dataset.**
- **Value:** Med; converts "we have the name" into "we have the barcode" for the tail.

### 9. Keepa (Amazon-backed) — long-tail / blocked brands
- **Why:** Returns EAN/UPC for beauty without a seller account; durable; covers brands that block
  first-party scraping (Dr.Jart+, KIKO, Sesderma, Hada Labo, Some By Mi, Bioderma, CeraVe).
- **Coverage:** Large (Amazon beauty), with known EAN-quality caveats → confidence-score + validate.
- **Impl:** Med — token API, ASIN/UPC/EAN lookups. Budget €49+/mo.
- **Maintenance:** Med — operates against Amazon ToS (durability risk, but Keepa has lasted years).
- **Value:** Med–High; the practical backbone for the hardest 30–40% of the catalog.

### 10. Verified by GS1 — validation oracle (not storage)
- **Why:** Authoritative GTIN checksum + brand-ownership check to **QA every candidate** before it
  merges into `Product` ("quality over coverage" — never write a wrong EAN).
- **Coverage:** Authoritative validity; thin attributes.
- **Impl:** Low — single-lookup checks on high-confidence candidates only.
- **Maintenance:** Low; **license forbids commercial storage/redistribution — use as a transient
  validation step, persist only a boolean "GS1-valid" flag, not GS1 data.**
- **Value:** High as the final gate that keeps the catalog trustworthy.

---

## Architecture fit & sequencing

```
inn-skin scrape → normalize → EAN ENRICHMENT (multi-source) → matcher → candidates → GS1 validate → gated merge
                                   │
   source-tagged adapters → scrape.external_product_identifiers (source ∈ {openbeautyfacts, caretobeauty,
   cocooncenter, pierre-fabre, shopify, notino, dm, rossmann, ean-search, keepa, barcode-list, …})
```

- **Phase 1 (free, structural):** OBF dump + Pierre Fabre/LRP slug + Care to Beauty + Cocooncenter +
  Korean Shopify. These are low-difficulty, high-reliability, and cover most of your named brands.
- **Phase 2 (breadth):** Notino feed + dm/Rossmann.
- **Phase 3 (paid tail):** EAN-Search/Go-UPC + Keepa for blocked brands.
- **Always:** Verified-by-GS1 checksum/ownership as the merge gate; keep `barcode-list.ru` as RU
  baseline.

### Open items to close before scaling (cheap, high-value)
1. **Empirically measure OBF barcode/brand overlap** against a real sample of Skinly's catalog (RU
   skew is the key unknown).
2. One **headless fetch** each to byte-confirm JSON-LD `gtin13`/EAN on Newpharma, Rossmann, Pharmacie
   Lafayette, Flaconi, and the **Olive Young internal `prdtNo` API** (could become the single richest
   K-beauty barcode source).
3. **Legal check** on whether an exposed enriched dataset triggers ODbL share-alike (internal
   enrichment is fine; re-publishing a derived DB is the trigger).
4. Verify current **EAN-Search / Keepa** pricing tiers and per-source cosmetics EAN fill-rate before
   committing budget.

### Hard "no"s
Sephora (no GTIN in model), Amazon HTML scraping (auth-only API, PA-API deprecating 2026-05),
Yuka/Think Dirty/EWG (no API, ToS + copyright risk), Datakick/Semantics3 (stale/dormant),
GS1 GDSN/Digital Link (not outsider-queryable), Icecat for anything beyond raw GTIN↔name (AI/RAG
license ban).
