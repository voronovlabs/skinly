/**
 * Логгер в стиле остальных скриптов проекта:
 *   ts()  — с ISO-таймстампом (прогресс)
 *   log() — без таймстампа (отчётные блоки)
 * Секреты/cookies/headers в логи не пишем.
 */

let debugEnabled = false;

export function setDebug(v: boolean): void {
  debugEnabled = v;
}

export function ts(msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

export function log(msg: string): void {
  console.log(msg);
}

export function debug(msg: string): void {
  if (debugEnabled) ts(`[debug] ${msg}`);
}
