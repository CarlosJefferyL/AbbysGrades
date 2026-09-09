const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configurar, crearServidor } = require('../servidor.js');

const CLAVE = 'abby-2026';
const SECRET = 'x'.repeat(64);

function entorno(extra = {}) {
  return Object.assign({ CLAVE_ACCESO: CLAVE, SECRET_KEY: SECRET }, extra);
}

async function levantar(directorio) {
  const servidor = crearServidor(configurar(entorno({ DIRECTORIO_DATOS: directorio })));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    base,
    cerrar: () => new Promise((r) => servidor.close(r)),
    pedir: (ruta, opciones = {}) => fetch(base + ruta, Object.assign({}, opciones, {
      headers: Object.assign({ 'Content-Type': 'application/json' }, opciones.headers || {}),
    })),
  };
}

async function iniciarSesion(s, clave = CLAVE) {
  const r = await s.pedir('/api/sesion', { method: 'POST', body: JSON.stringify({ clave }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie };
}

const datos = (nombre) => ({ version: 1, groups: [{ id: 'g1', name: nombre }], activeGroupId: 'g1' });

test('configurar exige las variables y rechaza un SECRET_KEY débil', () => {
  assert.throws(() => configurar({}), /CLAVE_ACCESO, SECRET_KEY/);
  assert.throws(() => configurar({ CLAVE_ACCESO: 'x', SECRET_KEY: 'corta' }), /32 caracteres/);
  assert.throws(() => configurar({ CLAVE_ACCESO: 'x', SECRET_KEY: 'cambiar-en-produccion' }), /SECRET_KEY/);
  assert.equal(configurar(entorno()).directorioDatos, '/datos');
});

test('sin sesión no hay datos; con la contraseña correcta sí', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  const s = await levantar(dir);
  try {
    assert.equal((await s.pedir('/api/datos')).status, 401);
    assert.equal((await s.pedir('/api/sesion')).status, 401);

    const mala = await iniciarSesion(s, 'otra');
    assert.equal(mala.r.status, 401);
    assert.equal(mala.cookie, '');

    const { r, cookie } = await iniciarSesion(s);
    assert.equal(r.status, 204);
    assert.match(cookie, /^sesion=\d+\.[0-9a-f]{64}$/);
    assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await s.pedir('/api/sesion', { headers: { Cookie: cookie } })).status, 204);

    const vacio = await (await s.pedir('/api/datos', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(vacio, { version: 0, actualizado: null, datos: null });
  } finally {
    await s.cerrar();
  }
});

test('una cookie con firma alterada no vale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  const s = await levantar(dir);
  try {
    const { cookie } = await iniciarSesion(s);
    const alterada = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');
    assert.equal((await s.pedir('/api/datos', { headers: { Cookie: alterada } })).status, 401);
    const caducada = `sesion=${Date.now() - 1000}.${'0'.repeat(64)}`;
    assert.equal((await s.pedir('/api/datos', { headers: { Cookie: caducada } })).status, 401);
  } finally {
    await s.cerrar();
  }
});

