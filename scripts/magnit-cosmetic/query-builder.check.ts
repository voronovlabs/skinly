/**
 * Unit-style проверки генерации поисковых запросов (этап 4, query-builder).
 * Без фреймворка: node:assert, падает с ненулевым кодом при провале.
 *
 *   npx tsx scripts/magnit-cosmetic/query-builder.check.ts
 */

import * as assert from "node:assert/strict";
import { buildSearchQueries, extractVolume, MAX_QUERIES } from "./query-builder";

let n = 0;
function check(name: string, fn: () => void): void {
  n++;
  try {
    fn();
    console.log(`  ok ${n}: ${name}`);
  } catch (e) {
    console.error(`FAIL ${n}: ${name}`);
    throw e;
  }
}

/* ── извлечение объёма ── */

check("объём: 50мл → «50 мл» (нормализованный пробел)", () => {
  assert.equal(extractVolume("Крем 50мл"), "50 мл");
  assert.equal(extractVolume("Cream 50ml"), "50 мл");
});
check("объём: 0.2 л / 0,2л", () => {
  assert.equal(extractVolume("Шампунь 0.2 л"), "0.2 л");
  assert.equal(extractVolume("Шампунь 0,2л"), "0.2 л");
});
check("объём: 200 г / 200гр / 200g → «200 г»", () => {
  assert.equal(extractVolume("Мыло 200 г"), "200 г");
  assert.equal(extractVolume("Мыло 200гр"), "200 г");
  assert.equal(extractVolume("Soap 200g"), "200 г");
});
check("объём: 4 шт / 4шт / 4 штук → «4 шт»", () => {
  assert.equal(extractVolume("Кассеты 4 шт"), "4 шт");
  assert.equal(extractVolume("Кассеты 4шт"), "4 шт");
  assert.equal(extractVolume("Кассеты 4 штук"), "4 шт");
});
check("объём: нет — null; «мл» внутри слова не матчится", () => {
  assert.equal(extractVolume("Помада тон 03"), null);
});

/* ── эталонный пример: Gillette ── */

const g = buildSearchQueries("Gillette", "Кассеты для бритья Gillette Mach3 Turbo 4шт");

check("Gillette: до 3 уникальных запросов", () => {
  assert.ok(g.queries.length >= 1 && g.queries.length <= MAX_QUERIES);
  assert.equal(new Set(g.queries.map((q) => q.toLowerCase())).size, g.queries.length);
});
check("Gillette: бренд не дублируется ни в одном запросе", () => {
  for (const q of g.queries) {
    const hits = q.toLowerCase().split(/\s+/).filter((t) => t === "gillette").length;
    assert.equal(hits, 1, `бренд задвоен в "${q}"`);
  }
});
check("Gillette: объём извлечён и нормализован («4 шт»)", () => {
  assert.equal(g.volume, "4 шт");
  assert.ok(g.queries[0].includes("4 шт"), `нет объёма в строгом запросе "${g.queries[0]}"`);
});
check("Gillette: линейка Mach3 Turbo сохранена, строгий запрос — по ней", () => {
  assert.ok(/Mach3 Turbo/i.test(g.queries[0]), g.queries[0]);
  assert.equal(g.queries[0], "Gillette Mach3 Turbo 4 шт");
  assert.equal(g.queries[1], "Gillette Mach3 Turbo");
  assert.equal(g.queries[2], "Gillette Mach3");
});
check("Gillette: служебное «для» убрано", () => {
  for (const q of g.queries) assert.ok(!/\bдля\b/i.test(q), q);
});

/* ── пример Nivea: стоп-слова, тип кожи, дедуп бренда ── */

const nv = buildSearchQueries(
  "Nivea",
  "Крем для лица Nivea увлажняющий дневной для нормальной кожи 50мл",
);

check("Nivea: стоп-слова «для/лица/кожи» и тип кожи убраны", () => {
  for (const q of nv.queries) {
    assert.ok(!/\b(для|лица|кожи|нормальн\w*)\b/i.test(q), q);
  }
});
check("Nivea: объём «50 мл», бренд один раз, суть сохранена", () => {
  assert.equal(nv.volume, "50 мл");
  assert.ok(nv.queries[0].startsWith("Nivea "));
  assert.ok(/Крем/i.test(nv.queries[0]) && /увлажняющий/i.test(nv.queries[0]), nv.queries[0]);
  assert.ok(nv.queries[0].endsWith("50 мл"), nv.queries[0]);
});
check("Nivea: запросы уникальны, от строгого к широкому", () => {
  assert.equal(new Set(nv.queries).size, nv.queries.length);
  for (let i = 1; i < nv.queries.length; i++) {
    assert.ok(
      nv.queries[i].split(" ").length <= nv.queries[i - 1].split(" ").length,
      `запрос ${i + 1} не шире предыдущего`,
    );
  }
});

/* ── повторяющиеся слова ── */

check("повторы слов схлопываются", () => {
  const r = buildSearchQueries("Nivea", "Дезодорант Дезодорант Nivea шариковый");
  for (const q of r.queries) {
    const toks = q.toLowerCase().split(/\s+/);
    assert.equal(new Set(toks).size, toks.length, q);
  }
});

/* ── края ── */

check("brand=null (Unknown): запросы без бренда, не пустые", () => {
  const r = buildSearchQueries(null, "Бальзам для губ вишня 4 г");
  assert.ok(r.queries.length >= 1);
  for (const q of r.queries) assert.ok(q.trim().length > 0);
  assert.equal(r.volume, "4 г");
});
check("вырожденное имя: fallback хотя бы к одному запросу", () => {
  const r = buildSearchQueries("Nivea", "Nivea для ухода");
  assert.ok(r.queries.length >= 1);
  assert.ok(r.queries[0].length > 0);
});
check("SPF/тон/номера сохраняются", () => {
  const r = buildSearchQueries("Garnier", "Крем солнцезащитный Garnier SPF 50 невидимый");
  assert.ok(/SPF/i.test(r.queries[0]) && /50/.test(r.queries[0]), r.queries[0]);
});

console.log(`\nВсе ${n} проверок прошли ✓`);
