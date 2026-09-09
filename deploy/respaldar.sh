#!/usr/bin/env bash
# Copia el archivo de calificaciones del volumen `datos` a ./respaldos/.
# Para el despliegue de deploy/docker-compose.prod.yml (servidor dedicado).
# En Coolify el contenedor tiene otro nombre: ver deploy/DEPLOY-COOLIFY.md.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose --env-file $RAIZ/.env -f $RAIZ/deploy/docker-compose.prod.yml"
DESTINO="${1:-$RAIZ/respaldos}"
MARCA="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DESTINO"
$COMPOSE cp api:/datos/calificaciones.json "$DESTINO/calificaciones-$MARCA.json"

echo "Respaldo listo: $DESTINO/calificaciones-$MARCA.json"
ls -lh "$DESTINO/calificaciones-$MARCA.json"
