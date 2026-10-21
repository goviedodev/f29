#!/bin/bash
set -euo pipefail

QA_HOST="goviedo@asus"
QA_DIR="/home/goviedo/proyectos/f29"

echo "=== 1. Construyendo imagen f29-qa:latest en local ==="
docker build -t f29-qa:latest .

echo "=== 2. Transfiriendo imágenes requeridas a ${QA_HOST} ==="
# Asegurar que las imágenes base de Evolution API estén en asus
for img in evoapicloud/evolution-api:latest redis:7-alpine postgres:15-alpine; do
  if ! ssh "${QA_HOST}" "docker image inspect ${img} >/dev/null 2>&1"; then
    echo "Transfiriendo imagen base ${img} a ${QA_HOST}..."
    docker save "${img}" | gzip | ssh "${QA_HOST}" "gunzip | docker load"
  fi
done

echo "Transfiriendo imagen f29-qa:latest a ${QA_HOST}..."
docker save f29-qa:latest | gzip | ssh "${QA_HOST}" "gunzip | docker load"

echo "=== 3. Sincronizando archivos de configuración a ${QA_HOST}:${QA_DIR} ==="
ssh "${QA_HOST}" "mkdir -p ${QA_DIR}"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.wrangler' \
  ./ "${QA_HOST}:${QA_DIR}/"
ssh "${QA_HOST}" "sed -i 's|SERVER_URL=http://localhost:8080|SERVER_URL=http://192.168.100.14:8080|g' ${QA_DIR}/.env"

echo "=== 4. Levantando servicios Docker en ${QA_HOST} ==="
ssh "${QA_HOST}" "cd ${QA_DIR} && docker compose up -d --no-build"

echo "=== 5. Verificando estado de contenedores en ${QA_HOST} ==="
ssh "${QA_HOST}" "cd ${QA_DIR} && docker compose ps"

echo "=== Despliegue QA completado: http://192.168.100.14:5174 ==="
