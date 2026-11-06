#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -d frontend/node_modules ]]; then
  echo 'Run make setup first (Python 3.12+, Node 24, npm required).'
  exit 1
fi
.venv/bin/python backend/manage.py migrate --noinput
.venv/bin/python backend/manage.py runserver 127.0.0.1:8000 --noreload &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
npm --prefix frontend run dev -- --host 127.0.0.1
