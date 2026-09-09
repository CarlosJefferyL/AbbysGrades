# Dónde vive Abby's Grades y cómo se trabaja

## Las piezas

| Pieza | Dónde vive | Para qué |
|---|---|---|
| **Código** | GitHub, `CarlosJefferyL/AbbysGrades` | La fuente de verdad. Todo cambio pasa por aquí. |
| **Aplicación** | Coolify, en `https://abbysgrades.jeffco.mx` | La liga que abre la maestra. Coolify construye desde GitHub. |
| **Datos** | **El navegador de cada quien** (`localStorage`) | Grupos, alumnos, asistencias y calificaciones. |

Lo que hay que tener claro: **el servidor no guarda los datos.** Es una página estática; lo que
se captura queda en el navegador donde se capturó. Si la maestra usa la app en su laptop y luego
la abre en el celular, el celular arranca vacío. Para pasar datos de un lado a otro es
**Respaldar** (descarga un `.json`) → **Restaurar** en el otro navegador. Y conviene respaldar
seguido: limpiar el historial del navegador puede borrar el `localStorage`.

Esto es igual que abrir `index.html` a doble clic, como decía el README original. Desplegarlo en
internet sólo ahorra tener el archivo en cada máquina y permite abrirlo desde el celular.

## Trabajar sin computadora (tablet o celular)

No hace falta tener el proyecto instalado en ninguna máquina:

- **Cambiar código**: se pide en la sesión de Claude Code, que trabaja sobre una rama y la sube a
  GitHub.
- **Desplegar**: en Coolify, botón **Deploy** del recurso. Construye la rama configurada (corre
  las pruebas de `grades.js` en el build; si fallan, no despliega) y reinicia el contenedor.
- **Ver los datos**: sólo desde el navegador donde se capturaron, o cargando un respaldo.

## Configuración en Coolify

No hay variables de entorno que configurar: no hay base de datos, ni secretos, ni claves de
terceros. Lo único que se asigna en Coolify es el dominio del servicio `web` (ver
`deploy/DEPLOY-COOLIFY.md`).

## Desarrollo local (opcional)

```bash
npm test     # pruebas de la lógica de cálculo (grades.js)
npm start    # sirve la carpeta en http://localhost:8080
```

No hay dependencias que instalar: la app es HTML, CSS y JavaScript sin bundler, y las pruebas
usan `node:test`, que viene con Node. Para probar la imagen de Docker en local antes de
desplegar, ver «Probar el paquete en local» en `deploy/DEPLOY.md`.
