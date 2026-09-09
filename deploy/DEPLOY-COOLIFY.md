# Desplegar Abby's Grades en el VPS de JeffCo (Coolify + Traefik)

Este runbook es para montar Abby's Grades en el **VPS compartido de JeffCo**, que orquesta las
apps con **Coolify + Traefik**. Es distinto de `deploy/DEPLOY.md`, que asume un **servidor
dedicado** donde la app vive sola y su propio **Caddy** toma los puertos 80/443 y saca el TLS.

Es la misma estructura con la que está desplegado Danachem (`CarlosJefferyL/danachem`), reducida
a lo que esta app necesita.

## Qué es lo que se despliega

Abby's Grades es una **página estática**: cuatro archivos (`index.html`, `app.js`, `grades.js`,
`styles.css`) que el navegador ejecuta. **No hay API ni base de datos.** Los datos de cada
grupo viven en el navegador de quien usa la app (`localStorage`), y el respaldo es el `.json`
que descarga el botón **Respaldar**.

Eso tiene una consecuencia que conviene tener clara antes de compartir la liga: **desplegar en
internet no centraliza los datos.** Cada navegador (la laptop, el celular, otra computadora)
tiene su propia copia, y pasar los datos de uno a otro es Respaldar → Restaurar. El servidor
sólo entrega los archivos; no guarda nada.

El stack es **un solo servicio**, `web`: Caddy sirviendo los archivos.

## Por qué existe este archivo (el conflicto que resuelve)

En un servidor Coolify, **Traefik ya es dueño de los puertos 80 y 443** y enruta todas las apps
por **dominio**. El `web` trae **su propio Caddy** que también querría 80/443 y su propio TLS —
dos reverse-proxies no pueden pelear por esos puertos. La adaptación:

- Se usa **`deploy/docker-compose.coolify.yml`** en vez de `docker-compose.prod.yml`.
- El servicio `web` **no publica 80/443**; sólo `expose: 80` (accesible en la red interna de
  Docker).
- Caddy sirve **HTTP plano** por dentro (`DOMINIO=":80"`, sin ACME) y **Traefik termina el TLS**
  afuera.
- Traefik enruta `https://<dominio>` → `web:80`.

## Pasos en Coolify

1. **Recurso de tipo Docker Compose.** En el proyecto (p. ej. *AbbysGrades → production*):
   **+ Add Resource → Docker Compose** (repositorio privado con la GitHub App `coolify-jeffco`).
   - Repo: `CarlosJefferyL/AbbysGrades`, la rama principal del repo.
   - **Docker Compose Location:** `/deploy/docker-compose.coolify.yml`
   - Destino: **Standalone Docker (coolify)** (la red donde vive Traefik).

   > Aunque el stack sea un solo servicio, se usa el tipo *Docker Compose* y no *Application*
   > (Dockerfile suelto): así el despliegue queda idéntico al de Danachem y no hay que
   > configurar a mano el puerto expuesto ni los volúmenes de Caddy.

2. **Variables de entorno.** **Ninguna es obligatoria.** No hay base de datos, ni secretos, ni
   claves de terceros. `DOMINIO` va fijo en `":80"` dentro del compose (Caddy interno); el
   dominio público se asigna en el paso 3.

3. **Dominio del servicio `web`.** Tras cargar el compose, Coolify lista los servicios. Asigna
   `https://abbysgrades.jeffco.mx` **al servicio `web`, puerto 80** (en el campo de dominio del
   `web`, o con la variable mágica de Coolify `SERVICE_FQDN_WEB_80=https://abbysgrades.jeffco.mx`).
   Traefik configura el TLS (Let's Encrypt) automáticamente. El DNS ya resuelve por el comodín
   `*.jeffco.mx`.

4. **Deploy.** Coolify construye la imagen (`deploy/Dockerfile.web`, con contexto en la raíz del
   repo) y levanta el servicio. **La construcción corre las pruebas de `grades.js`**: si una
   prueba falla, la imagen no se construye y el despliegue se detiene. Es deliberado: es
   preferible no desplegar a desplegar una versión que calcule mal las calificaciones.

   Qué debe salir en el log de build si funcionó: una línea `# pass 9` (o el número de pruebas
   que haya en ese momento) y `# fail 0`, seguida de la etapa de Caddy.

5. **Verifica:** entra a `https://abbysgrades.jeffco.mx`, confirma el candado de HTTPS, crea un
   grupo de prueba y recarga la página: el grupo debe seguir ahí (es `localStorage`; si no
   sigue, el navegador está bloqueando el almacenamiento del sitio).

## Actualizar

Cada `git push` a la rama configurada se despliega con el botón **Deploy** de Coolify (o solo, si
se activa el *auto deploy* del recurso). No hay migraciones ni pasos previos: el sitio no guarda
nada en el servidor.

Los archivos se sirven con `Cache-Control: no-cache`, así que con recargar la página el
navegador toma la versión nueva. No hace falta "vaciar caché".

## Datos y respaldos

- **El servidor no guarda datos.** No hay nada que respaldar del lado del VPS; lo que hay que
  cuidar es el `.json` que descarga **Respaldar** desde la app.
- Los volúmenes `caddy_datos` y `caddy_config` sólo guardan el estado interno de Caddy. Se
  pueden borrar sin perder nada.

## Nota de capacidad (VPS compartido)

Este stack pesa poco: un solo contenedor de Caddy con techo de **64 MB** (`mem_limit` en el
compose). Aun así, antes de desplegar corre el monitoreo del VPS (`/root/monitoreo-vps.sh`,
ver el repo `crenor` → `deploy/VPS-ACCESOS-Y-CAPACIDAD.md`) y confirma que hay margen.
