#!/usr/bin/env bash
# Lance l'Atelier 3D sur le réseau local : http://<ip-du-pc>:8030
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/uvicorn atelier3d.app:app --host "${HOTE:-0.0.0.0}" --port "${PORT:-8030}"
