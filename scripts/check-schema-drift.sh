#!/usr/bin/env bash
# interface-schema v1.1 ↔ 코드 drift 검증 — Python verifier 위임 (Codex audit #10).
#
# 본 shell 은 verify-success.sh G12 게이트의 historic entrypoint 유지를 위한 wrapper.
# 실제 검증은 scripts/check-schema-drift.py 가 수행 (Flask test_client + Rust source 분석):
#   §2.1  body 상한 (literal + runtime + 413)
#   §2.1  보안 입력 검증 (malformed → 400, events list / dict 검증)
#   §2.2.1 model_version 4-prefix enum (lr-/rules-/rules-fallback-/stub-)
#   §2.2.1 Rust classifier_client error_for_status (non-200 verdict 미발행)
#   §2.4  /health status enum
#   §3.2  WS message type 4종
#
# drift 시 exit 1, 상세 stdout.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# venv python 우선 (Flask 의존), 시스템 python3 fallback
PY="$ROOT/python-engine/.venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="python3"
fi

exec "$PY" "$ROOT/scripts/check-schema-drift.py"
