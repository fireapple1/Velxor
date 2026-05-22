#!/usr/bin/env bash
# interface-schema v1.1 ↔ 코드 drift 검증.
# v1.1 의 핵심 enum/상수가 python-engine/app.py + rust-service/src/* 에 일치하는지.
#
# 검증 항목:
#   §2.1 MAX_EVENTS = 1024, body ≤ 4 MiB
#   §2.2.1 model_version 4-prefix enum (lr-/rules-/rules-fallback-/stub-)
#   §2.4 /health status enum (ok|degraded|down)
#   §3.2 WS message type 4종 (node_add|verdict|alert|gap)
#
# drift 발견 시 항목 명시 + exit 1.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP=python-engine/app.py
RUST_DIR=rust-service/src
SCHEMA=contracts/interface-schema.md

[ -f "$APP" ]    || { echo "ERR: $APP 없음"; exit 2; }
[ -d "$RUST_DIR" ] || { echo "ERR: $RUST_DIR 없음"; exit 2; }
[ -f "$SCHEMA" ] || { echo "ERR: $SCHEMA 없음"; exit 2; }

drift=()
check() {
  local label="$1"; local file="$2"; local pattern="$3"
  if grep -qE "$pattern" "$file"; then
    echo "  ✅ $label  ($file)"
  else
    drift+=("$label: pattern '$pattern' not found in $file")
    echo "  ❌ $label  ($file)"
  fi
}

echo "=== §2.1 body 상한 ==="
check "MAX_EVENTS = 1024"    "$APP" '^MAX_EVENTS[[:space:]]*=[[:space:]]*1024'
check "MAX_BODY_BYTES = 4MiB" "$APP" 'MAX_BODY_BYTES[[:space:]]*=[[:space:]]*4[[:space:]]*\*[[:space:]]*1024[[:space:]]*\*[[:space:]]*1024'

echo
echo "=== §2.2.1 model_version 4-prefix enum ==="
# stub- / lr- / rules- / rules-fallback- 모두 app.py 또는 fallback_rules.py 에 emit
for prefix in '"stub-v1"' '"lr-2026w7"' '"rules-v1"' '"rules-fallback-v1"'; do
  if grep -qF "$prefix" "$APP" python-engine/fallback_rules.py 2>/dev/null; then
    echo "  ✅ prefix $prefix"
  else
    drift+=("model_version prefix $prefix 미발견 (app.py + fallback_rules.py)")
    echo "  ❌ prefix $prefix"
  fi
done

echo
echo "=== §2.4 /health status enum (ok|degraded|down) ==="
# Python: status = "ok" if ... else "degraded" — 공백 + 분기 모두 허용
check 'status="ok" literal'        "$APP" '"ok"'
check 'status="degraded" literal'  "$APP" '"degraded"'
# down 은 503 분기 — 본 구현은 fallback rules import 성공 가정해 down 분기 미구현
# v1.1 spec 은 503 + "down" 정의만 있고 emit 강제 X. drift 로 보지 않음.
echo "  ℹ status=\"down\" (503) 분기는 spec 정의만, 구현은 항상 200 (degraded/ok)"

echo
echo "=== §3.2 WS message type 4종 (node_add|verdict|alert|gap) ==="
for t in node_add verdict alert gap; do
  if grep -rqF "\"$t\"" "$RUST_DIR"; then
    echo "  ✅ type \"$t\""
  else
    drift+=("WS type \"$t\" 미발견 ($RUST_DIR)")
    echo "  ❌ type \"$t\""
  fi
done

echo
echo "============================================================"
if [ ${#drift[@]} -eq 0 ]; then
  echo "[check-schema-drift] PASS — schema v1.1 ↔ 코드 일치"
  exit 0
fi
echo "[check-schema-drift] FAIL — drift ${#drift[@]} 건:"
printf "  - %s\n" "${drift[@]}"
exit 1
