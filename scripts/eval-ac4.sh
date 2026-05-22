#!/usr/bin/env bash
# AC4 측정 wrap — A 의 tracing JSON 파싱 → classify p99 < 100ms.
# worker-C-timeline §7.3.
#
# 본체: scripts/eval-ac4.py (tracing_subscriber JSON 형식 파싱).
# 인자는 그대로 전달 (default = rust-service/logs/trace.json, "-" = stdin).
#
# 사용:
#   bash scripts/eval-ac4.sh                        # default trace path
#   bash scripts/eval-ac4.sh path/to/trace.json
#   ./scripts/run-all.sh 2>rust-service/logs/trace.json
#   bash scripts/eval-ac4.sh                        # 위 캡처로 측정
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="python-engine/.venv/bin/python"
[[ -x "$PY" ]] || PY="python3"

exec "$PY" scripts/eval-ac4.py "$@"
