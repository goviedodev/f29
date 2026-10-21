#!/bin/sh
set -e

if [ -n "$EVOLUTION_API_URL" ]; then
  cat > /app/.dev.vars <<EOF
EVOLUTION_API_URL=${EVOLUTION_API_URL}
EVOLUTION_API_KEY=${EVOLUTION_API_KEY:-429683C4C977415CAAFCCE10F7D57E11}
EVOLUTION_INSTANCE=${EVOLUTION_INSTANCE:-contidep}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}
EOF
fi

echo "=== Aplicando migraciones de base de datos D1 local ==="
npm run db:migrate:local || true

echo "=== Asegurando instancia '${EVOLUTION_INSTANCE:-contidep}' en Evolution API ==="
if [ -n "$EVOLUTION_API_URL" ]; then
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf "${EVOLUTION_API_URL}/" >/dev/null 2>&1; then
      curl -sf -X POST "${EVOLUTION_API_URL}/instance/create" \
        -H "apikey: ${EVOLUTION_API_KEY:-429683C4C977415CAAFCCE10F7D57E11}" \
        -H "Content-Type: application/json" \
        -d "{\"instanceName\":\"${EVOLUTION_INSTANCE:-contidep}\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}" >/dev/null 2>&1 || true
      break
    fi
    sleep 2
  done
fi

# Daemon interno para disparar el cron diario a las 09:15 (America/Santiago) en QA
(
  LAST_RUN_DATE=""
  while true; do
    NOW_DATE=$(TZ=America/Santiago date +%Y-%m-%d)
    NOW_HM=$(TZ=America/Santiago date +%H:%M)
    if [ "$NOW_HM" = "09:15" ] && [ "$LAST_RUN_DATE" != "$NOW_DATE" ]; then
      echo "[CRON-QA] Disparando ejecución diaria F29 para $NOW_DATE ($NOW_HM America/Santiago)..."
      if curl -sf -X POST "http://127.0.0.1:${PORT:-5174}/api/admin/cron/run" \
        -H "Authorization: Bearer ${ADMIN_PASSWORD:-admin123}" \
        -H "Content-Type: application/json" \
        -d '{}' >/dev/null 2>&1; then
        LAST_RUN_DATE="$NOW_DATE"
        echo "[CRON-QA] Ejecución diaria completada para $NOW_DATE"
      fi
    fi
    sleep 30
  done
) &

echo "=== Iniciando servicio F29 QA en puerto ${PORT:-5174} ==="
exec "$@"
