const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../grades.js');

function makeGroup() {
  return {
    id: 'g1',
    name: 'Inglés I',
    weights: { attendance: 15, participation: 15, homework: 20, exam: 50 },
    passing: 70,
    finalExamWeight: 50,
    tardyValue: 1,
    students: [{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Luis' }],
    partials: [
      {
        id: 'p1',
        name: 'Parcial 1',
        sessions: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }, { id: 'd4' }],
        attendance: { marks: { s1: { d2: 'A' }, s2: { d1: 'R', d2: 'A', d3: 'J' } } },
        participation: { marks: { s1: { d2: 'X' }, s2: { d1: 'M', d2: 'X' } } },
        homework: {
          items: [{ id: 'h1', name: 'T1', max: 100 }, { id: 'h2', name: 'T2', max: 50 }],
          scores: { s1: { h1: 80, h2: 50 }, s2: { h1: 60 } },
        },
        exam: {
          items: [{ id: 'e1', name: 'Examen', max: 100 }],
          scores: { s1: { e1: 69 }, s2: { e1: 29 } },
        },
      },
      {
        id: 'p2',
        name: 'Parcial 2',
        sessions: [],
        attendance: { marks: {} },
        participation: { marks: {} },
        homework: { items: [], scores: {} },
        exam: { items: [{ id: 'e2', name: 'Examen', max: 100 }], scores: { s1: { e2: 90 } } },
      },
    ],
    finalExam: { s1: 80 },
  };
}

test('attendance: sin marca = presente; retardo vale tardyValue', () => {
  const p = makeGroup().partials[0];
  assert.equal(G.attendanceScore(p, 's1', 1), 75); // 3 de 4
  assert.equal(G.attendanceScore(p, 's2', 1), 75); // R=1, A=0, J=1, P=1
  assert.equal(G.attendanceScore(p, 's2', 0.5), 62.5);
  assert.equal(G.attendanceScore(p, 's2', 0), 50);
  assert.equal(G.attendanceScore({ sessions: [] }, 's1', 1), null);
});

test('participation: P=1, M=0.5, X=0, sin marca = 1', () => {
  const p = makeGroup().partials[0];
  assert.equal(G.participationScore(p, 's1'), 75);
  assert.equal(G.participationScore(p, 's2'), 62.5);
  assert.equal(G.participationScore({ sessions: [] }, 's1'), null);
});

test('itemsScore: promedio de porcentajes; vacío se excluye', () => {
  const p = makeGroup().partials[0];
  assert.equal(G.itemsScore(p.homework, 's1', false), 90); // (80 + 100) / 2
  assert.equal(G.itemsScore(p.homework, 's2', false), 60); // solo h1
  assert.equal(G.itemsScore(p.homework, 's2', true), 30); // h2 cuenta 0
  assert.equal(G.itemsScore({ items: [], scores: {} }, 's1', false), null);
  assert.equal(G.itemsScore({ items: [{ id: 'x', max: 0 }], scores: {} }, 's1', false), null);
  // Sin ninguna calificada y sin blankAsZero -> null (no penaliza)
  assert.equal(G.itemsScore(p.homework, 's3', false), null);
  assert.equal(G.itemsScore(p.homework, 's3', true), 0);
});

test('partialGrade: fórmula del Excel (50/15/15/20)', () => {
  const g = makeGroup();
  const r = G.partialGrade(g, g.partials[0], 's1');
  // 69*.5 + 75*.15 + 75*.15 + 90*.2 = 34.5 + 11.25 + 11.25 + 18 = 75
  assert.equal(G.round1(r.grade), 75);
  assert.equal(r.scores.exam, 69);
  assert.deepEqual(Object.keys(r.scores), ['attendance', 'participation', 'homework', 'exam']);
});

test('partialGrade: rubros sin datos se excluyen y se renormaliza', () => {
  const g = makeGroup();
  const r = G.partialGrade(g, g.partials[1], 's1');
  assert.equal(r.scores.attendance, null);
  assert.equal(r.scores.homework, null);
  assert.equal(r.grade, 90);
  // Alumno sin calificación en el único rubro con datos -> sin calificación
  assert.equal(G.partialGrade(g, g.partials[1], 's2').grade, null);
  g.blankAsZero = true;
  assert.equal(G.partialGrade(g, g.partials[1], 's2').grade, 0);
});

test('partialGrade: parcial completamente vacío da null', () => {
  const g = makeGroup();
  const empty = {
    id: 'p3',
    sessions: [],
    attendance: { marks: {} },
    participation: { marks: {} },
    homework: { items: [], scores: {} },
    exam: { items: [], scores: {} },
  };
  assert.equal(G.partialGrade(g, empty, 's1').grade, null);
});

test('finalGrade: promedio de parciales, examen final 50 % y calif. necesaria', () => {
  const g = makeGroup();
  const r = G.finalGrade(g, 's1');
  assert.equal(r.partials.length, 2);
  assert.equal(G.round1(r.average), 82.5); // (75 + 90) / 2
  assert.equal(r.finalExam, 80);
  assert.equal(G.round1(r.final), 81.3); // 82.5*.5 + 80*.5
  assert.equal(G.round1(r.needed), 57.5); // (70 - 41.25) / .5

  const r2 = G.finalGrade(g, 's2');
  assert.equal(r2.finalExam, null);
  assert.equal(r2.final, null);
  assert.notEqual(r2.needed, null);

  g.finalExamWeight = 0;
  assert.equal(G.round1(G.finalGrade(g, 's1').final), 82.5);
  assert.equal(G.finalGrade(g, 's1').needed, null);

  g.partials = [];
  assert.equal(G.finalGrade(g, 's1').average, null);
  assert.equal(G.finalGrade(g, 's1').final, null);
});

test('settings aplica valores por defecto', () => {
  const s = G.settings({});
  assert.equal(s.passing, 70);
  assert.equal(s.finalExamWeight, 50);
  assert.equal(s.tardyValue, 1);
  assert.equal(s.blankAsZero, false);
  assert.equal(G.weightsTotal(s.weights), 100);
});

test('weightsTotal y passes', () => {
  assert.equal(G.weightsTotal({ attendance: 50 }), 50);
  assert.equal(G.passes(70, 70), true);
  assert.equal(G.passes(69.9, 70), false);
  assert.equal(G.passes(null, 70), null);
  assert.equal(G.passes(70, undefined), true);
});
