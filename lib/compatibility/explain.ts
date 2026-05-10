/**
 * Explain layer — превращает engine result в UI-shape:
 *   - per-ingredient `IngredientFinding` (для IngredientCard)
 *   - rows для CompatibilityTable (skin type / sensitivity / concerns / avoided)
 *
 * Никаких строк-переводов — только i18n keys + args. Перевод делает компонент.
 */

import type {
  AvoidedIngredient,
  SkinConcern,
} from "@/lib/types";
import type {
  CompatibilityProfile,
  CompatibilityRowComputed,
  IngredientFact,
  IngredientFinding,
  IngredientSafety,
  RuleHit,
} from "./types";

/* ───────── Per-ingredient findings ───────── */

export function buildIngredientFindings(
  facts: readonly IngredientFact[],
  hits: readonly RuleHit[],
): IngredientFinding[] {
  // Сгруппировать hits по inci → быстрый lookup.
  const byInci = new Map<string, RuleHit[]>();
  for (const h of hits) {
    if (!h.inci) continue;
    const arr = byInci.get(h.inci) ?? [];
    arr.push(h);
    byInci.set(h.inci, arr);
  }

  return facts.map<IngredientFinding>((f) => {
    const related = byInci.get(f.inci) ?? [];
    const evaluated = evaluateSafety(f, related);
    return {
      inci: f.inci,
      position: f.position,
      kbId: f.kbId,
      evaluatedSafety: evaluated,
      shortLabelKey: shortLabelKeyFor(evaluated),
      // Описание — общий ключ. UI может расширить позже до per-id описаний.
      descriptionKey: f.kbId
        ? `compatibility.ingredients.${f.kbId}.description`
        : undefined,
    };
  });
}

/**
 * Safety с учётом профиля:
 *   - hardWarning (avoidedFlag, sensitiveTrigger, comedogenic on acne) → danger
 *   - просто warning → caution
 *   - есть positive → beneficial
 *   - иначе baseSafety
 */
function evaluateSafety(
  f: IngredientFact,
  hits: readonly RuleHit[],
): IngredientSafety {
  const hasHard = hits.some(
    (h) =>
      h.kind === "warning" &&
      (h.key === "compatibility.reasons.avoidedFlag" ||
        h.key === "compatibility.reasons.sensitiveTrigger"),
  );
  if (hasHard) return "danger";

  const hasWarning = hits.some((h) => h.kind === "warning");
  const hasPositive = hits.some((h) => h.kind === "positive");

  if (hasPositive && !hasWarning) return "beneficial";
  if (hasWarning && !hasPositive) return "caution";
  if (hasPositive && hasWarning) return "caution"; // спорно → caution
  return f.baseSafety;
}

function shortLabelKeyFor(s: IngredientSafety): string {
  return `compatibility.tags.${s}`;
}

/* ───────── Compatibility rows ───────── */

interface RowsInput {
  profile: CompatibilityProfile;
  matchedConcerns: SkinConcern[];
  triggeredAvoided: AvoidedIngredient[];
  warnings: readonly RuleHit[];
  positives: readonly RuleHit[];
}

/**
 * Строки таблицы «Совместимость с кожей». Готовые i18n-keys для лейбла и
 * caption. Statuses совпадают с тем, что умеет рендерить CompatibilityTable.
 */
export function buildRows({
  profile,
  matchedConcerns,
  triggeredAvoided,
  warnings,
  positives,
}: RowsInput): CompatibilityRowComputed[] {
  const rows: CompatibilityRowComputed[] = [];

  /* ── Тип кожи ── */
  if (profile.skinType) {
    const dryStripping = warnings.some(
      (w) => w.key === "compatibility.reasons.dryStripping",
    );
    const oilyHeavy = warnings.some(
      (w) => w.key === "compatibility.reasons.oilyHeavy",
    );
    const skinPositive = positives.some(
      (p) =>
        p.key === "compatibility.reasons.dryFriendly" ||
        p.key === "compatibility.reasons.oilyLightHydration" ||
        p.key === "compatibility.reasons.combinationBalanced" ||
        p.key === "compatibility.reasons.normalMaintenance",
    );

    let status: CompatibilityRowComputed["status"];
    let captionKey: string;

    if (dryStripping || oilyHeavy) {
      status = "warning";
      captionKey = "compatibility.captions.warning";
    } else if (skinPositive) {
      status = "supports";
      captionKey = "compatibility.captions.supports";
    } else {
      status = "compatible";
      captionKey = "compatibility.captions.compatible";
    }
    rows.push({
      labelKey: "compatibility.rows.skinType",
      labelArgs: { skinType: profile.skinType },
      captionKey,
      status,
    });
  }

  /* ── Чувствительность ── */
  if (profile.sensitivity && profile.sensitivity !== "none") {
    const sensTrigger = warnings.some(
      (w) =>
        w.key === "compatibility.reasons.sensitiveTrigger" ||
        w.key === "compatibility.reasons.activeForSensitive",
    );
    const isHigh =
      profile.sensitivity === "high" || profile.sensitivity === "reactive";

    let status: CompatibilityRowComputed["status"];
    let captionKey: string;

    if (sensTrigger) {
      status = "warning";
      captionKey = "compatibility.captions.warning";
    } else if (isHigh) {
      // Нет триггеров, но кожа чувствительная → patch test.
      status = "patch_test";
      captionKey = "compatibility.captions.patchTest";
    } else {
      status = "compatible";
      captionKey = "compatibility.captions.compatible";
    }
    rows.push({
      labelKey: "compatibility.rows.sensitivity",
      captionKey,
      status,
    });
  }

  /* ── Концерны ── */
  for (const concern of profile.concerns) {
    const helps = matchedConcerns.includes(concern);
    const cautions = warnings.some(
      (w) =>
        w.key === "compatibility.reasons.cautionForConcern" &&
        w.concern === concern,
    );

    let status: CompatibilityRowComputed["status"];
    let captionKey: string;
    if (cautions && !helps) {
      status = "warning";
      captionKey = "compatibility.captions.warning";
    } else if (helps && !cautions) {
      status = "treats";
      captionKey = "compatibility.captions.treats";
    } else if (helps && cautions) {
      status = "patch_test";
      captionKey = "compatibility.captions.patchTest";
    } else {
      // Ни помогает, ни мешает — просто нейтрально.
      status = "compatible";
      captionKey = "compatibility.captions.neutral";
    }
    rows.push({
      labelKey: "compatibility.rows.concern",
      labelArgs: { concern },
      captionKey,
      status,
    });
  }

  /* ── Avoided ── */
  for (const avoided of profile.avoidedList) {
    const triggered = triggeredAvoided.includes(avoided);
    rows.push({
      labelKey: "compatibility.rows.avoided",
      labelArgs: { avoided },
      captionKey: triggered
        ? "compatibility.captions.incompatible"
        : "compatibility.captions.compatible",
      status: triggered ? "incompatible" : "compatible",
    });
  }

  return rows;
}
