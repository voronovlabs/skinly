# BeautyScan — Investor Deck Audit & Rebuild

*Prepared from three sources: the original investor presentation (`Beautyscan_v2_26.01.pdf`, 10 slides), the `skinly` web codebase, and the `skinly-mobile` codebase. No metrics were invented; every product claim below is traceable to code. Where the deck states a figure with no source, it is flagged.*

---

## 1. Executive Summary

The original 10-slide deck tells a clean story but **systematically understates the company**. It positions BeautyScan as an idea-stage startup with "a working prototype on Laravel" and a roadmap whose first 0–6-month milestone is *"build native iOS and Android apps."*

The codebases tell a different story. There is no Laravel anywhere — the web product is a **production-grade Next.js 15 / React 19 / Prisma / PostgreSQL application**, and the **native iOS and Android app already exists** as a React Native / Expo project with real Xcode and Gradle builds and a registered bundle id (`com.skinly.mobileapp`). Both clients share one backend through a published REST API. A working, deterministic ingredient-compatibility engine, a barcode scanner, full auth + guest mode, an onboarding wizard, and bilingual RU/EN are all implemented.

In short: **the deck describes an idea; the repos contain a near-launch, two-platform product.** The single highest-impact change is to stop selling a prototype and start selling executed, de-risked engineering.

The rebuild also **corrects two over-claims** that would fail diligence: the deck markets "ML personalization / collaborative filtering" as if shipped, but the engine is deterministic rules today (ML is an unshipped roadmap phase); and several market figures ($7.7B, 50M, 10M) appear with no source. The revised deck reframes ML honestly as a data-fed roadmap and explicitly flags unsourced figures.

**Deliverables:** a revised 15-slide deck in Russian (primary) and English, each as `.pptx` and `.pdf`, preserving the original peach / maroon-serif beauty-tech identity.

---

## 2. Investor Audit (slide by slide)

Lenses applied: **angel** (is the story believable and the team credible?), **seed** (is there product, a wedge, and a plausible GTM?), **venture partner** (is there a moat and a path to a fundable round?).

