/**
 * Skinly · audit · public.Ingredient — поиск дублей (READ-ONLY)
 *
 * Запуск:
 *   npm run audit:ingredient-duplicates
 *   npm run audit:ingredient-duplicates -- --tier 1
 *   npm run audit:ingredient-duplicates -- --tier 2 --top 40
 *
 * Что делает:
 *   Только SELECT. Ничего не пишет и не удаляет. Три уровня кластеризации
 *   дублей поверх текущего public."Ingredient":
 *     Tier 0 — точные дубли без учёта регистра/пробелов (lower+trim совпадает).
 *     Tier 1 — loose-normalization: без скобок/%-суффиксов, "/" → пробел,
 *              схлопнутые пробелы (см. loose_norm ниже — логика 1:1 повторяет
 *              dry-run анализ из docs/ingredient-dedup-plan.md).
 *     Tier 2 — кросс-язычные синонимы через порт dm.norm_ingredient_alias()
 *              (см. sql/dm/30_ingredients_canonical.sql) + curated словарь
 *              (см. sql/dm/31_seed_ingredient_aliases.sql) — aqua/water/вода,
 *              parfum/fragrance/отдушка и т.д.
 *
 *   Для каждого кластера с >1 участником печатает: предлагаемый canonical
 *   Ingredient (по эвристике §3.2 в docs/ingredient-dedup-plan.md), сколько
 *   ProductIngredient-связей будет затронуто переносом.
 *
 *   Отдельно — оценка "мусора" (см. isGarbage ниже) с разбивкой по причине.
 *
 * Это read-only инструмент. Реальный merge — scripts/merge-ingredient-duplicates.ts.
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

const prisma = new PrismaClient({ log: ["error", "warn"] });

/* ───────── CLI ───────── */

interface CliArgs {
  tier: number; // 0 | 1 | 2
  top: number;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      tier: { type: "string", default: "2" },
      top: { type: "string", default: "25" },
    },
  });
  const tier = parseInt(String(values.tier), 10);
  const top = parseInt(String(values.top), 10);
  if (![0, 1, 2].includes(tier)) throw new Error("--tier must be 0, 1 or 2");
  if (!Number.isFinite(top) || top <= 0) throw new Error("--top must be a positive integer");
  return { tier, top };
}

/* ───────── Нормализация (см. docs/ingredient-dedup-plan.md §3.3) ───────── */

const GARBAGE_MARKETING_MARKERS = [
  "contains", "may contain", "ingredients:", "composition:", "состав:",
  "внимание", "применение", "способ применения", "хранить", "срок годности",
  "подходит", "рекомендуется", "не содержит", "how to use", "directions",
  "warning", "caution", "net wt", "net weight", "made in", "производитель",
  "дата изготовления", "патент", "patent", "www.", "http",
];

type GarbageReason =
  | "empty" | "numeric-only" | "symbols-only" | "too-short"
  | "marketing-text" | "too-long" | "list-marker" | null;

function isGarbage(inci: string): GarbageReason {
  const s = inci.trim();
  if (s === "") return "empty";
  if (/^[\d.,]+$/.test(s)) return "numeric-only";
  if (/^[^\w\s]+$/.test(s)) return "symbols-only";
  if (s.length <= 1) return "too-short";
  if (/^[a-zA-Zа-яА-Я]{1,2}$/.test(s) && !["bha", "aha", "co", "ci"].includes(s.toLowerCase())) {
    return "too-short";
  }
  const lowered = s.toLowerCase();
  if (GARBAGE_MARKETING_MARKERS.some((m) => lowered.includes(m))) return "marketing-text";
  if (s.length > 80) return "too-long";
  if (/^\d+[.)]?$/.test(s) || /^[+\-*/•·]+$/.test(s)) return "list-marker";
  return null;
}

