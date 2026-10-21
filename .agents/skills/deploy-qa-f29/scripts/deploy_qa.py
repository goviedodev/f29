#!/usr/bin/env python3
"""
Automatización de Despliegue y Operación QA para F29 (Contidep).
Opera sobre el servidor QA goviedo@asus (192.168.100.14) en /home/goviedo/proyectos/f29.
Usa únicamente la biblioteca estándar de Python 3.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

QA_USER_HOST = "goviedo@asus"
QA_IP = "192.168.100.14"
QA_DIR = "/home/goviedo/proyectos/f29"
QA_APP_PORT = 5174
QA_EVO_PORT = 8080
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

BASE_IMAGES = [
    "evoapicloud/evolution-api:latest",
    "redis:7-alpine",
    "postgres:15-alpine",
]
APP_IMAGE = "f29-qa:latest"

REPO_ROOT = Path(__file__).resolve().parents[4]


def log_step(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def is_running_on_asus() -> bool:
    hostname = socket.gethostname().lower()
    if hostname == "asus":
        return True
    try:
        out = subprocess.check_output(["hostname", "-I"], text=True)
        return QA_IP in out.split()
    except Exception:
        return False


def run_local(cmd: list[str] | str, cwd: Path = REPO_ROOT, check: bool = True) -> subprocess.CompletedProcess:
    use_shell = isinstance(cmd, str)
    return subprocess.run(cmd, cwd=str(cwd), shell=use_shell, check=check)


def run_remote(remote_cmd: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    full_cmd = f"cd {QA_DIR} && {remote_cmd}"
    if is_running_on_asus():
        return subprocess.run(
            full_cmd,
            shell=True,
            check=check,
            text=True,
            capture_output=capture,
        )
    return subprocess.run(
        ["ssh", QA_USER_HOST, full_cmd],
        check=check,
        text=True,
        capture_output=capture,
    )


def remote_image_exists(image: str) -> bool:
    res = run_remote(f"docker image inspect {image} >/dev/null 2>&1", check=False)
    return res.returncode == 0


def transfer_docker_image(image: str) -> None:
    if is_running_on_asus():
        print(f"Ejecutando directamente en asus; no se requiere transferir {image}.")
        return
    print(f"-> Transfiriendo imagen Docker '{image}' hacia {QA_USER_HOST}...", flush=True)
    pipeline = f'docker save "{image}" | gzip | ssh {QA_USER_HOST} "gunzip | docker load"'
    run_local(pipeline)


def sync_files_to_asus() -> None:
    if is_running_on_asus():
        print("Ejecutando directamente en asus; omitiendo rsync remoto.")
        return
    subprocess.run(["ssh", QA_USER_HOST, f"mkdir -p {QA_DIR}"], check=True)
    rsync_cmd = [
        "rsync",
        "-avz",
        "--delete",
        "--exclude",
        "node_modules",
        "--exclude",
        "dist",
        "--exclude",
        ".wrangler",
        f"{REPO_ROOT}/",
        f"{QA_USER_HOST}:{QA_DIR}/",
    ]
    run_local(rsync_cmd)
    run_remote(
        f"sed -i 's|SERVER_URL=http://localhost:8080|SERVER_URL=http://{QA_IP}:{QA_EVO_PORT}|g' .env"
    )


def wait_for_qa_health(timeout_sec: int = 35) -> dict:
    target_host = "127.0.0.1" if is_running_on_asus() else QA_IP
    url = f"http://{target_host}:{QA_APP_PORT}/api/admin/status"
    deadline = time.time() + timeout_sec
    last_err = None

    while time.time() < deadline:
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {ADMIN_PASSWORD}",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            last_err = exc
        time.sleep(1.5)

    raise RuntimeError(f"El servicio QA no respondió en {url} tras {timeout_sec}s: {last_err}")


def print_health_summary(status_data: dict) -> None:
    evo = status_data.get("evolution", {})
    stats = status_data.get("stats", {})
    print("\n--- Resumen de Salud F29 QA ---")
    print(f"  URL Panel Admin : http://{QA_IP}:{QA_APP_PORT}")
    print(f"  URL Evolution   : http://{QA_IP}:{QA_EVO_PORT}")
    print(f"  Fecha Santiago  : {status_data.get('fecha_santiago')} (Periodo {status_data.get('periodo')})")
    print(f"  Instancia WA    : {evo.get('instance')} (estado: {evo.get('connectionState')})")
    print(f"  Grupos Totales  : {stats.get('total_grupos')} (activos: {stats.get('grupos_activos')})")
    print(f"  Plantillas Act. : {stats.get('plantillas_activas')}")
    print(
        f"  Envíos del Mes  : {stats.get('envios_exitosos_mes')} exitosos / {stats.get('envios_fallidos_mes')} fallidos"
    )


def cmd_deploy(args: argparse.Namespace) -> int:
    if not args.skip_checks and not is_running_on_asus():
        log_step("1. Validando tipos, linter y compilación (npm run lint && npm run build)")
        run_local(["npm", "run", "lint"])
        run_local(["npm", "run", "build"])

    if not args.skip_build and not is_running_on_asus():
        log_step(f"2. Construyendo imagen Docker {APP_IMAGE} en local")
        run_local(["docker", "build", "-t", APP_IMAGE, "."])

        log_step(f"3. Verificando y transfiriendo imágenes Docker hacia {QA_USER_HOST}")
        for base_img in BASE_IMAGES:
            if not remote_image_exists(base_img):
                transfer_docker_image(base_img)
        transfer_docker_image(APP_IMAGE)

    log_step(f"4. Sincronizando archivos y repositorio Git hacia {QA_USER_HOST}:{QA_DIR}")
    sync_files_to_asus()

    log_step(f"5. Levantando contenedores Docker en {QA_USER_HOST}")
    run_remote("docker compose up -d --no-build")
    run_remote("docker compose ps")

    log_step("6. Verificando salud del servicio F29 QA")
    status_data = wait_for_qa_health(timeout_sec=40)
    print_health_summary(status_data)
    return 0


def cmd_start(_args: argparse.Namespace) -> int:
    log_step(f"Iniciando contenedores F29 QA en {QA_DIR}")
    run_remote("docker compose up -d --no-build")
    run_remote("docker compose ps")
    status_data = wait_for_qa_health(timeout_sec=30)
    print_health_summary(status_data)
    return 0


def cmd_stop(_args: argparse.Namespace) -> int:
    log_step("Deteniendo contenedores F29 QA (preservando volúmenes y sesión WhatsApp)")
    run_remote("docker compose stop")
    run_remote("docker compose ps")
    return 0


def cmd_restart(_args: argparse.Namespace) -> int:
    log_step("Reiniciando contenedores F29 QA")
    run_remote("docker compose restart")
    run_remote("docker compose ps")
    status_data = wait_for_qa_health(timeout_sec=30)
    print_health_summary(status_data)
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    log_step("Estado de Contenedores en QA (asus)")
    run_remote("docker compose ps")
    log_step("Estado de Git en QA (asus)")
    run_remote("git status -sb && git log -1 --oneline")
    log_step("Estado del Servicio F29 QA (/api/admin/status)")
    status_data = wait_for_qa_health(timeout_sec=15)
    print_health_summary(status_data)
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    service = args.service or ""
    follow_flag = "-f" if args.follow else ""
    run_remote(f"docker compose logs {follow_flag} --tail {args.tail} {service}".strip(), check=False)
    return 0


def cmd_sync_git(args: argparse.Namespace) -> int:
    log_step("1. Preparando cambios en Git local")
    run_local(["git", "add", "."])
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(REPO_ROOT),
        text=True,
        capture_output=True,
        check=True,
    )
    if status.stdout.strip():
        run_local(["git", "commit", "-m", args.message])
    else:
        print("No hay cambios locales pendientes de commit.")

    log_step("2. Publicando en origin/main (git push)")
    run_local(["git", "push", "origin", "main"])

    log_step(f"3. Sincronizando repositorio Git en {QA_USER_HOST}:{QA_DIR}")
    sync_files_to_asus()
    run_remote("git status -sb && git log -1 --oneline")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Herramienta Python para automatizar el despliegue y operación de F29 en QA (asus)."
    )
    subparsers = parser.add_subparsers(dest="command")

    p_deploy = subparsers.add_parser("deploy", help="Compila, transfiere, sincroniza y despliega en QA (asus)")
    p_deploy.add_argument("--skip-checks", action="store_true", help="Omitir npm run lint && npm run build")
    p_deploy.add_argument("--skip-build", action="store_true", help="Omitir docker build y transferencia de imagen")
    p_deploy.set_defaults(func=cmd_deploy)

    p_start = subparsers.add_parser("start", help="Inicia los contenedores en QA y verifica salud")
    p_start.set_defaults(func=cmd_start)

    p_stop = subparsers.add_parser("stop", help="Detiene los contenedores en QA conservando datos")
    p_stop.set_defaults(func=cmd_stop)

    p_restart = subparsers.add_parser("restart", help="Reinicia los contenedores en QA y verifica salud")
    p_restart.set_defaults(func=cmd_restart)

    p_status = subparsers.add_parser("status", help="Muestra estado de contenedores, Git y API en QA")
    p_status.set_defaults(func=cmd_status)

    p_logs = subparsers.add_parser("logs", help="Muestra los logs de los contenedores en QA")
    p_logs.add_argument("--service", choices=["f29-qa", "api", "evolution-postgres", "redis"], default=None)
    p_logs.add_argument("--tail", type=int, default=50)
    p_logs.add_argument("-f", "--follow", action="store_true", help="Seguir logs en tiempo real")
    p_logs.set_defaults(func=cmd_logs)

    p_git = subparsers.add_parser("sync-git", help="Hace commit, push a origin/main y sincroniza Git en asus")
    p_git.add_argument("-m", "--message", default="chore: update F29 QA deployment", help="Mensaje de commit")
    p_git.set_defaults(func=cmd_sync_git)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not getattr(args, "command", None):
        # Por defecto ejecuta deploy completo
        args = parser.parse_args(["deploy"])
    try:
        return args.func(args)
    except subprocess.CalledProcessError as exc:
        print(f"\n[ERROR] Falló el comando (código {exc.returncode}): {exc.cmd}", file=sys.stderr)
        return exc.returncode or 1
    except Exception as exc:
        print(f"\n[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
