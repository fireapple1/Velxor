#!/usr/bin/env bash
# AC5 wrap — venv 활성 후 eval-ac5.py 실행.
# worker-C-timeline §7.1.
#
# 실제 평가 본체는 scripts/eval-ac5.py 에 있음 (model.pkl 직접 로드).
# 본 wrapper 는 venv 우선 + repo root 정규화만 담당.
#
# 사용:
#   bash scripts/eval-ac5.sh
#
# Exit code: eval-ac5.py 그대로 (PASS=0 / FAIL=1).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="python-engine/.venv/bin/python"
[[ -x "$PY" ]] || PY="python3"

exec "$PY" scripts/eval-ac5.py
