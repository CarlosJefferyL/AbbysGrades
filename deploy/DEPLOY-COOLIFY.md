# Desplegar Abby's Grades en el VPS de JeffCo (Coolify + Traefik)

Este runbook es para montar Abby's Grades en el **VPS compartido de JeffCo**, que orquesta las
apps con **Coolify + Traefik**. Es distinto de `deploy/DEPLOY.md`, que asume un **servidor
dedicado** donde la app vive sola y su propio **Caddy** toma los puertos 80/443 y saca el TLS.

Es la misma estructura con la que está desplegado Danachem (`CarlosJefferyL/danachem`), reducida
a lo que esta app necesita.

## Qué es lo que se despliega

Dos servicios:

- **`api`**: un servidor pequeño en Node que guarda las calificaciones en el volumen `datos`
  (`/datos/calificaciones.json`) detrás de una contraseña única. Guarda además una copia diaria
  en `/datos/respaldos/` (30 días).
- **`web`**: Caddy sirviendo la página (`index.html`, `app.js`, `grades.js`, `styles.css`) y
  reenviando `/api` al servicio `api`.

Los datos viven en el volumen del VPS. Abrir la app desde la laptop o desde el celular muestra lo
mismo, porque cada cambio se sube al servidor al momento.

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
   **+ Add Resource → Docker Compose** (repositorio con la GitHub App `coolify-jeffco`).
   - Repo: `CarlosJefferyL/AbbysGrades`, la rama principal del repo.
   - **Docker Compose Location:** `/deploy/docker-compose.coolify.yml`
   - Destino: **Standalone Docker (coolify)** (la red donde vive Traefik).

2. **Variables de entorno** (pestaña *Environment Variables* del recurso):

   | Variable | Valor | ¿Obligatoria? |
   |---|---|---|
   | `CLAVE_ACCESO` | La contraseña con la que se entra a la app. | **Sí** |
   | `SECRET_KEY` | Generar con `openssl rand -hex 32`. Firma la cookie de sesión. | **Sí** |

   Si falta alguna, el contenedor `api` no arranca y el log dice cuál falta. Es deliberado: sin
   contraseña la app quedaría abierta a internet con nombres y calificaciones de alumnos.

   Cambiar `CLAVE_ACCESO` cierra las sesiones abiertas en todos los navegadores: al recargar
   piden la contraseña nueva.

   `DOMINIO` **no** se pone aquí: va fijo en `":80"` dentro del compose (Caddy interno). El
   dominio público se asigna en el paso 3.

3. **Dominio del servicio `web`.** Tras cargar el compose, Coolify lista los servicios. Asigna
   `https://abbysgrades.jeffco.mx` **al servicio `web`, puerto 80**. Coolify avisa que el 80 «no
   está en Ports Exposes»: es sólo una advertencia, se acepta con *Use this port anyway*. Traefik
   configura el TLS (Let's Encrypt) automáticamente. El DNS ya resuelve por el comodín
   `*.jeffco.mx`.

4. **Deploy.** Coolify construye las dos imágenes (`deploy/Dockerfile.api` y
   `deploy/Dockerfile.web`, con contexto en la raíz del repo) y levanta los servicios. **Cada
   construcción corre las pruebas** (las del cálculo en `web`, las de la API en `api`): si una
   falla, la imagen no se construye y el despliegue se detiene. Coolify no muestra la salida del
   build; si llega a «Starting new application», las pruebas pasaron.

5. **Verifica:** entra a `https://abbysgrades.jeffco.mx`. Debe aparecer la pantalla de
   contraseña con el candado de HTTPS. Al entrar, arriba a la derecha debe decir «Guardado en el
   servidor». Crea un grupo de prueba, ábrela desde el celular con la misma contraseña y confirma
   que el grupo está.

## Actualizar

Cada `git push` a la rama configurada se despliega con el botón **Deploy** de Coolify (o solo, si
se activa el *auto deploy* del recurso). No hay migraciones: el archivo de datos tiene un formato
que la app normaliza al leer.

Los archivos se sirven con `Cache-Control: no-cache`, así que con recargar la página el
navegador toma la versión nueva. No hace falta "vaciar caché".

## Datos y respaldos

- **Los datos están en el volumen `datos`** del servicio `api`. Coolify lo conserva entre
  despliegues; sólo se pierde si se borra el recurso completo o el volumen a mano.
- **Copia diaria automática** en `/datos/respaldos/calificaciones-AAAA-MM-DD.json` (la primera
  vez que se guarda cada día, se copia lo que había antes). Se conservan 30 días. Sirve contra un
  «Restaurar» con el archivo equivocado.
- **Copia fuera del VPS.** El botón **Respaldar** de la app descarga el mismo JSON al dispositivo.
  Conviene hacerlo al cierre de cada parcial. Desde el VPS también se puede copiar el archivo:

  ```sh
  docker cp $(docker ps -qf name=api-):/datos/calificaciones.json ./calificaciones-$(date +%Y%m%d).json
  ```

  Qué debe salir: un archivo JSON con `"version"`, `"actualizado"` y `"datos"`.
- **Restaurar** desde una copia: en la app, botón **Restaurar** con el JSON (sirve tanto el que
  bajó **Respaldar** como el `calificaciones.json` del volumen: la app lee ambos formatos).

## Nota de capacidad (VPS compartido)

Techos por servicio en el compose: `api 128m`, `web 64m` (**~200 MB**). Antes de desplegar, corre
el monitoreo del VPS (`/root/monitoreo-vps.sh`, ver el repo `crenor` →
`deploy/VPS-ACCESOS-Y-CAPACIDAD.md`) y confirma que hay margen.
