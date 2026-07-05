/**
 * Skinly · merge · public.Ingredient — безопасный мерж дублей
 *
 * Запуск:
 *   npm run merge:ingredient-duplicates -- --tier 0                # dry-run (по умолчанию)
 *   npm run merge:ingredient-duplicates -- --tier 0 --apply         # реальный merge
 *   npm run merge:ingredient-duplicates -- --tier 1 --apply --limit 50
 *
 * dry-run — режим по умолчанию, ничего не пишет. --apply обязателен явно,
 * и всегда вместе с конкретным --tier (нельзя смержить всё разом).
 *
 * Что делает (см. docs/ingredient-dedup-plan.md за полным планом):
 *   1. Строит кластеры дублей тем же алгоритмом, что audit-ingredient-duplicates.ts
 *      (Tier 0 — точные дубли без регистра; Tier 1 — loose-normalization;
 *      Tier 2 — curated кросс-язычные синонимы, порт dm.norm_ingredient_alias()).
 *   2. На каждый кластер выбирает canonical Ingredient (существующая строка,
 *      id НЕ меняется и НЕ создаётся новый — см. pickCanonical).
 *   3. Для каждого duplicate в кластере переносит ProductIngredient:
 *        - нет коллизии PK (productId,ingredientId) → UPDATE ingredientId,
 *          position/concentration НЕ трогаются;
 *        - есть коллизия (товар уже ссылается на canonical И на duplicate) →
 *          оставляем строку с меньшим position, вторую удаляем, полный снимок
 *          удалённой строки уходит в audit.ingredient_merge_action.dropped_rows_json.
 *   4. Только после того, как у duplicate не осталось ни одной ProductIngredient
 *      строки, удаляет сам Ingredient (иначе упрётся в onDelete: Restrict).
 *   5. Каждый кластер — отдельная prisma.$transaction (атомарность на кластер,
 *      идемпотентно — повторный запуск найдёт duplicate уже удалённым и пропустит).
 *
 * НЕ делает:
 *   - не трогает Product;
 *   - не меняет concentration ни у одной строки;
 *   - не меняет Ingredient.id (только выбирает существующий как canonical);
 *   - не удаляет "мусорные" Ingredient без явного --include-garbage
 *     (см. docs/ingredient-dedup-plan.md §3.5 — мусор мержится в sentinel
 *     "__junk__", а не удаляется).
 *
 * Аудит: схема `audit` создаётся автоматически (CREATE TABLE IF NOT EXISTS,
 * это не Prisma-миграция — аддитивная raw-SQL схема, тот же подход, что и
 * sql/dm/*). Каждый прогон пишет audit.ingredient_merge_run +
 * audit.ingredient_merge_action + audit.ingredient_alias_map.
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const prisma = new PrismaClient({ log: ["error", "warn"] });

/* ───────── CLI ───────── */

interface CliArgs {
  tier: number;
  apply: boolean;
  limit: number; // 0 = без лимита; кластеров, не строк
  includeGarbage: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      tier: { type: "string" },
      apply: { type: "boolean", default: false },
      limit: { type: "string", default: "0" },
      "include-garbage": { type: "boolean", default: false },
    },
  });
  if (values.tier === undefined) {
    throw new Error("--tier is required (0, 1 or 2) — см. docs/ingredient-dedup-plan.md §3.3");
  }
  const tier = parseInt(String(values.tier), 10);
  const limit = parseInt(String(values.limit), 10);
  if (![0, 1, 2].includes(tier)) throw new Error("--tier must be 0, 1 or 2");
  if (!Number.isFinite(limit) || limit < 0) throw new Error("--limit must be >= 0");
  return {
    tier,
    apply: Boolean(values.apply),
    limit,
    includeGarbage: Boolean(values["include-garbage"]),
  };
}

/* ───────── нормализация — идентична audit-ingredient-duplicates.ts ───────── */