test('guardar y leer, con control de versión y persistencia entre reinicios', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  let s = await levantar(dir);
  let cookie;
  try {
    cookie = (await iniciarSesion(s)).cookie;
    const h = { Cookie: cookie };

    const r1 = await s.pedir('/api/datos', { method: 'PUT', headers: h, body: JSON.stringify({ version: 0, datos: datos('Inglés I') }) });
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).version, 1);

    // Un dispositivo con la versión vieja no puede pisar lo guardado.
    const viejo = await s.pedir('/api/datos', { method: 'PUT', headers: h, body: JSON.stringify({ version: 0, datos: datos('Pisado') }) });
    assert.equal(viejo.status, 409);
    const vigente = await viejo.json();
    assert.equal(vigente.version, 1);
    assert.equal(vigente.datos.groups[0].name, 'Inglés I');

    const r2 = await s.pedir('/api/datos', { method: 'PUT', headers: h, body: JSON.stringify({ version: 1, datos: datos('Inglés II') }) });
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).version, 2);

    // Formato inválido y cuerpo que no es JSON.
    const malo = await s.pedir('/api/datos', { method: 'PUT', headers: h, body: JSON.stringify({ version: 2, datos: { sinGrupos: true } }) });
    assert.equal(malo.status, 400);
    const noJson = await s.pedir('/api/datos', { method: 'PUT', headers: h, body: '{rota' });
    assert.equal(noJson.status, 400);
    const formulario = await s.pedir('/api/datos', { method: 'PUT', headers: Object.assign({}, h, { 'Content-Type': 'text/plain' }), body: '{}' });
    assert.equal(formulario.status, 415);
  } finally {
    await s.cerrar();
  }

  // Un servidor nuevo sobre el mismo directorio ve lo mismo: es el archivo
  // del volumen, no memoria del proceso.
  s = await levantar(dir);
  try {
    const r = await (await s.pedir('/api/datos', { headers: { Cookie: cookie } })).json();
    assert.equal(r.version, 2);
    assert.equal(r.datos.groups[0].name, 'Inglés II');
    assert.ok(!fs.existsSync(path.join(dir, 'calificaciones.json.tmp')), 'no queda el temporal');
  } finally {
    await s.cerrar();
  }
});

test('escrituras simultáneas no se pierden: sólo una gana por versión', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  const s = await levantar(dir);
  try {
    const h = { Cookie: (await iniciarSesion(s)).cookie };
    const respuestas = await Promise.all([1, 2, 3, 4, 5].map((i) =>
      s.pedir('/api/datos', { method: 'PUT', headers: h, body: JSON.stringify({ version: 0, datos: datos('c' + i) }) })));
    const codigos = respuestas.map((r) => r.status).sort();
    assert.deepEqual(codigos, [200, 409, 409, 409, 409]);
    const final = await (await s.pedir('/api/datos', { headers: h })).json();
    assert.equal(final.version, 1);
  } finally {
    await s.cerrar();
  }
});

test('guarda una copia diaria antes de sobreescribir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  const s = await levantar(dir);
  try {
    const h = { Cookie: (await iniciarSesion(s)).cookie };
    const poner = (v, n) => s.pedir('/api/datos', { method: 'PUT', headers: h, body: JSON.stringify({ version: v, datos: datos(n) }) });
    await poner(0, 'primero');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'respaldos')), [], 'la primera escritura no tiene nada que respaldar');
    await poner(1, 'segundo');
    await poner(2, 'tercero');
    const copias = fs.readdirSync(path.join(dir, 'respaldos'));
    assert.equal(copias.length, 1, 'una sola copia por día');
    const copia = JSON.parse(fs.readFileSync(path.join(dir, 'respaldos', copias[0]), 'utf8'));
    assert.equal(copia.datos.groups[0].name, 'primero', 'la copia es lo que había ANTES de la primera sobreescritura del día');
  } finally {
    await s.cerrar();
  }
});

test('cinco contraseñas malas bloquean la dirección', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  const s = await levantar(dir);
  try {
    for (let i = 0; i < 5; i++) assert.equal((await iniciarSesion(s, 'mala')).r.status, 401);
    assert.equal((await iniciarSesion(s, CLAVE)).r.status, 429, 'incluso la correcta, mientras dura el bloqueo');
    // Otra dirección (según X-Forwarded-For, como llega detrás del proxy) no está bloqueada.
    const otra = await s.pedir('/api/sesion', { method: 'POST', headers: { 'X-Forwarded-For': '10.0.0.9' }, body: JSON.stringify({ clave: CLAVE }) });
    assert.equal(otra.status, 204);
  } finally {
    await s.cerrar();
  }
});

test('cerrar sesión vacía la cookie', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbys-'));
  const s = await levantar(dir);
  try {
    const r = await s.pedir('/api/sesion', { method: 'DELETE' });
    assert.equal(r.status, 204);
    assert.match(r.headers.get('set-cookie'), /^sesion=; .*Max-Age=0/);
  } finally {
    await s.cerrar();
  }
});
