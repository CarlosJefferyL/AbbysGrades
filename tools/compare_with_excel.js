#!/usr/bin/env node
/*
 * Compara lo que calcula grades.js con los valores que Excel tenía
 * calculados en el libro original.
 *
 *   python3 tools/import_excel.py libro.xlsx datos.json --expected esperado.json
 *   node tools/compare_with_excel.js datos.json esperado.json
 */
const fs = require('fs');
const G = require('../grades.js');

const [dataPath, expectedPath] = process.argv.slice(2);
if (!dataPath || !expectedPath) {
  console.error('Uso: node tools/compare_with_excel.js datos.json esperado.json');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
const TOL = 0.06; // diferencias de redondeo

let checks = 0;
let diffs = 0;
function cmp(label, got, exp) {
  if (typeof exp !== 'number') return; // Excel no tenía valor (o era #VALUE!)
  checks++;
  if (got === null || Math.abs(got - exp) > TOL) {
    diffs++;
    console.log(`  DIFERENCIA ${label}: app=${got === null ? '—' : got.toFixed(2)} excel=${exp.toFixed(2)}`);
  }
}

for (const group of data.groups) {
  const exp = expected[group.id] || {};
  console.log(`\n${group.name}`);
  for (const st of group.students) {
    const e = exp[st.id];
    if (!e) continue;
    group.partials.forEach((p, i) => {
      const ep = e.partials[i] || {};
      const r = G.partialGrade(group, p, st.id);
      for (const c of G.CATEGORIES) cmp(`${st.name} ${p.name} ${c}`, r.scores[c], ep[c]);
      cmp(`${st.name} ${p.name} calificación`, r.grade, ep.grade);
    });
    const f = G.finalGrade(group, st.id);
    cmp(`${st.name} promedio`, f.average, e.average);
    cmp(`${st.name} calif. necesaria`, f.needed, e.needed);
  }
}
console.log(`\n${checks} valores comparados, ${diffs} diferencias.`);
process.exit(diffs ? 1 : 0);
