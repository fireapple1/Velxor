#!/usr/bin/env bash
# Velxor python-engine venv bootstrap — 3인 동일 환경 보장
# Owner: C (worker-C-timeline §1)
# Usage: scripts/setup-venv.sh  (repo root에서)
set -euo pipefail

ENGINE="python-engine"
if [[ ! -d "$ENGINE" ]]; then
  echo "ERR: $ENGINE/ 디렉토리 없음. repo root에서 실행하세요." >&2
  exit 2
fi

# 1) Python 3.12 (Ubuntu 24.04 native) 확인
if ! command -v python3 >/dev/null; then
  echo "ERR: python3 미설치 — sudo apt install -y python3 python3-venv python3-dev" >&2
  exit 3
fi

# 2) venv 생성 (이미 있으면 skip)
if [[ ! -d "$ENGINE/.venv" ]]; then
  python3 -m venv "$ENGINE/.venv"
  echo "[setup-venv] created $ENGINE/.venv"
else
  echo "[setup-venv] $ENGINE/.venv 이미 존재 — skip 생성"
fi

# 3) lock 우선, 없으면 requirements.txt
PIP="$ENGINE/.venv/bin/pip"
"$PIP" install --upgrade pip
if [[ -f "$ENGINE/requirements.lock" ]]; then
  "$PIP" install -r "$ENGINE/requirements.lock"
  echo "[setup-venv] installed from requirements.lock (18 pinned packages)"
else
  "$PIP" install -r "$ENGINE/requirements.txt"
  echo "[setup-venv] installed from requirements.txt (unpinned — 권장하지 않음)"
fi

# 4) sanity
"$ENGINE/.venv/bin/python" -c "import flask, waitress, numpy, sklearn, requests; print('OK')"
echo "[setup-venv] done. 활성화: source $ENGINE/.venv/bin/activate"
