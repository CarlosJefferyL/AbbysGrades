# Dónde vive Abby's Grades y cómo se trabaja

## Las piezas

| Pieza | Dónde vive | Para qué |
|---|---|---|
| **Código** | GitHub, `CarlosJefferyL/AbbysGrades` | La fuente de verdad. Todo cambio pasa por aquí. |
| **Aplicación** | Coolify, en `https://abbysgrades.jeffco.mx` | La liga que abre la maestra. Coolify construye desde GitHub. |
| **Datos** | Volumen `datos` del servicio `api`, en el VPS | Grupos, alumnos, asistencias y calificaciones: un archivo `calificaciones.json` más una copia diaria. |

La app se abre desde cualquier dispositivo con la misma contraseña y muestra lo mismo: cada
cambio se sube al servidor al momento (arriba a la derecha dice «Guardado en el servidor»). Si
se pierde la conexión, se sigue trabajando y se sube al reconectar. Si dos dispositivos guardan
a la vez, gana el primero y el segundo recibe un aviso y carga lo del servidor.

`index.html` abierto a doble clic sigue funcionando como antes, **sólo en ese navegador** (lo
dice el indicador). Es el modo sin servidor; no se sincroniza con nada.

## Trabajar sin computadora (tablet o celular)

No hace falta tener el proyecto instalado en ninguna máquina:

- **Cambiar código**: se pide en la sesión de Claude Code, que trabaja sobre una rama y la sube a
  GitHub.
- **Desplegar**: en Coolify, botón **Deploy** del recurso. Construye la rama configurada (corre
  las pruebas en el build; si fallan, no despliega) y reinicia los contenedores.
- **Cambiar la contraseña**: en Coolify, variable `CLAVE_ACCESO`, y **Redeploy**. Cierra las
  sesiones abiertas en todos los navegadores.
- **Ver o copiar los datos**: en Coolify, **Terminal** del contenedor `api`:
  `cat /datos/calificaciones.json`. O desde la app, botón **Respaldar**.

## Configuración en Coolify

| Variable | Qué es |
|---|---|
| `CLAVE_ACCESO` | La contraseña para entrar a la app. **Obligatoria.** |
| `SECRET_KEY` | Firma la cookie de sesión. Generar con `openssl rand -hex 32`. **Obligatoria.** |

El dominio se asigna al servicio `web` desde Coolify (ver `deploy/DEPLOY-COOLIFY.md`).

## Desarrollo local (opcional)

Sin dependencias que instalar: la app es HTML, CSS y JavaScript sin bundler, la API es Node sin
paquetes, y las pruebas usan `node:test`, que viene con Node 22.

```bash
npm test          # pruebas del cálculo (test/) y de la API (api/test/)
npm start         # sirve la página en http://localhost:8080, en modo local (sin API)
```

Para probar con la API se necesita que página y API estén en el mismo origen, que es lo que hace
Caddy en el despliegue. La forma más fiel es levantar el paquete de Docker: «Probar el paquete en
local» en `deploy/DEPLOY.md`. Para correr sólo la API (por ejemplo para probar con `curl`):

```bash
CLAVE_ACCESO=prueba SECRET_KEY=$(openssl rand -hex 32) DIRECTORIO_DATOS=./datos-local npm run start:api
```

`datos-local/` está en `.gitignore`.
