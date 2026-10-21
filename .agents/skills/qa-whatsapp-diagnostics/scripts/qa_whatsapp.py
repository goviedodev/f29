#!/usr/bin/env python3
"""
Herramienta Python de diagnóstico, sincronización de grupos reales de WhatsApp
y ejecución controlada del planificador F29 en el ambiente QA (192.168.100.14:5174).
Usa únicamente la biblioteca estándar de Python 3.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

QA_BASE_URL = os.environ.get("F29_QA_URL", "http://192.168.100.14:5174")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def api_request(path: str, method: str = "GET", payload: dict | None = None, timeout: int = 30) -> dict:
    url = f"{QA_BASE_URL.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {ADMIN_PASSWORD}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} en {method} {url}: {err_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Error de red conectando a {url}: {exc}") from exc


def cmd_check(_args: argparse.Namespace) -> int:
    status = api_request("/api/admin/status")
    qr_info = api_request("/api/admin/whatsapp/qr")
    print(json.dumps({"status": status, "whatsapp": qr_info}, indent=2, ensure_ascii=False))
    return 0


def cmd_sync_groups(_args: argparse.Namespace) -> int:
    print("Sincronizando grupos reales desde Evolution API en QA (timeout 120s)...", flush=True)
    res = api_request("/api/admin/groups/sync", method="POST", payload={}, timeout=120)
    print(
        f"Sincronización completada: {res.get('total_remote')} grupos en WhatsApp, "
        f"{res.get('inserted')} nuevos insertados, {len(res.get('groups', []))} totales en D1."
    )
    return 0


def cmd_list_groups(args: argparse.Namespace) -> int:
    res = api_request("/api/admin/groups")
    groups = res.get("groups", [])
    if args.active_only:
        groups = [g for g in groups if g.get("activo")]
    if args.search:
        term = args.search.lower()
        groups = [
            g
            for g in groups
            if term in g.get("nombre_empresa", "").lower() or term in g.get("group_jid", "").lower()
        ]

    print(f"Total grupos encontrados: {len(groups)}")
    for g in groups[: args.limit]:
        estado = "ACTIVO" if g.get("activo") else "INACTIVO"
        print(
            f"- [{estado}] {g.get('nombre_empresa')} | JID: {g.get('group_jid')} "
            f"| Vencimiento día: {g.get('dia_vencimiento_f29')} | ID: {g.get('id')}"
        )
    return 0


def cmd_run_cron(args: argparse.Namespace) -> int:
    payload = {"overrideDate": args.date} if args.date else {}
    res = api_request("/api/admin/cron/run", method="POST", payload=payload, timeout=90)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Diagnóstico de WhatsApp Evolution API y motor F29 en QA (192.168.100.14:5174)."
    )
    sub = parser.add_subparsers(dest="command")

    p_check = sub.add_parser("check", help="Verifica estado de sesión WhatsApp, plantillas y métricas en QA")
    p_check.set_defaults(func=cmd_check)

    p_sync = sub.add_parser("sync-groups", help="Sincroniza grupos reales desde WhatsApp en QA")
    p_sync.set_defaults(func=cmd_sync_groups)

    p_list = sub.add_parser("list-groups", help="Lista o busca grupos reales almacenados en D1 QA")
    p_list.add_argument("--search", default="", help="Filtrar por nombre o JID")
    p_list.add_argument("--active-only", action="store_true", help="Mostrar solo grupos activos")
    p_list.add_argument("--limit", type=int, default=50, help="Límite de filas a mostrar")
    p_list.set_defaults(func=cmd_list_groups)

    p_cron = sub.add_parser("run-cron", help="Ejecuta el motor diario de recordatorios en QA")
    p_cron.add_argument("--date", default=None, help="Fecha simulada YYYY-MM-DD (opcional)")
    p_cron.set_defaults(func=cmd_run_cron)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not getattr(args, "command", None):
        args = parser.parse_args(["check"])
    try:
        return args.func(args)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