const GARBAGE_MARKETING_MARKERS = [
  "contains", "may contain", "ingredients:", "composition:", "состав:",
  "внимание", "применение", "способ применения", "хранить", "срок годности",
  "подходит", "рекомендуется", "не содержит", "how to use", "directions",
  "warning", "caution", "net wt", "net weight", "made in", "производитель",
  "дата изготовления", "патент", "patent", "www.", "http",
];

function isGarbage(inci: string): boolean {
  const s = inci.trim();
  if (s === "") return true;
  if (/^[\d.,]+$/.test(s)) return true;
  if (/^[^\w\s]+$/.test(s)) return true;
  if (s.length <= 1) return true;
  if (/^[a-zA-Zа-яА-Я]{1,2}$/.test(s) && !["bha", "aha", "co", "ci"].includes(s.toLowerCase())) return true;
  const lowered = s.toLowerCase();
  if (GARBAGE_MARKETING_MARKERS.some((m) => lowered.includes(m))) return true;
  if (s.length > 80) return true;
  if (/^\d+[.)]?$/.test(s) || /^[+\-*/•·]+$/.test(s)) return true;
  return false;
}

function exactNorm(inci: string): string {
  return inci.trim().toLowerCase().replace(/\s+/g, " ");
}

function looseNorm(inci: string): string {
  let s = inci.trim().toLowerCase();
  s = s.replace(/[™®©]/g, "");
  const beforeParen = s.split("(")[0]?.trim() ?? "";
  s = beforeParen || s;
  s = s.replace(/[\d.,]+\s*%/g, "").trim();
  s = s.replace(/[/\\]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function dmStyleNorm(inci: string): string {
  let s = inci.trim().toLowerCase().replace(/ё/g, "е");
  s = s.replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
  s = s.replace(/[^a-zа-я0-9 ]+/g, " ");
  s = s.replace(/\b\d+\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const TIER2_SYNONYM_GROUPS: Record<string, string[]> = {
  water: ["aqua", "water", "вода", "eau"],
  fragrance: ["parfum", "fragrance", "отдушка", "ароматизатор"],
  glycerin: ["glycerin", "глицерин"],
};

function tier2GroupKey(normalized: string): string {
  for (const [group, keywords] of Object.entries(TIER2_SYNONYM_GROUPS)) {
    if (keywords.some((k) => normalized.includes(k))) return group;
  }
  return normalized;
}

/* ───────── canonical selection ───────── */

interface IngredientRow {
  id: string;
  inci: string;
  descriptionRu: string | null;
  descriptionEn: string | null;
  safety: string;
  productCount: number;
  createdAt: Date;
}

function pickCanonical(rows: IngredientRow[]): IngredientRow {
  const withDesc = rows.filter((r) => r.descriptionRu || r.descriptionEn);
  if (withDesc.length > 0) return sortStable(withDesc)[0];
  const withSafety = rows.filter((r) => r.safety !== "NEUTRAL");
  if (withSafety.length > 0) return sortStable(withSafety)[0];
  return sortStable(rows)[0];
}

function sortStable(rows: IngredientRow[]): IngredientRow[] {
  return [...rows].sort((a, b) => {
    if (b.productCount !== a.productCount) return b.productCount - a.productCount;
    if (a.createdAt.getTime() !== b.createdAt.getTime())
      return a.createdAt.getTime() - b.createdAt.getTime();
    return a.inci.length - b.inci.length;
  });
}

/* ───────── audit schema (additive raw SQL, не Prisma-миграция) ───────── */

async function ensureAuditSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS audit`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS audit.ingredient_merge_run (
      id          bigserial PRIMARY KEY,
      started_at  timestamptz NOT NULL DEFAULT now(),
      mode        text NOT NULL,
      tier        int NOT NULL,
      notes       text
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS audit.ingredient_merge_action (
      id                bigserial PRIMARY KEY,
      run_id            bigint NOT NULL REFERENCES audit.ingredient_merge_run(id),
      cluster_key       text NOT NULL,
      duplicate_id      text NOT NULL,
      duplicate_inci    text NOT NULL,
      canonical_id      text NOT NULL,
      canonical_inci    text NOT NULL,
      links_repointed   int NOT NULL DEFAULT 0,
      links_dropped_dup int NOT NULL DEFAULT 0,
      dropped_rows_json jsonb,
      applied           boolean NOT NULL DEFAULT false,
      created_at        timestamptz NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS audit.ingredient_alias_map (
      alias_norm     text NOT NULL,
      source_inci    text NOT NULL,
      canonical_id   text NOT NULL,
      first_seen_run bigint REFERENCES audit.ingredient_merge_run(id),
      PRIMARY KEY (alias_norm, source_inci)
    )
  `);
}

/* ───────── main ───────── */

interface Stats {
  clustersProcessed: number;
  linksRepointed: number;
  linksDroppedDup: number;
  ingredientsDeleted: number;
  ingredientsSkippedGarbage: number;
}

function emptyStats(): Stats {
  return {
    clustersProcessed: 0,
    linksRepointed: 0,
    linksDroppedDup: 0,
    ingredientsDeleted: 0,
    ingredientsSkippedGarbage: 0,
  };
}

async function main(): Promise<void> {
  const args = parseCli();
  const mode = args.apply ? "APPLY" : "DRY-RUN";
  log(`[MERGE] mode=${mode} tier=${args.tier} limit=${args.limit || "∞"} include-garbage=${args.includeGarbage}`);
  if (!args.apply) {
    log("[MERGE] dry-run: ничего не будет записано. Добавьте --apply для реального мержа.");
  }

  const rawRows = await prisma.ingredient.findMany({
    select: {
      id: true,
      inci: true,
      descriptionRu: true,
      descriptionEn: true,
      safety: true,
      createdAt: true,
      _count: { select: { productLinks: true } },
    },
  });

  const rows: IngredientRow[] = rawRows.map((r) => ({
    id: r.id,
    inci: r.inci,
    descriptionRu: r.descriptionRu,
    descriptionEn: r.descriptionEn,
    safety: r.safety,
    createdAt: r.createdAt,
    productCount: r._count.productLinks,
  }));

  const normFn = args.tier === 0 ? exactNorm : args.tier === 1 ? looseNorm : dmStyleNorm;
  const keyFn = args.tier === 2 ? (s: string) => tier2GroupKey(normFn(s)) : normFn;

  const clusters = new Map<string, IngredientRow[]>();
  for (const r of rows) {
    if (!args.includeGarbage && isGarbage(r.inci)) continue;
    const key = keyFn(r.inci);
    if (!key) continue;
    const bucket = clusters.get(key) ?? [];
    bucket.push(r);
    clusters.set(key, bucket);
  }

  let dupClusters = [...clusters.entries()].filter(([, g]) => g.length > 1);
  if (args.limit > 0) dupClusters = dupClusters.slice(0, args.limit);

  log(`[MERGE] clusters to process: ${dupClusters.length}`);

  const stats = emptyStats();
  let runId: bigint | null = null;

  if (args.apply) {
    await ensureAuditSchema();
    const inserted = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `INSERT INTO audit.ingredient_merge_run (mode, tier, notes) VALUES ($1, $2, $3) RETURNING id`,
      mode,
      args.tier,
      `scripts/merge-ingredient-duplicates.ts --tier ${args.tier}`,
    );
    runId = inserted[0].id;
    log(`[MERGE] audit run id=${runId}`);
  }

  for (const [key, group] of dupClusters) {
    const canonical = pickCanonical(group);
    const duplicates = group.filter((r) => r.id !== canonical.id);

    log(`[MERGE] cluster "${key}" → canonical="${canonical.inci}" (${canonical.id}), duplicates=${duplicates.length}`);

    if (!args.apply) {
      for (const dup of duplicates) {
        log(`  [dry-run] would repoint ${dup.productCount} link(s) from "${dup.inci}" (${dup.id}) → ${canonical.id}, then delete duplicate`);
      }
      stats.clustersProcessed += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      for (const dup of duplicates) {
        const dupLinks = await tx.productIngredient.findMany({
          where: { ingredientId: dup.id },
        });

        let repointed = 0;
        let droppedDup = 0;
        const droppedSnapshots: unknown[] = [];

        for (const link of dupLinks) {
          const collision = await tx.productIngredient.findUnique({
            where: {
              productId_ingredientId: {
                productId: link.productId,
                ingredientId: canonical.id,
              },
            },
          });

          if (!collision) {
            await tx.productIngredient.update({
              where: {
                productId_ingredientId: { productId: link.productId, ingredientId: dup.id },
              },
              data: { ingredientId: canonical.id },
            });
            repointed += 1;
            continue;
          }

          // Коллизия PK: оставляем строку с меньшим position (раньше в исходном
          // INCI-списке), вторую удаляем — снимок в audit для возможного отката.
          const [keep, drop] =
            collision.position <= link.position ? [collision, link] : [link, collision];

          if (drop === link) {
            droppedSnapshots.push({
              productId: link.productId,
              ingredientId: dup.id,
              position: link.position,
              concentration: link.concentration?.toString() ?? null,
              reason: "pk-collision-with-canonical",
            });
            await tx.productIngredient.delete({
              where: {
                productId_ingredientId: { productId: link.productId, ingredientId: dup.id },
              },
            });
          } else {
            droppedSnapshots.push({
              productId: collision.productId,
              ingredientId: canonical.id,
              position: collision.position,
              concentration: collision.concentration?.toString() ?? null,
              reason: "pk-collision-replaced-by-duplicate-with-lower-position",
            });
            await tx.productIngredient.delete({
              where: {
                productId_ingredientId: {
                  productId: collision.productId,
                  ingredientId: canonical.id,
                },
              },
            });
            await tx.productIngredient.update({
              where: {
                productId_ingredientId: { productId: link.productId, ingredientId: dup.id },
              },
              data: { ingredientId: canonical.id },
            });
          }
          void keep;
          droppedDup += 1;
        }

        const remaining = await tx.productIngredient.count({ where: { ingredientId: dup.id } });
        let deleted = false;
        if (remaining === 0) {
          await tx.ingredient.delete({ where: { id: dup.id } });
          deleted = true;
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO audit.ingredient_merge_action
             (run_id, cluster_key, duplicate_id, duplicate_inci, canonical_id, canonical_inci,
              links_repointed, links_dropped_dup, dropped_rows_json, applied)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
          runId,
          key,
          dup.id,
          dup.inci,
          canonical.id,
          canonical.inci,
          repointed,
          droppedDup,
          JSON.stringify(droppedSnapshots),
          deleted,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO audit.ingredient_alias_map (alias_norm, source_inci, canonical_id, first_seen_run)
           VALUES ($1,$2,$3,$4) ON CONFLICT (alias_norm, source_inci) DO NOTHING`,
          key,
          dup.inci,
          canonical.id,
          runId,
        );

        stats.linksRepointed += repointed;
        stats.linksDroppedDup += droppedDup;
        if (deleted) stats.ingredientsDeleted += 1;
        else {
          log(`  [WARN] "${dup.inci}" (${dup.id}) not deleted — ${remaining} link(s) still remain (unexpected, needs review)`);
        }
      }
    });

    stats.clustersProcessed += 1;
  }

  log("──────────────────────────────────────────────");
  log(`[MERGE] DONE mode=${mode} tier=${args.tier}`);
  log(`  clusters processed:     ${stats.clustersProcessed}`);
  log(`  links repointed:        ${stats.linksRepointed}`);
  log(`  links dropped (dup PK): ${stats.linksDroppedDup}`);
  log(`  ingredients deleted:    ${stats.ingredientsDeleted}`);
  if (runId !== null) log(`  audit run id:           ${runId}`);
  if (!args.apply) {
    log("  Это был dry-run. Ничего не записано. Повторите с --apply для реального мержа.");
  }
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
