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

# 1) Python 3.12 확인 — Ubuntu 24.04 native. Ubuntu 26.04 는 3.14 가 native 라
#    scikit-learn 1.4 / numpy 1.26 휠 부재 → 명시적으로 python3.12 를 우선 탐색.
#    (VELXOR_PY 로 override 가능. 미존재 시 python3 fallback + 경고.)
PY_BIN="${VELXOR_PY:-}"
if [[ -z "$PY_BIN" ]]; then
  if command -v python3.12 >/dev/null; then
    PY_BIN="python3.12"
  elif command -v python3 >/dev/null; then
    PY_BIN="python3"
    PY_VER="$(python3 -c 'import sys;print("{}.{}".format(*sys.version_info[:2]))')"
    if [[ "$PY_VER" != "3.12" ]]; then
      echo "WARN: python3 = $PY_VER (3.12 아님). Ubuntu 26.04+ 라면" >&2
      echo "      'sudo apt install -y python3.12 python3.12-venv python3.12-dev' 후 재실행 권장." >&2
      echo "      requirements.lock 의 scikit-learn 1.4.2 / numpy 1.26.4 는 3.13+ 휠 미배포." >&2
    fi
  else
    echo "ERR: python3 미설치 — sudo apt install -y python3.12 python3.12-venv python3.12-dev" >&2
    exit 3
  fi
fi

# 2) venv 생성 (이미 있으면 skip)
if [[ ! -d "$ENGINE/.venv" ]]; then
  "$PY_BIN" -m venv "$ENGINE/.venv"
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
