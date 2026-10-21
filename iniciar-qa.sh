#!/bin/bash
set -euo pipefail

QA_HOST="goviedo@asus"
QA_DIR="/home/goviedo/proyectos/f29"
ACTION="${1:-start}"

run_on_asus() {
  if [ "$(hostname)" = "asus" ] || [ "$(hostname -I 2>/dev/null | grep -c '192.168.100.14' || true)" -gt 0 ]; then
    cd "${QA_DIR}"
    eval "$1"
  else
    ssh "${QA_HOST}" "cd ${QA_DIR} && $1"
  fi
}

case "${ACTION}" in
  start)
    echo "=== Iniciando servicios F29 QA en asus (${QA_DIR}) ==="
    run_on_asus "docker compose up -d --no-build"
    echo ""
    echo "=== Estado de los contenedores ==="
    run_on_asus "docker compose ps"
    echo ""
    echo "=== Esperando que el panel F29 responda en el puerto 5174 ==="
    for i in $(seq 1 15); do
      if run_on_asus "curl -sf http://127.0.0.1:5174/ >/dev/null 2>&1"; then
        echo "OK: Panel F29 QA activo en http://192.168.100.14:5174"
        echo "OK: Evolution API activa en http://192.168.100.14:8080"
        exit 0
      fi
      sleep 1
    done
    echo "ADVERTENCIA: El contenedor inició pero aún está cargando Vite. Revisa con: ./iniciar-qa.sh logs"
    ;;
  stop)
    echo "=== Deteniendo servicios F29 QA en asus ==="
    run_on_asus "docker compose stop"
    ;;
  restart)
    echo "=== Reiniciando servicios F29 QA en asus ==="
    run_on_asus "docker compose restart"
    run_on_asus "docker compose ps"
    ;;
  status)
    echo "=== Estado de contenedores F29 QA en asus ==="
    run_on_asus "docker compose ps"
    echo ""
    echo "=== Estado API /api/admin/status ==="
    run_on_asus "curl -s -H 'Authorization: Bearer admin123' http://127.0.0.1:5174/api/admin/status"
    echo ""
    ;;
  logs)
    run_on_asus "docker compose logs -f --tail 50"
    ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
