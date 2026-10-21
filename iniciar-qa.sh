#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-start}"
if [ $# -gt 0 ]; then
  shift
fi

exec python3 "${SCRIPT_DIR}/.agents/skills/deploy-qa-f29/scripts/deploy_qa.py" "${ACTION}" "$@"
