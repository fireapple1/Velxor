#!/usr/bin/env bash
# AC2: 300 file ops measured 구간만 wall-clock < 1s (Python 부팅/파일 prep 제외)
set -euo pipefail

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# simulate.py 내부 perf_counter 결과를 신뢰 (sub-ms 해상도 + monotonic)
OUTPUT=$(python poc-samples/ransomware_simulator/v1/simulate.py "$TMP" --count 300)
echo "$OUTPUT"

ELAPSED_MS=$(echo "$OUTPUT" | grep -oE 'AC2_MEASURED_MS=[0-9.]+' | cut -d= -f2)
if [ -z "$ELAPSED_MS" ]; then
  echo "AC2 FAIL — simulate.py did not emit AC2_MEASURED_MS" >&2
  exit 2
fi

echo "AC2 measured-ops wall-clock: ${ELAPSED_MS} ms"
# bash arithmetic은 정수만 — awk로 float 비교
if awk "BEGIN {exit !($ELAPSED_MS < 1000)}"; then
  echo "AC2 PASS"
  exit 0
else
  echo "AC2 FAIL (>=1000ms — do NOT relax threshold)"
  exit 1
fi
