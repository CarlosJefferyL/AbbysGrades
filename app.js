/* Aplicación de calificaciones. Requiere grades.js cargado antes. */
(function () {
  'use strict';

  const G = window.Grades;
  const STORAGE_KEY = 'abbysgrades.v1';
  const WEEKDAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // ------------------------------------------------------------ estado
  let state = load() || { version: 1, groups: [], activeGroupId: null };
  const ui = { tab: 'students', partialId: null, subTab: 'attendance', modal: null };

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
    return Math.random().toString(36).slice(2, 10);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (e) {
      console.error('No se pudo leer el almacenamiento local', e);
      return null;
    }
  }

  function save() {
    guardarLocal();
    if (sync.modo === 'servidor') {
      sync.pendiente = true;
      // La marca sobrevive a cerrar la pestaña: si la subida no alcanzó a
      // salir, el siguiente arranque la reintenta en vez de perder el cambio.
      try { localStorage.setItem(PENDIENTE_KEY, '1'); } catch (e) { /* sin almacenamiento local no hay nada que marcar */ }
      programarEnvio();
    }
  }

  function guardarLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(VERSION_KEY, String(sync.version));
    } catch (e) {
      toast('No se pudo guardar en este navegador (almacenamiento lleno o bloqueado)');
    }
  }

  /** Garantiza que todos los campos existan (también para respaldos viejos). */
  function normalize(data) {
    if (!data || typeof data !== 'object') throw new Error('Formato inválido');
    if (!Array.isArray(data.groups)) throw new Error('El archivo no contiene grupos');
    data.version = 1;
    for (const g of data.groups) {
      g.id = g.id || uid();
      g.name = g.name || 'Grupo';
      g.weights = Object.assign({}, G.DEFAULTS.weights, g.weights || {});
      if (typeof g.passing !== 'number') g.passing = G.DEFAULTS.passing;
      if (typeof g.finalExamWeight !== 'number') g.finalExamWeight = G.DEFAULTS.finalExamWeight;
      if (typeof g.tardyValue !== 'number') g.tardyValue = G.DEFAULTS.tardyValue;
      g.blankAsZero = !!g.blankAsZero;
      g.students = (g.students || []).map((s) => ({ id: s.id || uid(), name: s.name || '', code: s.code || '' }));
      g.partials = (g.partials || []).map((p, i) => normalizePartial(p, i + 1));
      g.finalExam = g.finalExam || {};
    }
    if (!data.groups.some((g) => g.id === data.activeGroupId)) {
      data.activeGroupId = data.groups.length ? data.groups[0].id : null;
    }
    return data;
  }

  function normalizePartial(p, n) {
    p = p || {};
    p.id = p.id || uid();
    p.name = p.name || 'Parcial ' + n;
    p.sessions = (p.sessions || []).map((s) => ({ id: s.id || uid(), date: s.date }));
    p.attendance = p.attendance || {};
    p.attendance.marks = p.attendance.marks || {};
    p.participation = p.participation || {};
    p.participation.marks = p.participation.marks || {};
    for (const c of ['homework', 'exam']) {
      p[c] = p[c] || {};
      p[c].items = (p[c].items || []).map((it) => ({ id: it.id || uid(), name: it.name || '', max: typeof it.max === 'number' ? it.max : 100 }));
      p[c].scores = p[c].scores || {};
    }
    return p;
  }

  function newPartial(n) {
    return normalizePartial({
      name: 'Parcial ' + n,
      exam: { items: [{ id: uid(), name: 'Examen', max: 100 }], scores: {} },
    }, n);
  }

  function newGroup(name) {
    const g = normalize({ groups: [{ name, partials: [newPartial(1), newPartial(2), newPartial(3)] }] }).groups[0];
    return g;
  }

  function activeGroup() {
    return state.groups.find((g) => g.id === state.activeGroupId) || null;
  }

  function activePartial(group) {
    if (!group) return null;
    return group.partials.find((p) => p.id === ui.partialId) || group.partials[0] || null;
  }

  function commit() {
    save();
    render();
  }

  // ------------------------------------------------------------ servidor
  // La app guarda en localStorage (rápido, y funciona sin servidor: abrir
  // index.html a doble clic sigue sirviendo) y, cuando hay servidor, sube el
  // estado completo con un número de versión. El servidor es la fuente de
  // verdad entre dispositivos; el navegador es la copia de trabajo.
  const VERSION_KEY = 'abbysgrades.version';
  const PENDIENTE_KEY = 'abbysgrades.pendiente';
  const ESPERA_ENVIO_MS = 700;
  const sync = {
    modo: 'local',      // 'local' (sin servidor) | 'servidor'
    version: 0,         // versión del servidor sobre la que está construido `state`
    pendiente: false,   // hay cambios locales sin subir
    enviando: false,
    timer: null,
    reintento: 2000,    // espera antes de reintentar sin conexión; crece hasta un minuto
  };

  function api(ruta, opciones = {}) {
    return fetch(ruta, Object.assign({ credentials: 'same-origin' }, opciones, {
      headers: Object.assign({ 'Content-Type': 'application/json' }, opciones.headers || {}),
    }));
  }

  const TEXTO_ESTADO = {
    local: 'Sólo en este navegador',
    cargando: 'Cargando…',
    guardando: 'Guardando…',
    guardado: 'Guardado en el servidor',
    sinconexion: 'Sin conexión: se guardará al reconectar',
    acceso: '',
  };

  function ponerEstado(clave) {
    const el = document.getElementById('sync-estado');
    el.textContent = TEXTO_ESTADO[clave];
    el.className = 'sync ' + clave;
    document.getElementById('btn-salir').hidden = sync.modo !== 'servidor';
  }

  async function iniciar() {
    let r = null;
    try { r = await fetch('/api/sesion', { credentials: 'same-origin' }); } catch (e) { /* sin servidor */ }
    if (!r || (r.status !== 204 && r.status !== 401)) {
      // Archivo abierto a doble clic, o `npm start` sin API: sólo este navegador.
      sync.modo = 'local';
      ponerEstado('local');
      return render();
    }
    sync.modo = 'servidor';
    sync.version = Number(localStorage.getItem(VERSION_KEY)) || 0;
    if (r.status === 401) return mostrarAcceso();
    await cargarDelServidor();
  }

  async function cargarDelServidor() {
    ocultarAcceso();
    ponerEstado('cargando');
    let r;
    try { r = await api('/api/datos'); } catch (e) { render(); return sinConexion(); }
    if (r.status === 401) return mostrarAcceso();
    if (!r.ok) { render(); return sinConexion(); }
    const remoto = await r.json();
    const pendienteLocal = localStorage.getItem(PENDIENTE_KEY) === '1';

    if (remoto.datos === null && state.groups.length) {
      // Primer arranque con servidor: lo capturado en este navegador se sube tal cual.
      sync.version = 0;
      sync.pendiente = true;
      render();
      await enviar();
      if (!sync.pendiente) toast('Los datos de este navegador se subieron al servidor');
      return;
    }
    if (pendienteLocal && remoto.version === sync.version) {
      // Cambios hechos sin conexión sobre la misma versión que tiene el servidor.
      sync.pendiente = true;
      render();
      return enviar();
    }
    if (remoto.datos !== null) adoptar(remoto);
    else sync.version = remoto.version;
    localStorage.removeItem(PENDIENTE_KEY);
    ponerEstado('guardado');
    render();
    if (pendienteLocal) toast('Había cambios más recientes en el servidor; se cargaron esos');
  }

  /** Reemplaza el estado por lo que tiene el servidor. */
  function adoptar(remoto) {
    state = normalize(remoto.datos);
    sync.version = remoto.version;
    sync.pendiente = false;
    guardarLocal();
    const g = activeGroup();
    if (ui.tab === 'partial' && !(g && g.partials.some((p) => p.id === ui.partialId))) {
      ui.tab = 'students';
      ui.partialId = null;
    }
  }

  function programarEnvio() {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(enviar, ESPERA_ENVIO_MS);
  }

  async function enviar() {
    if (sync.modo !== 'servidor' || !sync.pendiente || sync.enviando) return;
    clearTimeout(sync.timer);
    sync.enviando = true;
    sync.pendiente = false;
    ponerEstado('guardando');
    let r;
    try {
      r = await api('/api/datos', { method: 'PUT', body: JSON.stringify({ version: sync.version, datos: state }) });
    } catch (e) {
      sync.enviando = false;
      sync.pendiente = true;
      return sinConexion();
    }
    sync.enviando = false;
    if (r.status === 200) {
      sync.version = (await r.json()).version;
      sync.reintento = 2000;
      if (sync.pendiente) return programarEnvio(); // hubo cambios mientras subía
      localStorage.removeItem(PENDIENTE_KEY);
      guardarLocal();
      return ponerEstado('guardado');
    }
    if (r.status === 409) {
      // Otro dispositivo guardó primero. Se toma lo del servidor: es un solo
      // documento y no hay forma segura de mezclar dos versiones a ciegas.
      adoptar(await r.json());
      localStorage.removeItem(PENDIENTE_KEY);
      ponerEstado('guardado');
      render();
      return toast('Otro dispositivo guardó cambios más recientes; se cargaron esos. Repite tu último cambio.');
    }
    sync.pendiente = true;
    if (r.status === 401) return mostrarAcceso();
    return sinConexion();
  }

  function sinConexion() {
    ponerEstado('sinconexion');
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => (sync.pendiente ? enviar() : refrescar()), sync.reintento);
    sync.reintento = Math.min(sync.reintento * 2, 60000);
  }

  /** Trae lo del servidor si cambió (al volver a la pestaña, al enfocar, cada minuto). */
  async function refrescar() {
    if (sync.modo !== 'servidor' || sync.pendiente || sync.enviando || ui.modal || document.hidden) return;
    const activo = document.activeElement;
    if (activo && activo.matches && activo.matches('input, textarea')) return; // no pisar lo que se está escribiendo
    let r;
    try { r = await api('/api/datos'); } catch (e) { return; }
    if (r.status === 401) return mostrarAcceso();
    if (!r.ok) return;
    const remoto = await r.json();
    if (remoto.datos !== null && remoto.version !== sync.version) {
      adoptar(remoto);
      render();
      toast('Actualizado con los cambios de otro dispositivo');
    }
    ponerEstado('guardado');
  }

  function mostrarAcceso() {
    ponerEstado('acceso');
    document.getElementById('acceso').hidden = false;
    document.getElementById('acceso-error').textContent = '';
    setTimeout(() => document.getElementById('acceso-clave').focus(), 0);
  }

  function ocultarAcceso() {
    document.getElementById('acceso').hidden = true;
  }

  async function entrar(clave) {
    const error = document.getElementById('acceso-error');
    error.textContent = '';
    let r;
    try {
      r = await api('/api/sesion', { method: 'POST', body: JSON.stringify({ clave }) });
    } catch (e) {
      error.textContent = 'No hay conexión con el servidor';
      return;
    }
    if (r.status === 204) {
      document.getElementById('acceso-clave').value = '';
      if (sync.pendiente) {
        // La sesión caducó con cambios sin subir: primero se suben, sin recargar encima.
        ocultarAcceso();
        render();
        return enviar();
      }
      return cargarDelServidor();
    }
    const cuerpo = await r.json().catch(() => ({}));
    error.textContent = cuerpo.error || 'No se pudo entrar';
  }

  async function salir() {
    if (sync.pendiente) await enviar();
    if (sync.pendiente && !confirm('No se pudieron subir los últimos cambios. ¿Salir de todos modos y perderlos?')) return;
    try { await api('/api/sesion', { method: 'DELETE' }); } catch (e) { /* la cookie caduca sola */ }
    // En una computadora compartida no debe quedar la copia local.
    for (const k of [STORAGE_KEY, VERSION_KEY, PENDIENTE_KEY]) localStorage.removeItem(k);
    state = { version: 1, groups: [], activeGroupId: null };
    sync.version = 0;
    sync.pendiente = false;
    ui.tab = 'students';
    ui.partialId = null;
    ui.modal = null;
    render();
    mostrarAcceso();
  }

  // ------------------------------------------------------------ utilidades
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    return n === null || n === undefined || Number.isNaN(n) ? '—' : G.round1(n).toFixed(1);
  }

  function gradeClass(n, passing) {
    const p = G.passes(n, passing);
    return p === null ? '' : p ? 'pass' : 'fail';
  }

  function todayISO() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function parseISO(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  function sortSessions(partial) {
    partial.sessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function sortedStudents(group) {
    return group.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function csv(rows) {
    const line = (r) => r.map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
    return '﻿' + rows.map(line).join('\r\n');
  }

  function slug(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  }

  // ------------------------------------------------------------ render
  function render() {
    renderTopbar();
    const main = document.getElementById('main');
    const group = activeGroup();
    if (!group) {
      main.innerHTML = `
        <div class="empty">
          <p>No hay grupos todavía.</p>
          <p><button class="primary" data-action="group-new">Crear el primer grupo</button>
             <button data-action="backup-import">Restaurar un respaldo (.json)</button></p>
        </div>` + renderModal();
      return;
    }
    let html = renderTabs(group);
    switch (ui.tab) {
      case 'students': html += renderStudents(group); break;
      case 'final': html += renderFinal(group); break;
      case 'partial': html += renderPartial(group); break;
      default: html += renderStudents(group);
    }
    main.innerHTML = html + renderModal();
  }

  function renderTopbar() {
    const sel = document.getElementById('group-select');
    sel.innerHTML = state.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === state.activeGroupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
    sel.disabled = state.groups.length === 0;
    document.getElementById('btn-config').disabled = state.groups.length === 0;
  }

  function renderTabs(group) {
    const t = (id, label, active) => `<button data-action="tab:${id}" class="${active ? 'active' : ''}">${esc(label)}</button>`;
    let html = '<div class="tabs">';
    html += t('students', `Alumnos (${group.students.length})`, ui.tab === 'students');
    for (const p of group.partials) {
      html += `<button data-action="partial:${esc(p.id)}" class="${ui.tab === 'partial' && activePartial(group) === p ? 'active' : ''}">${esc(p.name)}</button>`;
    }
    html += t('final', 'Calificación final', ui.tab === 'final');
    html += '</div>';
    return html;
  }

  // ---- alumnos
  function renderStudents(group) {
    const students = sortedStudents(group);
    let html = `<div class="panel">
      <h2>Alumnos de ${esc(group.name)}</h2>
      <div class="form-row">
        <label>Nombre<input type="text" id="student-name" placeholder="Nombre completo"></label>
        <label>Matrícula / nota (opcional)<input type="text" id="student-code" placeholder=""></label>
        <button class="primary" data-action="student-add">Agregar alumno</button>
      </div>
      <details>
        <summary class="muted">Agregar varios a la vez (pega una lista, un nombre por línea)</summary>
        <textarea id="student-bulk" placeholder="Ana López&#10;Luis Pérez&#10;..."></textarea>
        <p><button data-action="student-bulk">Agregar lista</button></p>
      </details>
    </div>`;
    html += '<div class="panel"><div class="grid-wrap"><table class="grid"><thead><tr><th>Nombre</th><th>Matrícula / nota</th><th></th></tr></thead><tbody>';
    if (!students.length) html += '<tr><td colspan="3" class="muted">Sin alumnos. Agrega el primero arriba.</td></tr>';
    for (const s of students) {
      html += `<tr><td>${esc(s.name)}</td><td>${esc(s.code)}</td><td>
        <button class="small" data-action="student-rename:${esc(s.id)}">Editar</button>
        <button class="small danger" data-action="student-delete:${esc(s.id)}">Eliminar</button></td></tr>`;
    }
    html += '</tbody></table></div></div>';
    return html;
  }

  // ---- parcial
  function renderPartial(group) {
    const partial = activePartial(group);
    if (!partial) return '<div class="empty">Este grupo no tiene parciales. Agrega uno en ⚙ Configurar grupo.</div>';
    const sub = (id, label) => `<button data-action="subtab:${id}" class="${ui.subTab === id ? 'active' : ''}">${esc(label)}</button>`;
    const w = G.settings(group).weights;
    let html = `<div class="tabs sub">
      ${sub('attendance', `Attendance · ${w.attendance}%`)}
      ${sub('participation', `Participation · ${w.participation}%`)}
      ${sub('homework', `Homework · ${w.homework}%`)}
      ${sub('exam', `Exam · ${w.exam}%`)}
      ${sub('summary', 'Resumen del parcial')}
    </div>`;
    if (!group.students.length) {
      return html + '<div class="empty">Primero agrega alumnos en la pestaña “Alumnos”.</div>';
    }
    switch (ui.subTab) {
      case 'attendance': return html + renderMarksGrid(group, partial, 'attendance');
      case 'participation': return html + renderMarksGrid(group, partial, 'participation');
      case 'homework': return html + renderItemsGrid(group, partial, 'homework');
      case 'exam': return html + renderItemsGrid(group, partial, 'exam');
      default: return html + renderSummary(group, partial);
    }
  }

  function renderSessionToolbar(partial) {
    return `<div class="toolbar">
      <label>Fecha <input type="date" id="session-date" value="${todayISO()}"></label>
      <button class="primary" data-action="session-add">＋ Agregar fecha</button>
      <details><summary class="link">Agregar rango de fechas…</summary>
        <div class="toolbar" style="margin-top:6px">
          <label>Desde <input type="date" id="range-from"></label>
          <label>Hasta <input type="date" id="range-to"></label>
          <span>Días:</span>
          ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" class="range-day" value="${d}" ${d >= 1 && d <= 4 ? 'checked' : ''}>${WEEKDAYS[d]}</label>`).join('')}
          <button data-action="session-range">Generar fechas</button>
        </div>
      </details>
      <span class="hint">${partial.sessions.length} sesiones. Haz clic en una celda para cambiar la marca.</span>
    </div>`;
  }

  function renderMarksGrid(group, partial, cat) {
    const isAtt = cat === 'attendance';
    const marks = partial[cat].marks;
    const cycle = isAtt ? G.ATTENDANCE_CYCLE : G.PARTICIPATION_CYCLE;
    const labels = isAtt ? G.ATTENDANCE_LABELS : G.PARTICIPATION_LABELS;
    const cfg = G.settings(group);
    let html = '<div class="panel">' + renderSessionToolbar(partial);
    html += '<div class="grid-wrap"><table class="grid"><thead><tr><th>Alumno</th>';
    for (const s of partial.sessions) {
      html += `<th><div class="col-head"><span class="name" title="${esc(s.date)}">${esc(fmtDate(s.date))}</span>
        <span class="actions"><button title="Eliminar fecha" data-action="session-delete:${esc(s.id)}">×</button></span></div></th>`;
    }
    html += `<th>% ${isAtt ? 'Asist.' : 'Partic.'}</th></tr></thead><tbody>`;
    for (const st of sortedStudents(group)) {
      html += `<tr><td>${esc(st.name)}</td>`;
      const m = marks[st.id] || {};
      for (const s of partial.sessions) {
        const v = cycle.includes(m[s.id]) ? m[s.id] : 'P';
        html += `<td><button class="mark ${v}" title="${esc(labels[v])}" data-action="mark:${cat}:${esc(st.id)}:${esc(s.id)}">${v}</button></td>`;
      }
      const score = isAtt ? G.attendanceScore(partial, st.id, cfg.tardyValue) : G.participationScore(partial, st.id);
      html += `<td class="num total">${fmt(score)}</td></tr>`;
    }
    html += '</tbody></table></div>';
    html += '<div class="legend">' + cycle.map((k) => `<span><button class="mark ${k}" tabindex="-1">${k}</button>${esc(labels[k])}</span>`).join('');
    if (isAtt) html += `<span class="muted">Retardo vale ${cfg.tardyValue === 1 ? 'asistencia completa' : cfg.tardyValue === 0.5 ? 'media asistencia' : 'falta'} (cambiar en ⚙).</span>`;
    else html += '<span class="muted">Al marcar una ausencia en Attendance, la participación de ese día se marca X automáticamente.</span>';
    html += '</div></div>';
    return html;
  }

  function renderItemsGrid(group, partial, cat) {
    const sec = partial[cat];
    const cfg = G.settings(group);
    const label = cat === 'homework' ? 'tarea' : 'examen';
    let html = `<div class="panel"><div class="toolbar">
      <label>Nombre <input type="text" id="item-name" placeholder="${cat === 'homework' ? 'p. ej. Unit 5 Review' : 'p. ej. Examen'}"></label>
      <label>Puntos máx. <input type="number" id="item-max" value="100" min="1" step="any" style="width:80px"></label>
      <button class="primary" data-action="item-add:${cat}">＋ Agregar ${label}</button>
      <span class="hint">Cada ${label} se convierte a porcentaje y se promedian. ${cfg.blankAsZero ? 'Celda vacía cuenta como 0.' : 'Celda vacía no cuenta (escribe 0 si no entregó).'} Enter baja al siguiente alumno.</span>
    </div>`;
    html += '<div class="grid-wrap"><table class="grid"><thead><tr><th>Alumno</th>';
    for (const it of sec.items) {
      html += `<th><div class="col-head"><span class="name" title="${esc(it.name)}">${esc(it.name)}</span><span class="sub muted">/ ${esc(it.max)}</span>
        <span class="actions"><button title="Editar" data-action="item-edit:${cat}:${esc(it.id)}">✎</button><button title="Eliminar" data-action="item-delete:${cat}:${esc(it.id)}">×</button></span></div></th>`;
    }
    html += `<th>% ${cat === 'homework' ? 'Tareas' : 'Examen'}</th></tr></thead><tbody>`;
    for (const st of sortedStudents(group)) {
      html += `<tr><td>${esc(st.name)}</td>`;
      const sc = sec.scores[st.id] || {};
      for (const it of sec.items) {
        const v = typeof sc[it.id] === 'number' ? sc[it.id] : '';
        html += `<td><input type="number" min="0" max="${esc(it.max)}" step="any" value="${esc(v)}" data-change="score:${cat}:${esc(st.id)}:${esc(it.id)}"></td>`;
      }
      html += `<td class="num total">${fmt(G.itemsScore(sec, st.id, cfg.blankAsZero))}</td></tr>`;
    }
    html += '</tbody></table></div>';
    if (!sec.items.length) html += `<p class="muted">Todavía no hay ${label}s en este parcial. Agrega la primera arriba.</p>`;
    html += '</div>';
    return html;
  }

  function renderSummary(group, partial) {
    const cfg = G.settings(group);
    const w = cfg.weights;
    const total = G.weightsTotal(w);
    let html = `<div class="panel"><div class="toolbar">
      <button data-action="csv-partial">Exportar CSV</button>
      <button data-action="print">Imprimir</button>
      <span class="hint">Calificación = ${G.CATEGORIES.map((c) => `${G.CATEGORY_LABELS[c]} × ${w[c]}%`).join(' + ')}.
      Un rubro sin datos se excluye y los pesos se reparten entre los demás.</span>
      ${total !== 100 ? `<span class="pill warn">Los pesos suman ${total}%, no 100%</span>` : ''}
    </div>
    <div class="print-title">${esc(group.name)} · ${esc(partial.name)}</div>
    <div class="grid-wrap"><table class="grid"><thead><tr><th>Alumno</th>
      ${G.CATEGORIES.map((c) => `<th>${G.CATEGORY_LABELS[c]}<br><span class="muted">${w[c]}%</span></th>`).join('')}
      <th>${esc(partial.name)}</th><th>Estado</th></tr></thead><tbody>`;
    for (const st of sortedStudents(group)) {
      const r = G.partialGrade(group, partial, st.id);
      const p = G.passes(r.grade, cfg.passing);
      html += `<tr><td>${esc(st.name)}</td>
        ${G.CATEGORIES.map((c) => `<td class="num">${fmt(r.scores[c])}</td>`).join('')}
        <td class="num total ${gradeClass(r.grade, cfg.passing)}">${fmt(r.grade)}</td>
        <td>${p === null ? '<span class="muted">—</span>' : p ? '<span class="pill ok">Aprobado</span>' : '<span class="pill bad">Reprobado</span>'}</td></tr>`;
    }
    html += '</tbody></table></div></div>';
    return html;
  }

  // ---- final
  function renderFinal(group) {
    const cfg = G.settings(group);
    const wF = cfg.finalExamWeight;
    let html = `<div class="panel"><div class="toolbar">
      <button data-action="csv-final">Exportar CSV</button>
      <button data-action="print">Imprimir</button>
      <span class="hint">Final = promedio de parciales × ${100 - wF}% + examen final × ${wF}%. Aprobatoria: ${cfg.passing}.
      “Necesita en final” es la calificación mínima del examen final para aprobar.</span>
    </div>
    <div class="print-title">${esc(group.name)} · Calificación final</div>
    <div class="grid-wrap"><table class="grid"><thead><tr><th>Alumno</th>
      ${group.partials.map((p) => `<th>${esc(p.name)}</th>`).join('')}
      <th>Promedio<br><span class="muted">${100 - wF}%</span></th>
      ${wF > 0 ? `<th>Examen final<br><span class="muted">${wF}%</span></th><th>Necesita<br>en final</th>` : ''}
      <th>Final</th><th>Estado</th></tr></thead><tbody>`;
    if (!group.students.length) html += '<tr><td colspan="99" class="muted">Sin alumnos.</td></tr>';
    for (const st of sortedStudents(group)) {
      const r = G.finalGrade(group, st.id);
      const p = G.passes(r.final, cfg.passing);
      let needed = '<span class="muted">—</span>';
      if (r.needed !== null && r.finalExam === null) {
        if (r.needed <= 0) needed = '<span class="pill ok">Ya aprobó</span>';
        else if (r.needed > 100) needed = `<span class="pill bad">No alcanza (${fmt(r.needed)})</span>`;
        else needed = `<span class="num">${fmt(r.needed)}</span>`;
      }
      html += `<tr><td>${esc(st.name)}</td>
        ${r.partials.map((pp) => `<td class="num ${gradeClass(pp.grade, cfg.passing)}">${fmt(pp.grade)}</td>`).join('')}
        <td class="num">${fmt(r.average)}</td>
        ${wF > 0 ? `<td><input type="number" min="0" max="100" step="any" value="${r.finalExam === null ? '' : esc(r.finalExam)}" data-change="finalexam:${esc(st.id)}"></td><td>${needed}</td>` : ''}
        <td class="num total ${gradeClass(r.final, cfg.passing)}">${fmt(r.final)}</td>
        <td>${p === null ? '<span class="muted">—</span>' : p ? '<span class="pill ok">Aprobado</span>' : '<span class="pill bad">Reprobado</span>'}</td></tr>`;
    }
    html += '</tbody></table></div></div>';
    return html;
  }

  // ---- modales
  function renderModal() {
    if (!ui.modal) return '';
    if (ui.modal.type === 'config') return renderConfigModal();
    if (ui.modal.type === 'import') return renderImportModal();
    return '';
  }

  function renderConfigModal() {
    const group = activeGroup();
    if (!group) return '';
    const w = group.weights;
    const total = G.weightsTotal(w);
    return `<div class="modal-backdrop" data-action="modal-close"><div class="modal" data-stop>
      <h2>⚙ Configurar grupo</h2>
      <div class="form-row"><label style="flex:1">Nombre del grupo<input type="text" id="cfg-name" value="${esc(group.name)}"></label></div>
      <h3>Pesos por parcial (deben sumar 100%)</h3>
      <div class="form-row">
        ${G.CATEGORIES.map((c) => `<label>${G.CATEGORY_LABELS[c]} %<input type="number" class="cfg-weight" data-cat="${c}" value="${esc(w[c])}" min="0" max="100" step="any"></label>`).join('')}
        <span class="weights-total ${total !== 100 ? 'bad' : ''}" id="cfg-weights-total">Suma: ${total}%</span>
      </div>
      <h3>Calificación final</h3>
      <div class="form-row">
        <label>Peso del examen final %<input type="number" id="cfg-final-weight" value="${esc(group.finalExamWeight)}" min="0" max="100" step="any"></label>
        <label>Calificación aprobatoria<input type="number" id="cfg-passing" value="${esc(group.passing)}" min="0" max="100" step="any"></label>
      </div>
      <p class="muted" style="margin:0 0 8px">El promedio de los parciales vale el resto (${100 - group.finalExamWeight}%). Pon 0 si no hay examen final.</p>
      <h3>Reglas</h3>
      <div class="form-row">
        <label>Un retardo (Tardy) vale
          <select id="cfg-tardy">
            <option value="1" ${group.tardyValue === 1 ? 'selected' : ''}>asistencia completa</option>
            <option value="0.5" ${group.tardyValue === 0.5 ? 'selected' : ''}>media asistencia</option>
            <option value="0" ${group.tardyValue === 0 ? 'selected' : ''}>falta</option>
          </select></label>
        <label class="check"><input type="checkbox" id="cfg-blank" ${group.blankAsZero ? 'checked' : ''}> Tarea o examen sin calificar cuenta como 0</label>
      </div>
      <h3>Parciales</h3>
      <div class="grid-wrap"><table class="grid"><tbody>
        ${group.partials.map((p) => `<tr><td>${esc(p.name)}</td><td class="muted">${p.sessions.length} sesiones · ${p.homework.items.length} tareas · ${p.exam.items.length} exámenes</td>
          <td><button class="small" data-action="partial-rename:${esc(p.id)}">Renombrar</button> <button class="small danger" data-action="partial-delete:${esc(p.id)}">Eliminar</button></td></tr>`).join('')}
      </tbody></table></div>
      <p><button class="small" data-action="partial-add">＋ Agregar parcial</button></p>
      <div class="actions">
        <button class="danger" data-action="group-delete">Eliminar grupo…</button>
        <span class="right"><button data-action="modal-close">Cancelar</button><button class="primary" data-action="config-save">Guardar</button></span>
      </div>
    </div></div>`;
  }

  function renderImportModal() {
    const data = ui.modal.data;
    return `<div class="modal-backdrop" data-action="modal-close"><div class="modal" data-stop>
      <h2>Restaurar respaldo</h2>
      <p>El archivo contiene ${data.groups.length} grupo(s): ${data.groups.map((g) => esc(g.name) + ' (' + g.students.length + ' alumnos)').join(', ')}.</p>
      <p>Actualmente tienes ${state.groups.length} grupo(s). ¿Qué quieres hacer?</p>
      <div class="actions">
        <button data-action="modal-close">Cancelar</button>
        <span class="right">
          <button data-action="import-merge">Agregar a los grupos actuales</button>
          <button class="danger" data-action="import-replace">Reemplazar todo</button>
        </span>
      </div>
    </div></div>`;
  }

  // ------------------------------------------------------------ acciones
  function readConfigModal(group) {
    const name = document.getElementById('cfg-name').value.trim();
    if (name) group.name = name;
    for (const el of document.querySelectorAll('.cfg-weight')) {
      const v = parseFloat(el.value);
      group.weights[el.dataset.cat] = Number.isFinite(v) ? Math.max(0, v) : 0;
    }
    const fw = parseFloat(document.getElementById('cfg-final-weight').value);
    group.finalExamWeight = Number.isFinite(fw) ? Math.min(100, Math.max(0, fw)) : 0;
    const ps = parseFloat(document.getElementById('cfg-passing').value);
    group.passing = Number.isFinite(ps) ? ps : G.DEFAULTS.passing;
    group.tardyValue = parseFloat(document.getElementById('cfg-tardy').value);
    group.blankAsZero = document.getElementById('cfg-blank').checked;
  }

  function addSessions(partial, dates) {
    const existing = new Set(partial.sessions.map((s) => s.date));
    let added = 0;
    for (const d of dates) {
      if (!d || existing.has(d)) continue;
      partial.sessions.push({ id: uid(), date: d });
      existing.add(d);
      added++;
    }
    sortSessions(partial);
    return added;
  }

  function handleAction(action, el) {
    const [name, ...args] = action.split(':');
    const group = activeGroup();
    const partial = activePartial(group);

    switch (name) {
      case 'tab':
        ui.tab = args[0];
        return render();
      case 'partial':
        ui.tab = 'partial';
        ui.partialId = args[0];
        return render();
      case 'subtab':
        ui.subTab = args[0];
        return render();
      case 'print':
        return window.print();

      // -- grupos
      case 'group-new': {
        const n = prompt('Nombre del nuevo grupo (p. ej. Inglés II):');
        if (!n || !n.trim()) return;
        const g = newGroup(n.trim());
        state.groups.push(g);
        state.activeGroupId = g.id;
        ui.tab = 'students';
        ui.partialId = null;
        return commit();
      }
      case 'group-config':
        ui.modal = { type: 'config' };
        return render();
      case 'config-save':
        readConfigModal(group);
        ui.modal = null;
        return commit();
      case 'group-delete':
        if (!confirm(`¿Eliminar el grupo "${group.name}" con todos sus alumnos y calificaciones? Esta acción no se puede deshacer.`)) return;
        state.groups = state.groups.filter((g) => g !== group);
        state.activeGroupId = state.groups.length ? state.groups[0].id : null;
        ui.modal = null;
        ui.tab = 'students';
        return commit();
      case 'modal-close':
        ui.modal = null;
        return render();

      // -- parciales (dentro del modal de configuración)
      case 'partial-add':
        readConfigModal(group);
        group.partials.push(newPartial(group.partials.length + 1));
        return commit();
      case 'partial-rename': {
        const p = group.partials.find((x) => x.id === args[0]);
        const n = prompt('Nombre del parcial:', p.name);
        if (!n || !n.trim()) return;
        readConfigModal(group);
        p.name = n.trim();
        return commit();
      }
      case 'partial-delete': {
        const p = group.partials.find((x) => x.id === args[0]);
        if (!confirm(`¿Eliminar "${p.name}" con sus sesiones, tareas y exámenes?`)) return;
        readConfigModal(group);
        group.partials = group.partials.filter((x) => x !== p);
        if (ui.partialId === p.id) ui.partialId = null;
        return commit();
      }

      // -- alumnos
      case 'student-add': {
        const nameEl = document.getElementById('student-name');
        const n = nameEl.value.trim();
        if (!n) return nameEl.focus();
        group.students.push({ id: uid(), name: n, code: document.getElementById('student-code').value.trim() });
        return commit();
      }
      case 'student-bulk': {
        const lines = document.getElementById('student-bulk').value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!lines.length) return;
        for (const n of lines) group.students.push({ id: uid(), name: n, code: '' });
        toast(`${lines.length} alumno(s) agregados`);
        return commit();
      }
      case 'student-rename': {
        const s = group.students.find((x) => x.id === args[0]);
        const n = prompt('Nombre del alumno:', s.name);
        if (n === null) return;
        const c = prompt('Matrícula / nota (opcional):', s.code || '');
        if (n.trim()) s.name = n.trim();
        if (c !== null) s.code = c.trim();
        return commit();
      }
      case 'student-delete': {
        const s = group.students.find((x) => x.id === args[0]);
        if (!confirm(`¿Eliminar a "${s.name}" y todas sus calificaciones?`)) return;
        group.students = group.students.filter((x) => x !== s);
        for (const p of group.partials) {
          delete p.attendance.marks[s.id];
          delete p.participation.marks[s.id];
          delete p.homework.scores[s.id];
          delete p.exam.scores[s.id];
        }
        delete group.finalExam[s.id];
        return commit();
      }

      // -- sesiones
      case 'session-add': {
        const d = document.getElementById('session-date').value;
        if (!d) return;
        if (addSessions(partial, [d]) === 0) toast('Esa fecha ya existe');
        return commit();
      }
      case 'session-range': {
        const from = document.getElementById('range-from').value;
        const to = document.getElementById('range-to').value;
        const days = Array.from(document.querySelectorAll('.range-day:checked')).map((x) => Number(x.value));
        if (!from || !to || from > to) return toast('Indica un rango de fechas válido');
        if (!days.length) return toast('Selecciona al menos un día de la semana');
        const dates = [];
        const cur = parseISO(from);
        const end = parseISO(to);
        while (cur <= end && dates.length < 400) {
          if (days.includes(cur.getDay())) {
            dates.push([cur.getFullYear(), String(cur.getMonth() + 1).padStart(2, '0'), String(cur.getDate()).padStart(2, '0')].join('-'));
          }
          cur.setDate(cur.getDate() + 1);
        }
        toast(`${addSessions(partial, dates)} fecha(s) agregadas`);
        return commit();
      }
      case 'session-delete': {
        const s = partial.sessions.find((x) => x.id === args[0]);
        if (!confirm(`¿Eliminar la sesión del ${fmtDate(s.date)}? Se borran las marcas de asistencia y participación de ese día.`)) return;
        partial.sessions = partial.sessions.filter((x) => x !== s);
        for (const cat of ['attendance', 'participation']) {
          for (const sid of Object.keys(partial[cat].marks)) delete partial[cat].marks[sid][s.id];
        }
        return commit();
      }
      case 'mark': {
        const [cat, studentId, sessionId] = args;
        const cycle = cat === 'attendance' ? G.ATTENDANCE_CYCLE : G.PARTICIPATION_CYCLE;
        const marks = partial[cat].marks;
        marks[studentId] = marks[studentId] || {};
        const cur = cycle.includes(marks[studentId][sessionId]) ? marks[studentId][sessionId] : 'P';
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        marks[studentId][sessionId] = next;
        if (cat === 'attendance') {
          // Ausente => no participó ese día; presente de nuevo => participó.
          const pm = partial.participation.marks;
          pm[studentId] = pm[studentId] || {};
          if (next === 'A') pm[studentId][sessionId] = 'X';
          else if (cur === 'A') pm[studentId][sessionId] = 'P';
        }
        return commit();
      }

      // -- tareas / exámenes
      case 'item-add': {
        const cat = args[0];
        const nameEl = document.getElementById('item-name');
        const n = nameEl.value.trim() || (cat === 'homework' ? `Tarea ${partial[cat].items.length + 1}` : `Examen ${partial[cat].items.length + 1}`);
        const max = parseFloat(document.getElementById('item-max').value);
        if (!Number.isFinite(max) || max <= 0) return toast('Los puntos máximos deben ser mayores a 0');
        partial[cat].items.push({ id: uid(), name: n, max });
        return commit();
      }
      case 'item-edit': {
        const [cat, id] = args;
        const it = partial[cat].items.find((x) => x.id === id);
        const n = prompt('Nombre:', it.name);
        if (n === null) return;
        const m = prompt('Puntos máximos:', it.max);
        if (m === null) return;
        const max = parseFloat(m);
        if (n.trim()) it.name = n.trim();
        if (Number.isFinite(max) && max > 0) it.max = max;
        return commit();
      }
      case 'item-delete': {
        const [cat, id] = args;
        const it = partial[cat].items.find((x) => x.id === id);
        if (!confirm(`¿Eliminar "${it.name}" y sus calificaciones?`)) return;
        partial[cat].items = partial[cat].items.filter((x) => x !== it);
        for (const sid of Object.keys(partial[cat].scores)) delete partial[cat].scores[sid][id];
        return commit();
      }

      // -- respaldo / exportación
      case 'backup-export':
        download(`calificaciones-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
        return toast('Respaldo descargado');
      case 'backup-import':
        return document.getElementById('file-import').click();
      case 'salir':
        return salir();
      case 'import-replace':
        state = ui.modal.data;
        ui.modal = null;
        ui.tab = 'students';
        ui.partialId = null;
        toast('Respaldo restaurado');
        return commit();
      case 'import-merge': {
        const incoming = ui.modal.data;
        const ids = new Set(state.groups.map((g) => g.id));
        for (const g of incoming.groups) {
          if (ids.has(g.id)) g.id = uid();
          state.groups.push(g);
        }
        state.activeGroupId = incoming.groups.length ? incoming.groups[0].id : state.activeGroupId;
        ui.modal = null;
        ui.tab = 'students';
        toast(`${incoming.groups.length} grupo(s) agregados`);
        return commit();
      }
      case 'csv-partial': {
        const cfg = G.settings(group);
        const rows = [['Alumno', ...G.CATEGORIES.map((c) => `${G.CATEGORY_LABELS[c]} (${cfg.weights[c]}%)`), partial.name, 'Estado']];
        for (const st of sortedStudents(group)) {
          const r = G.partialGrade(group, partial, st.id);
          const p = G.passes(r.grade, cfg.passing);
          rows.push([st.name, ...G.CATEGORIES.map((c) => fmt(r.scores[c])), fmt(r.grade), p === null ? '' : p ? 'Aprobado' : 'Reprobado']);
        }
        return download(`${slug(group.name)}-${slug(partial.name)}.csv`, csv(rows), 'text/csv');
      }
      case 'csv-final': {
        const cfg = G.settings(group);
        const rows = [['Alumno', ...group.partials.map((p) => p.name), 'Promedio', 'Examen final', 'Necesita en final', 'Final', 'Estado']];
        for (const st of sortedStudents(group)) {
          const r = G.finalGrade(group, st.id);
          const p = G.passes(r.final, cfg.passing);
          rows.push([st.name, ...r.partials.map((pp) => fmt(pp.grade)), fmt(r.average), fmt(r.finalExam), r.finalExam === null ? fmt(r.needed) : '', fmt(r.final), p === null ? '' : p ? 'Aprobado' : 'Reprobado']);
        }
        return download(`${slug(group.name)}-final.csv`, csv(rows), 'text/csv');
      }
      default:
        console.warn('Acción desconocida', action);
    }
  }

  function handleChange(key, el) {
    const [name, ...args] = key.split(':');
    const group = activeGroup();
    const partial = activePartial(group);
    const raw = el.value.trim();
    const v = raw === '' ? null : parseFloat(raw);
    if (raw !== '' && !Number.isFinite(v)) return;
    switch (name) {
      case 'score': {
        const [cat, studentId, itemId] = args;
        const sc = partial[cat].scores;
        sc[studentId] = sc[studentId] || {};
        if (v === null) delete sc[studentId][itemId];
        else sc[studentId][itemId] = Math.max(0, v);
        return commit();
      }
      case 'finalexam': {
        if (v === null) delete group.finalExam[args[0]];
        else group.finalExam[args[0]] = Math.min(100, Math.max(0, v));
        return commit();
      }
    }
  }

  // ------------------------------------------------------------ eventos
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Clic dentro del modal no debe cerrarlo (el backdrop tiene data-action=modal-close).
    if (el.dataset.action === 'modal-close' && e.target.closest('[data-stop]') && e.target !== el) return;
    e.preventDefault();
    handleAction(el.dataset.action, el);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'group-select') {
      state.activeGroupId = el.value;
      ui.tab = 'students';
      ui.partialId = null;
      return commit();
    }
    if (el.id === 'file-import') {
      const file = el.files[0];
      el.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = normalize(JSON.parse(reader.result));
          if (!state.groups.length) {
            state = data;
            ui.tab = 'students';
            ui.partialId = null;
            toast('Respaldo restaurado');
            return commit();
          }
          ui.modal = { type: 'import', data };
          render();
        } catch (err) {
          alert('No se pudo leer el archivo: ' + err.message);
        }
      };
      reader.readAsText(file);
      return;
    }
    if (el.classList.contains('cfg-weight')) {
      let total = 0;
      for (const w of document.querySelectorAll('.cfg-weight')) total += parseFloat(w.value) || 0;
      const t = document.getElementById('cfg-weights-total');
      t.textContent = `Suma: ${G.round1(total)}%`;
      t.classList.toggle('bad', G.round1(total) !== 100);
      return;
    }
    if (el.dataset.change) handleChange(el.dataset.change, el);
  });

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && el.matches && el.matches('table.grid input')) {
      e.preventDefault();
      const td = el.closest('td');
      const tr = td.parentElement;
      const idx = Array.prototype.indexOf.call(tr.children, td);
      const rowIdx = Array.prototype.indexOf.call(tr.parentElement.children, tr);
      el.blur(); // dispara 'change' y el re-render (la tabla se vuelve a crear)
      const rows = document.querySelectorAll('table.grid tbody tr');
      const next = rows[rowIdx + 1];
      const target = next && next.children[idx] && next.children[idx].querySelector('input');
      if (target) { target.focus(); target.select(); }
    }
    if (e.key === 'Enter' && el.id === 'student-name') handleAction('student-add', el);
    if (e.key === 'Enter' && el.id === 'item-name') handleAction('item-add:' + (ui.subTab === 'exam' ? 'exam' : 'homework'), el);
    if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); }
  });

  document.getElementById('acceso-form').addEventListener('submit', (e) => {
    e.preventDefault();
    entrar(document.getElementById('acceso-clave').value);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? enviar() : refrescar()));
  window.addEventListener('focus', refrescar);
  window.addEventListener('online', () => (sync.pendiente ? enviar() : refrescar()));
  setInterval(refrescar, 60000);

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  // Para depuración desde la consola.
  window.AbbysGrades = { get state() { return state; }, get sync() { return sync; }, render, normalize };
})();
