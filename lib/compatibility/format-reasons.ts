/**
 * Форматирование RuleHit → человекочитаемые строки для REST API
 * (mobile CompatibilityReason { key, text, kind }).
 *
 * Использует ТЕ ЖЕ i18n-строки `compatibility.*` из messages/{ru,en}.json,
 * что и web (`components/product/compatibility-section.tsx#formatReason`):
 *   - ключ `compatibility.reasons.avoidedFlag` → messages.compatibility.reasons.avoidedFlag
 *   - ICU-аргументы `{ingredient}` / `{concern}` интерполируются;
 *   - enum-аргументы concern/avoided/goal/skinType локализуются словарями
 *     (как formatReason на web).
 *
 * Дедуп по (key, inci) + top-4 — те же правила отображения, что в web-блоке
 * «Подходимость» (dedupeByKey().slice(0, 4)). Бизнес-логика движка не
 * затрагивается — только представление.
 *
 * SERVER-ONLY по смыслу (тащит JSON messages в бандл), из client-барреля
 * не реэкспортируется.
 */

import ruMessages from "@/messages/ru.json";
import enMessages from "@/messages/en.json";
import type { RuleHit } from "./types";

export type ReasonKind = "positive" | "warning" | "info";

export interface FormattedReason {
  /** Короткий стабильный ключ (без префикса compatibility.reasons.) */
  key: string;
  /** Готовая локализованная строка. */
  text: string;
  kind: ReasonKind;
}

type Dict = Record<string, unknown>;

function compatDict(locale: "ru" | "en"): Dict {
  const root = (locale === "en" ? enMessages : ruMessages) as Dict;
  return (root.compatibility as Dict) ?? {};
}

/** Достать строку по пути "reasons.avoidedFlag" из словаря compatibility. */
function lookup(dict: Dict, path: string): string | null {
  let cur: unknown = dict;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Dict)[part];
  }
  return typeof cur === "string" ? cur : null;
}

/** Простая ICU-интерполяция `{arg}` (наши строки не используют plural/select). */
function interpolate(
  template: string,
  args: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    args[name] != null ? String(args[name]) : m,
  );
}

/** Локализация enum-аргументов — как formatReason в web. */
function localizeArgs(
  dict: Dict,
  args: Record<string, string | number>,
): Record<string, string | number> {
  const out = { ...args };
  for (const [argName, ns] of [
    ["concern", "concerns"],
    ["avoided", "avoided"],
    ["goal", "goals"],
    ["skinType", "skinTypes"],
  ] as const) {
    const v = out[argName];
    if (typeof v === "string") {
      out[argName] = lookup(dict, `${ns}.${v}`) ?? v;
    }
  }
  return out;
}

/** Один RuleHit → FormattedReason (null, если ключа нет в messages). */
export function formatRuleHit(
  hit: RuleHit,
  locale: "ru" | "en",
): FormattedReason | null {
  const dict = compatDict(locale);
  // Ключи движка: "compatibility.reasons.xxx" → путь внутри словаря "reasons.xxx".
  const path = hit.key.replace(/^compatibility\./, "");
  const template = lookup(dict, path);
  if (!template) return null;
  const args = localizeArgs(dict, {
    ...(hit.args ?? {}),
    // {ingredient} в шаблонах приходит из hit.inci (как на web: args уже
    // содержат ingredient; подстрахуемся inci-фоллбэком).
    ...(hit.inci && !(hit.args && "ingredient" in hit.args)
      ? { ingredient: hit.inci }
      : {}),
  });
  return {
    key: path.replace(/^reasons\./, ""),
    text: interpolate(template, args),
    kind: hit.kind,
  };
}

/** Дедуп (key, inci) + top-N — правила отображения web-блока. */
export function formatRuleHits(
  hits: readonly RuleHit[],
  locale: "ru" | "en",
  top = 4,
): FormattedReason[] {
  const seen = new Set<string>();
  const out: FormattedReason[] = [];
  for (const h of hits) {
    const dedupeKey = `${h.key}:${h.inci ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const f = formatRuleHit(h, locale);
    if (f) out.push(f);
    if (out.length >= top) break;
  }
  return out;
}
