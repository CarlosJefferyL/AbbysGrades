/*
 * API de Abby's Grades: guarda el estado completo de la aplicación (el mismo
 * JSON que descarga el botón «Respaldar») en un archivo dentro de un volumen,
 * detrás de una contraseña única.
 *
 * Sin dependencias: sólo módulos de Node. La aplicación es un documento por
 * usuario y una sola usuaria, así que una base de datos sería más piezas que
 * datos. El archivo se escribe de forma atómica (temporal + rename) y lleva un
 * número de versión para que dos dispositivos no se pisen los cambios.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TAMANO_MAXIMO = 5 * 1024 * 1024; // el respaldo de un semestre pesa unos KB
const DIAS_SESION = 30;
const RESPALDOS_A_CONSERVAR = 30;
// Intentos fallidos permitidos por dirección antes de bloquearla un rato. La
// contraseña es una sola y no hay usuario que adivinar, así que esto es lo
// único que frena un ataque de fuerza bruta.
const INTENTOS_MAXIMOS = 5;
const VENTANA_INTENTOS_MS = 10 * 60 * 1000;

function configurar(env = process.env) {
  const faltan = ['CLAVE_ACCESO', 'SECRET_KEY'].filter((v) => !env[v]);
  if (faltan.length) {
    throw new Error(`Faltan variables de entorno: ${faltan.join(', ')}`);
  }
  if (env.SECRET_KEY === 'cambiar-en-produccion' || env.SECRET_KEY.length < 32) {
    throw new Error('SECRET_KEY debe ser un valor propio de al menos 32 caracteres (openssl rand -hex 32)');
  }
  return {
    claveAcceso: env.CLAVE_ACCESO,
    secretKey: env.SECRET_KEY,
    directorioDatos: env.DIRECTORIO_DATOS || '/datos',
    puerto: Number(env.PUERTO || 8000),
    cookieSegura: String(env.COOKIE_SEGURA || 'false') === 'true',
  };
}

function crearServidor(config) {
  const archivoDatos = path.join(config.directorioDatos, 'calificaciones.json');
  const directorioRespaldos = path.join(config.directorioDatos, 'respaldos');
  fs.mkdirSync(directorioRespaldos, { recursive: true });

  // ---------------------------------------------------------------- sesión
  // La cookie es `caducidad.firma`. La firma cubre también un resumen de la
  // contraseña: cambiarla en el servidor cierra todas las sesiones abiertas,
  // que es lo que uno espera al cambiar una contraseña.
  const resumenClave = crypto.createHash('sha256').update(config.claveAcceso).digest('hex');

  function firmar(caducidad) {
    return crypto.createHmac('sha256', config.secretKey).update(`${caducidad}.${resumenClave}`).digest('hex');
  }

  function emitirCookie() {
    const caducidad = Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000;
    const valor = `${caducidad}.${firmar(caducidad)}`;
    const atributos = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${DIAS_SESION * 24 * 60 * 60}`];
    if (config.cookieSegura) atributos.push('Secure');
    return `sesion=${valor}; ${atributos.join('; ')}`;
  }

  function cookieVacia() {
    return 'sesion=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
  }

  function sesionValida(req) {
    const cookies = String(req.headers.cookie || '');
    const m = /(?:^|;\s*)sesion=([^;]+)/.exec(cookies);
    if (!m) return false;
    const [caducidad, firma] = m[1].split('.');
    if (!caducidad || !firma || Number(caducidad) < Date.now()) return false;
    const esperada = Buffer.from(firmar(caducidad));
    const recibida = Buffer.from(firma);
    return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
  }

  function claveCorrecta(clave) {
    const a = Buffer.from(String(clave || ''));
    const b = Buffer.from(config.claveAcceso);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // ------------------------------------------------------- fuerza bruta
  const intentos = new Map(); // ip -> { cuenta, desde }

  function bloqueada(ip) {
    const r = intentos.get(ip);
    if (!r) return false;
    if (Date.now() - r.desde > VENTANA_INTENTOS_MS) {
      intentos.delete(ip);
      return false;
    }
    return r.cuenta >= INTENTOS_MAXIMOS;
  }

  function registrarFallo(ip) {
    const r = intentos.get(ip);
    if (!r || Date.now() - r.desde > VENTANA_INTENTOS_MS) intentos.set(ip, { cuenta: 1, desde: Date.now() });
    else r.cuenta += 1;
  }

  function direccion(req) {
    // Detrás de Caddy/Traefik la IP real viene en X-Forwarded-For; la del
    // socket sería siempre la del proxy y el límite bloquearía a todo el mundo.
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return xff || req.socket.remoteAddress || '?';
  }

  // ------------------------------------------------------------- datos
  async function leerDatos() {
    try {
      return JSON.parse(await fsp.readFile(archivoDatos, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 0, actualizado: null, datos: null };
      throw e;
    }
  }

  async function respaldoDiario() {
    // Una copia por día del archivo ANTES de sobreescribirlo, como red de
    // seguridad contra un «Restaurar» con el archivo equivocado o un borrado
    // accidental. Se conservan los últimos 30 días.
    const hoy = new Date().toISOString().slice(0, 10);
    const destino = path.join(directorioRespaldos, `calificaciones-${hoy}.json`);
    if (fs.existsSync(destino) || !fs.existsSync(archivoDatos)) return;
    await fsp.copyFile(archivoDatos, destino);
    const viejos = (await fsp.readdir(directorioRespaldos)).filter((n) => n.startsWith('calificaciones-')).sort();
    for (const n of viejos.slice(0, Math.max(0, viejos.length - RESPALDOS_A_CONSERVAR))) {
      await fsp.unlink(path.join(directorioRespaldos, n));
    }
  }

  async function escribirDatos(registro) {
    await respaldoDiario();
    const temporal = `${archivoDatos}.tmp`;
    await fsp.writeFile(temporal, JSON.stringify(registro), 'utf8');
    await fsp.rename(temporal, archivoDatos);
  }

  // Las escrituras van en fila: dos PUT simultáneos leerían la misma versión y
  // el segundo pisaría al primero sin que el control de versión lo detecte.
  let cola = Promise.resolve();
  function enFila(fn) {
    const resultado = cola.then(fn, fn);
    cola = resultado.catch(() => {});
    return resultado;
  }

  function datosValidos(datos) {
    return datos && typeof datos === 'object' && !Array.isArray(datos) && Array.isArray(datos.groups);
  }

  // -------------------------------------------------------------- http
  function responder(res, codigo, cuerpo, cabeceras = {}) {
    const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
    res.writeHead(codigo, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }, cabeceras));
    res.end(texto);
  }

  function leerCuerpo(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) {
        return reject(Object.assign(new Error('Se esperaba application/json'), { codigo: 415 }));
      }
      const partes = [];
      let total = 0;
      req.on('data', (p) => {
        total += p.length;
        if (total > TAMANO_MAXIMO) {
          reject(Object.assign(new Error('Cuerpo demasiado grande'), { codigo: 413 }));
          req.destroy();
          return;
        }
        partes.push(p);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'));
        } catch (e) {
          reject(Object.assign(new Error('JSON inválido'), { codigo: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  async function atender(req, res) {
    const url = new URL(req.url, 'http://x');
    const ruta = url.pathname;

    if (ruta === '/api/salud' && req.method === 'GET') return responder(res, 200, { ok: true });

    if (ruta === '/api/sesion') {
      if (req.method === 'GET') return responder(res, sesionValida(req) ? 204 : 401);
      if (req.method === 'DELETE') return responder(res, 204, undefined, { 'Set-Cookie': cookieVacia() });
      if (req.method === 'POST') {
        const ip = direccion(req);
        if (bloqueada(ip)) return responder(res, 429, { error: 'Demasiados intentos. Espera 10 minutos.' });
        const cuerpo = await leerCuerpo(req);
        if (!claveCorrecta(cuerpo.clave)) {
          registrarFallo(ip);
          return responder(res, 401, { error: 'Contraseña incorrecta' });
        }
        intentos.delete(ip);
        return responder(res, 204, undefined, { 'Set-Cookie': emitirCookie() });
      }
      return responder(res, 405, { error: 'Método no permitido' });
    }

    if (ruta === '/api/datos') {
      if (!sesionValida(req)) return responder(res, 401, { error: 'Sesión no válida' });
      if (req.method === 'GET') {
        const r = await leerDatos();
        return responder(res, 200, { version: r.version, actualizado: r.actualizado, datos: r.datos });
      }
      if (req.method === 'PUT') {
        const cuerpo = await leerCuerpo(req);
        if (!datosValidos(cuerpo.datos)) return responder(res, 400, { error: 'Los datos no tienen el formato esperado' });
        if (!Number.isInteger(cuerpo.version)) return responder(res, 400, { error: 'Falta la versión' });
        return enFila(async () => {
          const actual = await leerDatos();
          if (cuerpo.version !== actual.version) {
            // Otro dispositivo guardó antes. Se devuelve lo vigente para que el
            // cliente lo cargue en vez de sobreescribirlo a ciegas.
            return responder(res, 409, { version: actual.version, actualizado: actual.actualizado, datos: actual.datos });
          }
          const registro = { version: actual.version + 1, actualizado: new Date().toISOString(), datos: cuerpo.datos };
          await escribirDatos(registro);
          return responder(res, 200, { version: registro.version, actualizado: registro.actualizado });
        });
      }
      return responder(res, 405, { error: 'Método no permitido' });
    }

    return responder(res, 404, { error: 'No existe' });
  }

  return http.createServer((req, res) => {
    atender(req, res).catch((e) => {
      if (e.codigo) return responder(res, e.codigo, { error: e.message });
      console.error(e);
      responder(res, 500, { error: 'Error interno' });
    });
  });
}

module.exports = { configurar, crearServidor };

if (require.main === module) {
  let config;
  try {
    config = configurar();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const servidor = crearServidor(config);
  servidor.listen(config.puerto, '0.0.0.0', () => {
    console.log(`API escuchando en :${config.puerto}, datos en ${config.directorioDatos}`);
  });
  // Docker manda SIGTERM al detener el contenedor; sin esto Node lo ignora y
  // Docker espera 10 s antes de matarlo.
  for (const señal of ['SIGTERM', 'SIGINT']) process.on(señal, () => servidor.close(() => process.exit(0)));
}
