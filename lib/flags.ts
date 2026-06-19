/**
 * Server-side feature flags (читаются из process.env).
 *
 * Значения берутся из окружения, поэтому переключаются без пересборки клиента.
 * На клиенте не-public env недоступен → функции вернут безопасный default
 * (как будто флаг выключен).
 */

/**
 * Stage 2 — использовать DM canonical pipeline для compatibility.
 *   false / unset → старый путь (inciToFact + in-code KB).
 *   true          → попытка DM-пути с fallback на старый.
 */
export function isDmCompatibilityEnabled(): boolean {
  return process.env.USE_DM_COMPATIBILITY === "true";
}
