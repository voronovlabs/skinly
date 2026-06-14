/**
 * Smoke-тест парсера barcode-list.ru (без сети).
 *
 * Запуск:  npx tsx scripts/farera/barcode-list.smoke.ts
 * Проверяет:
 *   1. «схлопнутая» таблица (одна слитная строка с шапкой/футноутом) →
 *      candidate.name содержит ТОЛЬКО наименование товара;
 *   2. несколько товаров в выдаче → разбиваются на отдельных кандидатов;
 *   3. структурная таблица (<td> по колонкам) тоже парсится чисто.
 *
 * Это не unit-фреймворк (vitest — фаза 14); простой assert + ненулевой
 * exit code на падении.
 */

import {
  classifyCandidates,
  parseSearchResults,
  type FareraQueryInput,
} from "./barcode-list";

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok && extra !== undefined) console.log("   got:", JSON.stringify(extra));
}

/* ── 1) «схлопнутая» таблица: всё в одной строке, с шапкой и футноутом ── */
// Так выглядел реальный «грязный» вывод: шапка + строки + футноут слитно.
const collapsedHtml = `<table><tr><td>
Поиск: ARAVIA Лосьон № Штрих-код Наименование Единица измерения Рейтинг*
1 4670008490118 1020 "ARAVIA Professional" Лосьон для подготовки кожи перед депиляцией с экстрактами мяты и березы 300мл. /16 шт 5
2 4670008490132 1019 "ARAVIA Professional" Лосьон для подготовки кожи перед депиляцией с экстрактами мяты и березы 150мл. /16 шт 3
3 4670008491184 1057 "ARAVIA Professional" Эмульсия после депиляции с экстрактами мяты и березы 300мл. /16 шт 4
* Рейтинг — это число подтверждений штрих-кода пользователями.
</td></tr></table>`;

const collapsed = parseSearchResults(collapsedHtml);
check("collapsed → 3 кандидата", collapsed.length === 3, collapsed.map((c) => c.barcode));
check(
  "collapsed[0].barcode = 4670008490118",
  collapsed[0]?.barcode === "4670008490118",
  collapsed[0]?.barcode,
);
check(
  "collapsed[0].name чистое (без шапки/футноута/штрихкода)",
  collapsed[0]?.name ===
    '1020 "ARAVIA Professional" Лосьон для подготовки кожи перед депиляцией с экстрактами мяты и березы 300мл. /16',
  collapsed[0]?.name,
);
check("collapsed[1].barcode = 4670008490132 (150мл)", collapsed[1]?.barcode === "4670008490132", collapsed[1]?.barcode);
check("collapsed[1].name содержит 150мл", /150мл/.test(collapsed[1]?.name ?? ""), collapsed[1]?.name);
check("collapsed[2].barcode = 4670008491184 (300мл)", collapsed[2]?.barcode === "4670008491184", collapsed[2]?.barcode);
check(
  "ни одно name не содержит 'Штрих-код'/'Наименование'/'Рейтинг'/'Поиск'",
  collapsed.every((c) => !/Штрих-код|Наименование|Рейтинг|Поиск|№/i.test(c.name)),
  collapsed.map((c) => c.name),
);
check(
  "последнее name не содержит футноут '* Рейтинг'",
  !/Рейтинг|подтвержден/i.test(collapsed[2]?.name ?? ""),
  collapsed[2]?.name,
);

/* ── 2) несколько товаров → ambiguous (разные объёмы) ── */
const input: FareraQueryInput = {
  brand: "Aravia Professional",
  title: "Aravia Лосьон для подготовки кожи перед депиляцией с экстрактами мяты и березы 300 мл",
  volume: "300 мл",
};
const cls = classifyCandidates(input, collapsed);
check(
  "несколько валидных EAN с высоким score → ambiguous",
  cls.status === "ambiguous",
  { status: cls.status, scores: cls.candidates.map((c) => c.score) },
);
check("ambiguous: кандидатов >= 2", cls.candidates.length >= 2, cls.candidates.length);

/* ── 3) структурная таблица (<td> по колонкам) ── */
const structuredHtml = `<table>
<tr><th>№</th><th>Штрих-код</th><th>Наименование</th><th>Ед.</th><th>Рейтинг</th></tr>
<tr><td>1</td><td>4670008492785</td><td>Aravia Гель Cuticle Remover 100 мл</td><td>шт</td><td>5</td></tr>
</table>`;
const structured = parseSearchResults(structuredHtml);
check("structured → 1 кандидат", structured.length === 1, structured.length);
check("structured name чистое", structured[0]?.name === "Aravia Гель Cuticle Remover 100 мл", structured[0]?.name);
check("structured unit=шт", structured[0]?.unit === "шт", structured[0]?.unit);
check("structured rating=5", structured[0]?.rating === 5, structured[0]?.rating);

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