| # | Original slide | What works | What's weak / unclear | What an investor questions | Verdict |
|---|---|---|---|---|---|
| 1 | **Cover** — "Платформа персонализированного подбора косметики" | Clear one-line positioning; clean visual; on-brand | No signal of stage or traction; reads idea-stage | "Is this live or a concept?" | **Modify** — add "live product / iOS+Android" signal |
| 2 | **Problem** — 2–3 hrs/mo, 40% bad buys, $7.7B | Concrete, relatable pain; good stat treatment | All three figures unsourced; $7.7B mixes market-size into a behavior list | "Where do 40% and $7.7B come from?" | **Keep + flag sources** |
| 3 | **Solution** — Scan / Assess / Buy | Strong, memorable 3-step; "analysis + purchase" wedge is the real insight | Buried; doesn't say the loop *already works* | "Does this exist or is it a concept flow?" | **Keep, strengthen** |
| 4 | **Data & moat** — DB, ML engine, network effect, IP | Right instinct (data flywheel = moat) | Claims "ML engine / collaborative filtering" — **not built**; "IP registration" has no evidence | "Show me the ML." Diligence breaks the claim | **Modify — make honest** |
| 5 | **Competition** — vs Yuka / Goldapple / Pharmacies | Excellent framing; the "only one joining analysis to purchase" wedge is genuinely differentiated | "ML-personalization ✓" overstates; "20K+" catalog understates reality (code targets ~62k) | "You claim ML you don't have." | **Keep, correct two rows** |
| 6 | **Market & model** — TAM/SAM/SOM, freemium + 299₽ | Clean funnel; credible freemium + affiliate + Premium | TAM/SAM/SOM unsourced; SOM "100K–1M" is very wide | "What's the basis for 50M / 10M?" | **Keep + flag sources** |
| 7 | **"Working prototype"** — "Laravel web prototype", scanner, 20K DB, MVP | Honest intent to show progress | **Factually wrong stack (Laravel)**; "prototype" massively undersells a deployed Next.js app + native app | "Your own deck says prototype — why fund a prototype?" | **Replace** with real MVP/architecture slides |
| 8 | **Team** — CEO / CTO / Data analyst | Concise, covers core functions; not over-personalized (good) | Generic; no proof of execution | "Can they ship?" (the repos answer this — deck doesn't) | **Keep, tie to execution** |
| 9 | **Roadmap** — 0–6 mo *build native apps*, 6–12 scale, 12–18 expand | Clear ambition arc | **Presents already-shipped work as future** (native apps, scanner, monetization tests) | "You're raising to build what you've built?" | **Rebuild** (Done / In progress / Next / Vision) |
| 10 | **Closing** — new standard, 3 pillars, thanks | Good summary pillars | No explicit ask, no figures, no next step | "What are you actually asking for?" | **Keep + add real Ask slide before it** |

**Cross-cutting gaps an investor would flag:** no explicit fundraising ask (amount, use of funds, milestones); no "what's built" proof; no architecture; no traction/status slide (even an honest pre-launch one); ML claimed but absent.

---

## 3. Presentation vs Product Reality

**Verified product reality (from code):**

- **Web (`skinly`):** Next.js 15.1.6, React 19, TypeScript 5.7.3, Prisma 6.2.1, PostgreSQL 16, Tailwind v4. Custom JWT-cookie auth (jose) + bcrypt + guest mode; edge middleware. Deployed via Caddy + Docker Compose (domain `skinly.msvoronov.com` referenced in code/config). Public REST API `/api/v1` (auth, products list/detail, categories, profile) — Bearer-token contract for mobile clients.
- **Compatibility engine:** **deterministic**, pure function, server- and client-safe. ~9 rules (sensitivity, skin type, goals, avoid-list), INCI knowledge base of ~41 ingredients, 0–100 score with diminishing-returns formula, verdict (excellent / good / mixed / risky), per-ingredient findings, and a `lowConfidence` guard. Plus a contextual layer (time-of-day greeting, Open-Meteo weather, ~14 tip rules). **No ML and no LLM are wired** (an Anthropic explanation path is feature-flagged but inactive).
- **Data pipeline:** Russian National Catalog scraper → normalizer → Postgres (idempotent, JSONL + DB dual-write). Code and API comments reference a **~62k-product** Postgres catalog served to mobile; ~100 hand-curated demo products back guest mode. *(Live DB row-count cannot be verified from a static repo and should be confirmed.)*
- **Mobile (`skinly-mobile`):** Expo SDK 51, React Native 0.74, TypeScript, expo-router, zustand, ky, TanStack Query, expo-camera. **Real `android/` (Gradle) and `ios/` (Xcode) projects**, bundle id `com.skinly.mobileapp`, icons/splash, EAS build profiles — configured for store submission. ~20 screens (auth, onboarding wizard, tabbed dashboard/catalog/history/favorites/profile, barcode scanner, product detail). Consumes the same `/api/v1` backend (products live; auth/profile flag-configurable). Premium beige+lavender theme ported from the web tokens.
- **i18n:** RU/EN, 300+ keys. **Maturity:** two codebases, ~250 source files combined; web ~49 commits. No automated test suite yet.

### A) Features that exist but are missing from the deck
1. A **production-deployed web app** (not a prototype).
2. A **native iOS + Android app** with real builds, ready for submission — the deck lists this as *future* work.
3. A **shared REST API / single backend** powering both clients (strong execution + cost story).
4. **Auth + guest mode + guest→user migration** — a complete account system.
5. A **5-step onboarding wizard** and account gate.
6. The **deterministic compatibility engine** with a real INCI knowledge base (the actual "AI/analysis" asset).
7. A **contextual layer** (time/weather-driven tips).
8. **Bilingual RU/EN** across both platforms.
9. A **barcode scanner working on web *and* native** (BarcodeDetector + zxing fallback; expo-camera).
10. A **catalog ingestion pipeline** from the Russian National Catalog.

### B) Achievements that are understated
- "20K+ catalog" — code targets **~62k** products.
- "Working prototype" — actually **deployed in production + a second native client**.
- "Scanner tested" — actually **shipped on two platforms**.

### C) Statements that are outdated / inaccurate
- **"Laravel web prototype"** — there is no Laravel; the stack is **Next.js 15 + Prisma + Postgres**. This is a factual error and the most damaging line in the deck.
- **Roadmap 0–6 mo "develop native iOS/Android apps"** — already built.
- **"MVP ready for implementation"** — already implemented and deployed.

### D) Statements that make the company look earlier-stage than it is
- The entire "Не идея, а прототип / Not an idea, a prototype" framing.
- A roadmap that schedules shipped work as future milestones.
- A generic team slide that doesn't claim the (real) execution track record.

### Over-claims that must be corrected (the other direction)
- **"ML engine / collaborative filtering / ML-personalization ✓"** — not built. Today it's deterministic rules. Reframed in the rebuild as: deterministic engine **now**, ML **next**, fed by a genuine data flywheel.
- **"IP registration of the database"** — no evidence; softened to "code, pipeline and knowledge base are core assets; formal IP planned."
- **$7.7B / 50M / 10M / 100K–1M** — no sources in the deck; flagged for verification.

---

## 4. Key Recommendations

1. **Lead with the product, not the pitch.** Move "what's built" to the front; replace "prototype" language everywhere with "live product on two platforms."
2. **Fix the Laravel error immediately** — it is the single most credibility-damaging line and trivially disproved in diligence.
3. **Reframe ML honestly.** Sell the deterministic engine that works today + the data flywheel that earns ML later. Don't claim ML you don't have.
4. **Rebuild the roadmap into Done / In progress / Next / Vision** so shipped work counts as de-risking, not as the thing you're raising to do.
5. **Add the missing investor slides:** Working MVP, Product Tour (screenshots), Architecture, Honest Traction/Status, and a structured Ask.
6. **Flag every unsourced figure** and prepare the sourcing before fund meetings ($7.7B, 50M, 10M, 62k live count).
7. **Keep the visual identity** (peach / maroon serif) — it's strong and on-brand; modernize spacing and hierarchy rather than redesign.
8. **Keep the team slide lean** and connect it to the demonstrated ability to ship two products.

---

## 5. The Revised Presentation (15 slides)

| # | Slide | Purpose | New / changed |
|---|---|---|---|
| 1 | Cover | Positioning + "live product, iOS/Android" signal | Changed |
| 2 | Problem | Same pain, sources flagged | Kept + flag |
| 3 | Solution — 3 steps | The analysis→purchase wedge | Kept, strengthened |
| 4 | **Not an idea — a working product** | Web (prod) + native app + capability pills | **New (replaces "prototype")** |
| 5 | **Product tour** | 6-frame screenshot story (onboarding→scan→AI→compatibility→catalog→recs) | **New — drop in real screenshots** |
| 6 | **Architecture** | One backend, two platforms; real stack | **New** |
| 7 | **Compatibility engine** | Honest "works today" vs "roadmap" | **New / corrects ML claim** |
| 8 | Data & moat | Catalog pipeline, INCI base, network effect | Modified (honest IP, 62k note) |
| 9 | Competition | Same table, two rows corrected | Kept, corrected |
| 10 | Market & model | TAM/SAM/SOM + freemium/Premium | Kept + flag |
| 11 | **Traction / status** | Execution shipped; honest on what's missing | **New** |
| 12 | Roadmap | Done / In progress / Next / Vision | Rebuilt |
| 13 | Team | Lean, execution-tied | Kept |
| 14 | **The Ask** | Round size, use of funds, goals — with `[placeholders]` | **New** |
| 15 | Closing | Vision + 3 pillars | Kept |

**Screenshot strategy (slide 5).** Recommended sequence for a <30-second product story, in priority order: **Onboarding → Barcode scan → AI/ingredient analysis → Personalized compatibility verdict → Catalog → Recommendations.** Show real device frames; avoid login/empty/settings screens. Each frame on slide 5 is a labelled placeholder ready for a real PNG.

**Open items requiring your input** (intentionally left as `[placeholders]`, not invented): round size and valuation; use-of-funds split; target user count; runway; and confirmation of the live catalog row-count and the market-size sources.

---

*Files delivered: `BeautyScan_Investor_Deck_RU.pptx/.pdf`, `BeautyScan_Investor_Deck_EN.pptx/.pdf`, and this analysis.*
