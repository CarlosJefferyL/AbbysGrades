# Despliegue de Abby's Grades

Hay dos formas de desplegar, con la misma imagen (`deploy/Dockerfile.web`):

| Dónde | Compose | Quién hace el TLS |
|---|---|---|
| VPS compartido de JeffCo (Coolify + Traefik) | `deploy/docker-compose.coolify.yml` | Traefik, afuera del contenedor |
| Servidor dedicado, la app sola | `deploy/docker-compose.prod.yml` | Caddy, dentro del contenedor |

**El camino normal es Coolify**: ver `deploy/DEPLOY-COOLIFY.md`. Este archivo cubre el servidor
dedicado y la prueba local del paquete.

## Qué se despliega

Una página estática: Caddy sirviendo `index.html`, `app.js`, `grades.js` y `styles.css`. No hay
API, base de datos ni archivos subidos. Los datos viven en el navegador de quien usa la app
(`localStorage`); el servidor no guarda nada, así que no hay volúmenes de datos que respaldar ni
migrar. Mudar el sitio a otro servidor es desplegarlo allá y apuntar el DNS.

## Servidor dedicado

### Requisitos

- Docker y el plugin compose.
- Un dominio apuntando al servidor (registro A), necesario para el TLS automático de Caddy.
- Puertos 80 y 443 abiertos.

### Primer despliegue

1. Clonar el repositorio en el servidor.
2. `cp .env.example .env` y poner en `DOMINIO` el dominio real (ej. `abbysgrades.jeffco.mx`).
   Es la única variable; si falta, el compose se niega a arrancar con un mensaje que la nombra.
3. Desde la raíz del repo:

   ```bash
   docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
   ```

   Qué debe salir: la etapa `pruebas` del build imprime `# fail 0`, y al final
   `Container ..._web_1  Started`.

4. Entrar por el dominio y confirmar que aparece el candado de HTTPS.

### Actualizar

```bash
git pull
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
```

No hay migraciones ni respaldo previo: el servidor no guarda datos.

## Probar el paquete en local antes de tocar un servidor

Para validar la imagen y el compose sin depender de un dominio real ni de los puertos 80/443, se
levanta detrás de un puerto alto. `DOMINIO=:8080` hace que Caddy sirva por HTTP en el 8080 sin
intentar sacar un certificado.

```bash
cp .env.example .env.prueba-local
sed -i 's/^DOMINIO=.*/DOMINIO=:8080/' .env.prueba-local
cat > docker-compose.override.yml <<'FIN'
services:
  web:
    ports: !override
      - "8080:8080"
FIN
docker compose --env-file .env.prueba-local -f deploy/docker-compose.prod.yml -f docker-compose.override.yml up -d --build
```

Qué debe salir: `http://localhost:8080` muestra la app. Al terminar:

```bash
docker compose --env-file .env.prueba-local -f deploy/docker-compose.prod.yml -f docker-compose.override.yml down
rm docker-compose.override.yml .env.prueba-local
```

Ni `.env.prueba-local` ni `docker-compose.override.yml` se commitean: están en `.gitignore`.
Borrar el override al terminar importa: Docker Compose lo carga solo en cualquier comando que se
ejecute desde la raíz del repo, aunque no se le pase con `-f`.

Si en esa máquina hay otros proyectos con Compose, exporta `COMPOSE_PROJECT_NAME=abbysgrades-prueba`
antes para que los contenedores y volúmenes no se mezclen con los de otro proyecto.
