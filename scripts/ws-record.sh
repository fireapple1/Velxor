#!/usr/bin/env bash
# AC1: WS 캡처에 node_add + event_type="FileWrite" 존재 확인
# 사용법: ws-record.sh [OUT_PATH]
#   기본 OUT: ~/velxor-work/ws-capture.jsonl  (CLAUDE.md 절대 규칙: /tmp 금지)
set -euo pipefail

OUT="${1:-$HOME/velxor-work/ws-capture.jsonl}"
WS_URL="${VELXOR_WS_URL:-ws://127.0.0.1:7000?last_seq=0}"
DURATION="${VELXOR_WS_RECORD_SEC:-5}"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

timeout "$DURATION" websocat "$WS_URL" | tee "$OUT" || true

if [[ ! -s "$OUT" ]]; then
  echo "(empty capture — WS server reachable at $WS_URL?)" >&2
fi

if grep -q '"node_add"' "$OUT" && grep -q '"FileWrite"' "$OUT"; then
  echo "AC1 PASS (ws-record): $OUT"
  exit 0
else
  echo "AC1 FAIL: no node_add+FileWrite in $OUT" >&2
  exit 1
fi
