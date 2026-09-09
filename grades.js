/*
 * Lógica de cálculo de calificaciones (sin dependencias de DOM).
 * Funciona en el navegador (window.Grades) y en Node (module.exports)
 * para poder probarla con `npm test`.
 *
 * Modelo de datos de un grupo:
 * {
 *   id, name,
 *   weights: { attendance, participation, homework, exam }  // suman 100
 *   passing: 70,            // calificación mínima aprobatoria (0-100)
 *   finalExamWeight: 50,    // % del examen final en la calificación final
 *   tardyValue: 1,          // cuánto vale un retardo (1, 0.5 o 0)
 *   blankAsZero: false,     // tarea/examen sin calificar cuenta como 0
 *   students: [{ id, name, code }],
 *   partials: [{
 *     id, name,
 *     sessions: [{ id, date }],                       // fechas de clase
 *     attendance:    { marks:  { [studentId]: { [sessionId]: 'P'|'R'|'A'|'J' } } },
 *     participation: { marks:  { [studentId]: { [sessionId]: 'P'|'M'|'X' } } },
 *     homework:      { items: [{ id, name, max }], scores: { [studentId]: { [itemId]: n } } },
 *     exam:          { items: [{ id, name, max }], scores: { [studentId]: { [itemId]: n } } },
 *   }],
 *   finalExam: { [studentId]: n }   // 0-100
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Grades = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = ['attendance', 'participation', 'homework', 'exam'];

  const CATEGORY_LABELS = {
    attendance: 'Attendance',
    participation: 'Participation',
    homework: 'Homework',
    exam: 'Exam',
  };

  // Marcas de asistencia. Sin marca = Presente.
  const ATTENDANCE_CYCLE = ['P', 'A', 'R', 'J'];
  const ATTENDANCE_LABELS = {
    P: 'Presente (On time)',
    A: 'Ausente (Absent)',
    R: 'Retardo (Tardy)',
    J: 'Falta justificada',
  };

  // Marcas de participación. Sin marca = Participó.
  const PARTICIPATION_CYCLE = ['P', 'X', 'M'];
  const PARTICIPATION_LABELS = {
    P: 'Participó',
    X: 'No participó',
    M: 'Participación parcial (½)',
  };
  const PARTICIPATION_VALUES = { P: 1, M: 0.5, X: 0 };

  const DEFAULTS = {
    weights: { attendance: 15, participation: 15, homework: 20, exam: 50 },
    passing: 70,
    finalExamWeight: 50,
    tardyValue: 1,
    blankAsZero: false,
  };

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function settings(group) {
    return {
      weights: Object.assign({}, DEFAULTS.weights, (group && group.weights) || {}),
      passing: isNum(group && group.passing) ? group.passing : DEFAULTS.passing,
      finalExamWeight: isNum(group && group.finalExamWeight)
        ? group.finalExamWeight
        : DEFAULTS.finalExamWeight,
      tardyValue: isNum(group && group.tardyValue)
        ? group.tardyValue
        : DEFAULTS.tardyValue,
      blankAsZero: !!(group && group.blankAsZero),
    };
  }

  function attendanceValue(mark, tardyValue) {
    switch (mark) {
      case 'A':
        return 0;
      case 'R':
        return tardyValue;
      case 'J':
      case 'P':
      default:
        return 1;
    }
  }

  /** Porcentaje de asistencia (0-100) o null si no hay sesiones. */
  function attendanceScore(partial, studentId, tardyValue) {
    const sessions = (partial && partial.sessions) || [];
    if (sessions.length === 0) return null;
    const tv = isNum(tardyValue) ? tardyValue : DEFAULTS.tardyValue;
    const marks =
      (partial.attendance && partial.attendance.marks && partial.attendance.marks[studentId]) || {};
    let earned = 0;
    for (const s of sessions) {
      earned += attendanceValue(marks[s.id], tv);
    }
    return (earned / sessions.length) * 100;
  }

  /** Porcentaje de participación (0-100) o null si no hay sesiones. */
  function participationScore(partial, studentId) {
    const sessions = (partial && partial.sessions) || [];
    if (sessions.length === 0) return null;
    const marks =
      (partial.participation &&
        partial.participation.marks &&
        partial.participation.marks[studentId]) ||
      {};
    let earned = 0;
    for (const s of sessions) {
      const m = marks[s.id];
      earned += m in PARTICIPATION_VALUES ? PARTICIPATION_VALUES[m] : 1;
    }
    return (earned / sessions.length) * 100;
  }

  /**
   * Porcentaje (0-100) de una sección de actividades con puntaje máximo
   * (homework, exam). Cada actividad se convierte a porcentaje y se
   * promedian. Celda vacía: se excluye, salvo blankAsZero.
   * null si no hay actividades calificadas.
   */
  function itemsScore(section, studentId, blankAsZero) {
    const items = ((section && section.items) || []).filter(
      (it) => isNum(it.max) && it.max > 0
    );
    if (items.length === 0) return null;
    const scores = (section.scores && section.scores[studentId]) || {};
    let sum = 0;
    let count = 0;
    for (const it of items) {
      const v = scores[it.id];
      if (isNum(v)) {
        sum += (Math.max(0, v) / it.max) * 100;
        count++;
      } else if (blankAsZero) {
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  }

  function categoryScore(group, partial, category, studentId) {
    if (!partial) return null;
    const cfg = settings(group);
    switch (category) {
      case 'attendance':
        return attendanceScore(partial, studentId, cfg.tardyValue);
      case 'participation':
        return participationScore(partial, studentId);
      case 'homework':
      case 'exam':
        return itemsScore(partial[category], studentId, cfg.blankAsZero);
      default:
        return null;
    }
  }

  /**
   * Calificación de un parcial para un alumno.
   * Los rubros sin datos se excluyen y los pesos restantes se
   * renormalizan, para que la vista a medio parcial tenga sentido.
   * Devuelve { scores: {rubro: número|null}, grade: número|null }.
   */
  function partialGrade(group, partial, studentId) {
    const { weights } = settings(group);
    const scores = {};
    let weighted = 0;
    let usedWeight = 0;
    for (const c of CATEGORIES) {
      const s = categoryScore(group, partial, c, studentId);
      scores[c] = s;
      const w = isNum(weights[c]) ? weights[c] : 0;
      if (s !== null && w > 0) {
        weighted += s * w;
        usedWeight += w;
      }
    }
    const grade = usedWeight > 0 ? weighted / usedWeight : null;
    return { scores, grade };
  }

  /**
   * Calificación final de un alumno.
   *  average  = promedio de los parciales con datos
   *  finalExam= calificación del examen final (0-100) o null
   *  final    = average*(1-wF) + finalExam*wF  (null si falta algo)
   *  needed   = calificación de examen final necesaria para aprobar
   *             (null si wF = 0 o no hay promedio)
   */
  function finalGrade(group, studentId) {
    const cfg = settings(group);
    const wF = Math.min(100, Math.max(0, cfg.finalExamWeight)) / 100;
    const partials = (group.partials || []).map((p) => ({
      id: p.id,
      name: p.name,
      grade: partialGrade(group, p, studentId).grade,
    }));
    const graded = partials.filter((p) => p.grade !== null);
    const average =
      graded.length > 0
        ? graded.reduce((a, p) => a + p.grade, 0) / graded.length
        : null;
    const fe = group.finalExam && group.finalExam[studentId];
    const finalExam = isNum(fe) ? fe : null;

    let final = null;
    if (average !== null) {
      if (wF === 0) final = average;
      else if (finalExam !== null) final = average * (1 - wF) + finalExam * wF;
    }

    let needed = null;
    if (average !== null && wF > 0) {
      needed = (cfg.passing - average * (1 - wF)) / wF;
    }
    return { partials, average, finalExam, final, needed };
  }

  function weightsTotal(weights) {
    return CATEGORIES.reduce(
      (a, c) => a + (isNum(weights[c]) ? weights[c] : 0),
      0
    );
  }

  function passes(grade, passing) {
    if (grade === null || grade === undefined) return null;
    return grade >= (isNum(passing) ? passing : DEFAULTS.passing);
  }

  return {
    CATEGORIES,
    CATEGORY_LABELS,
    ATTENDANCE_CYCLE,
    ATTENDANCE_LABELS,
    PARTICIPATION_CYCLE,
    PARTICIPATION_LABELS,
    PARTICIPATION_VALUES,
    DEFAULTS,
    settings,
    round1,
    attendanceScore,
    participationScore,
    itemsScore,
    categoryScore,
    partialGrade,
    finalGrade,
    weightsTotal,
    passes,
  };
});
