# Despliegue de Abby's Grades

Hay dos formas de desplegar, con las mismas imágenes (`deploy/Dockerfile.api` y
`deploy/Dockerfile.web`):

| Dónde | Compose | Quién hace el TLS |
|---|---|---|
| VPS compartido de JeffCo (Coolify + Traefik) | `deploy/docker-compose.coolify.yml` | Traefik, afuera del contenedor |
| Servidor dedicado, la app sola | `deploy/docker-compose.prod.yml` | Caddy, dentro del contenedor |

**El camino normal es Coolify**: ver `deploy/DEPLOY-COOLIFY.md`. Este archivo cubre el servidor
dedicado y la prueba local del paquete.

## Qué se despliega

- `api`: servidor en Node, sin dependencias, que guarda las calificaciones en
  `/datos/calificaciones.json` (volumen `datos`) detrás de una contraseña, con copia diaria en
  `/datos/respaldos/`.
- `web`: Caddy sirviendo la página y reenviando `/api` a la API.

Todo dato persistente está en el volumen `datos`. Mudar el sitio a otro servidor es copiar ese
archivo, desplegar allá y apuntar el DNS.

## Servidor dedicado

### Requisitos

- Docker y el plugin compose.
- Un dominio apuntando al servidor (registro A), necesario para el TLS automático de Caddy.
- Puertos 80 y 443 abiertos.

### Primer despliegue

1. Clonar el repositorio en el servidor.
2. `cp .env.example .env` y llenar:
   - `CLAVE_ACCESO`: la contraseña para entrar a la app.
   - `SECRET_KEY`: generar con `openssl rand -hex 32`.
   - `DOMINIO`: el dominio real (ej. `abbysgrades.jeffco.mx`).

   Si falta alguna, el compose se niega a arrancar con un mensaje que la nombra.
3. Desde la raíz del repo:

   ```bash
   docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
   ```

   Qué debe salir: al final, `Container ..._api_1 Started` y `Container ..._web_1 Started`. Si
   el build termina, las pruebas pasaron: corren dentro de los Dockerfiles y un fallo detiene la
   construcción (con BuildKit la salida de las pruebas queda plegada; `--progress=plain` la
   muestra).

4. Entrar por el dominio: pantalla de contraseña con el candado de HTTPS.

### Actualizar

```bash
./deploy/respaldar.sh      # copia calificaciones.json a ./respaldos/, por si acaso
git pull
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
```

### Mudar a otro servidor

1. `./deploy/respaldar.sh` en el servidor viejo.
2. Hacer el primer despliegue en el nuevo (con su propio `.env`).
3. En la app, **Restaurar** con el archivo respaldado. La app lee tanto el JSON del botón
   **Respaldar** como el `calificaciones.json` del volumen.
4. Apuntar el DNS al servidor nuevo.

## Probar el paquete en local antes de tocar un servidor

Para validar las imágenes y el compose sin depender de un dominio real ni de los puertos 80/443,
se levanta detrás de un puerto alto. `DOMINIO=:8080` hace que Caddy sirva por HTTP en el 8080 sin
intentar sacar un certificado.

```bash
cp .env.example .env.prueba-local
sed -i 's/^DOMINIO=.*/DOMINIO=:8080/; s/^CLAVE_ACCESO=.*/CLAVE_ACCESO=prueba/' .env.prueba-local
sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$(openssl rand -hex 32)/" .env.prueba-local
cat > docker-compose.override.yml <<'FIN'
services:
  web:
    ports: !override
      - "8080:8080"
  api:
    environment:
      # Sin TLS en la prueba local, la cookie con Secure no viajaría y no se podría entrar.
      COOKIE_SEGURA: "false"
FIN
docker compose --env-file .env.prueba-local -f deploy/docker-compose.prod.yml -f docker-compose.override.yml up -d --build
```

Qué debe salir: `http://localhost:8080` pide la contraseña (`prueba`) y al entrar dice «Guardado
en el servidor». Al terminar:

```bash
docker compose --env-file .env.prueba-local -f deploy/docker-compose.prod.yml -f docker-compose.override.yml down -v
rm docker-compose.override.yml .env.prueba-local
```

Ni `.env.prueba-local` ni `docker-compose.override.yml` se commitean: están en `.gitignore`.
Borrar el override al terminar importa: Docker Compose lo carga solo en cualquier comando que se
ejecute desde la raíz del repo, aunque no se le pase con `-f`.

Si en esa máquina hay otros proyectos con Compose, exporta `COMPOSE_PROJECT_NAME=abbysgrades-prueba`
antes para que los contenedores y volúmenes no se mezclen con los de otro proyecto.