/** Tier 0: точное совпадение без учёта регистра/пробелов. */
function exactNorm(inci: string): string {
  return inci.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Tier 1: без скобок, %-суффиксов, "/" → пробел, схлопнутые пробелы. */
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

/**
 * Tier 2: порт dm.norm_ingredient_alias() (см. sql/dm/30_ingredients_canonical.sql).
 * Держим шаги идентичными SQL-версии, чтобы оба слоя не расходились семантически.
 */
function dmStyleNorm(inci: string): string {
  let s = inci.trim().toLowerCase().replace(/ё/g, "е");
  // html теги/сущности — Ingredient.inci их не содержит, шаг no-op, оставлен для паритета
  s = s.replace(/\d+(?:[.,]\d+)?\s*%/g, " "); // проценты
  s = s.replace(/[^a-zа-я0-9 ]+/g, " "); // всё, кроме букв/цифр/пробела
  s = s.replace(/\b\d+\b/g, " "); // отдельно стоящие числовые токены
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Curated tier-2 группы — синхронизировано с sql/dm/31_seed_ingredient_aliases.sql. */
const TIER2_SYNONYM_GROUPS: Record<string, string[]> = {
  water: ["aqua", "water", "вода", "eau"],
  fragrance: ["parfum", "fragrance", "отдушка", "ароматизатор"],
  glycerin: ["glycerin", "глицерин"],
};

function tier2GroupKey(normalized: string): string {
  for (const [group, keywords] of Object.entries(TIER2_SYNONYM_GROUPS)) {
    if (keywords.some((k) => normalized.includes(k))) return group;
  }
  return normalized; // не в curated-словаре — используем dm-style norm как ключ
}

/* ───────── canonical selection (см. §3.2) ───────── */

interface IngredientRow {
  id: string;
  inci: string;
  displayNameRu: string;
  displayNameEn: string;
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

/* ───────── main ───────── */

async function main(): Promise<void> {
  const args = parseCli();
  log(`[AUDIT] mode=READ-ONLY tier=${args.tier} top=${args.top}`);

  const rows: IngredientRow[] = (
    await prisma.ingredient.findMany({
      select: {
        id: true,
        inci: true,
        displayNameRu: true,
        displayNameEn: true,
        descriptionRu: true,
        descriptionEn: true,
        safety: true,
        createdAt: true,
        _count: { select: { productLinks: true } },
      },
    })
  ).map((r) => ({
    id: r.id,
    inci: r.inci,
    displayNameRu: r.displayNameRu,
    displayNameEn: r.displayNameEn,
    descriptionRu: r.descriptionRu,
    descriptionEn: r.descriptionEn,
    safety: r.safety,
    createdAt: r.createdAt,
    productCount: r._count.productLinks,
  }));

  log(`[AUDIT] total Ingredient rows: ${rows.length}`);
  log(`[AUDIT] total ProductIngredient links: ${rows.reduce((s, r) => s + r.productCount, 0)}`);

  /* garbage */
  const garbageByReason = new Map<string, { count: number; links: number }>();
  for (const r of rows) {
    const reason = isGarbage(r.inci);
    if (!reason) continue;
    const acc = garbageByReason.get(reason) ?? { count: 0, links: 0 };
    acc.count += 1;
    acc.links += r.productCount;
    garbageByReason.set(reason, acc);
  }
  log("[AUDIT] ── мусор по причине ──");
  let garbageTotal = 0;
  let garbageLinksTotal = 0;
  for (const [reason, acc] of garbageByReason) {
    log(`  ${reason.padEnd(16)} rows=${acc.count.toString().padStart(6)} links=${acc.links}`);
    garbageTotal += acc.count;
    garbageLinksTotal += acc.links;
  }
  log(`  TOTAL garbage rows=${garbageTotal} links=${garbageLinksTotal}`);

  /* clustering */
  const normFn = args.tier === 0 ? exactNorm : args.tier === 1 ? looseNorm : dmStyleNorm;
  const keyFn = args.tier === 2 ? (s: string) => tier2GroupKey(normFn(s)) : normFn;

  const clusters = new Map<string, IngredientRow[]>();
  for (const r of rows) {
    if (isGarbage(r.inci)) continue; // мусор кластеризуем отдельно, не мешаем с реальными синонимами
    const key = keyFn(r.inci);
    if (!key) continue;
    const bucket = clusters.get(key) ?? [];
    bucket.push(r);
    clusters.set(key, bucket);
  }

  const dupClusters = [...clusters.entries()].filter(([, rows]) => rows.length > 1);
  const totalVariants = dupClusters.reduce((s, [, rows]) => s + rows.length, 0);
  const totalRemovable = dupClusters.reduce((s, [, rows]) => s + rows.length - 1, 0);
  const totalLinksAffected = dupClusters.reduce(
    (s, [, rows]) => s + rows.reduce((ss, r) => ss + r.productCount, 0),
    0,
  );

  log(`[AUDIT] ── Tier ${args.tier} дубли ──`);
  log(`  clusters:          ${dupClusters.length}`);
  log(`  variant rows:      ${totalVariants}`);
  log(`  removable on merge:${totalRemovable}`);
  log(`  links affected:    ${totalLinksAffected} (repoint при merge)`);

  const byImpact = [...dupClusters].sort(
    (a, b) =>
      b[1].reduce((s, r) => s + r.productCount, 0) - a[1].reduce((s, r) => s + r.productCount, 0),
  );

  log(`[AUDIT] ── топ-${args.top} кластеров по числу связей ──`);
  for (const [key, group] of byImpact.slice(0, args.top)) {
    const canonical = pickCanonical(group);
    const links = group.reduce((s, r) => s + r.productCount, 0);
    log(
      `  "${key}" variants=${group.length} links=${links} → canonical="${canonical.inci}" (id=${canonical.id})`,
    );
  }

  log("[AUDIT] DONE — ничего не изменено. Для merge см. scripts/merge-ingredient-duplicates.ts --dry-run");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
