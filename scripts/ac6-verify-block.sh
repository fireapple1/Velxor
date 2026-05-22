#!/usr/bin/env bash
# AC6 차단 검증 — POST /block/{pid} 가 SIGTERM→200ms→SIGKILL 시퀀스로
# 대상 PID 를 종료시키는지 확인. CLAUDE.md "kill sequence" 정책 일치.
#
# 사용법:
#   bash scripts/ac6-verify-block.sh
#
# 사전 조건:
#   - rust-service 가 :7001 (/block 엔드포인트) listening
#   - 또는 VELXOR_RUST_AUTOSTART=1 시 본 스크립트가 직접 띄움
#
# Owner: A (rust-service DRI)
#
# `set -e` 미사용: 회별 단계마다 explicit return code check + trap cleanup
# 으로 partial-failure 복구. -e 가 있으면 cleanup 직전에 die 해서 좀비 leak.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/velxor-work/ac6-run"
mkdir -p "$LOG_DIR"

BLOCK_URL="http://127.0.0.1:7001/block"
TIMEOUT_HEAD=5     # rust-service /block listening 대기 (sec)
KILL_WAIT_MS=500   # SIGTERM 200ms + margin

# SIGINT/EXIT 시 좀비 정리 — sleep 9999 leak 방지.
TARGET_PID=""
RUST_PID=""
cleanup_ac6() {
  [[ -n "$TARGET_PID" ]] && kill -9 "$TARGET_PID" 2>/dev/null || true
  [[ -n "$RUST_PID" ]] && kill "$RUST_PID" 2>/dev/null || true
  sleep 0.2
  [[ -n "$RUST_PID" ]] && kill -9 "$RUST_PID" 2>/dev/null || true
}
trap cleanup_ac6 EXIT INT TERM

# ---------------------------------------------------------------
# 1. rust-service /block 헬스 체크 (옵션: autostart)
# ---------------------------------------------------------------
need_autostart=0
if ! ss -tln 2>/dev/null | grep -q ':7001 '; then
  if [[ "${VELXOR_RUST_AUTOSTART:-0}" == "1" ]]; then
    need_autostart=1
    : > "$LOG_DIR/rust.log"
    echo "[ac6] rust-service :7001 미감지 → autostart (VELXOR_STUB=collector)"
    pkill -u "$USER" -f "rust-service/target/release/rust-service" 2>/dev/null || true
    sleep 0.3
    ( cd "$ROOT" && VELXOR_STUB=collector \
        VELXOR_EVENTS_PATH="$ROOT/events.jsonl" \
        ./rust-service/target/release/rust-service ) \
      >"$LOG_DIR/rust.log" 2>&1 &
    RUST_PID=$!
    for _ in $(seq 1 $((TIMEOUT_HEAD * 5))); do
      ss -tln 2>/dev/null | grep -q ':7001 ' && break
      sleep 0.2
    done
  fi
fi

if ! ss -tln 2>/dev/null | grep -q ':7001 '; then
  echo "[ac6] FAIL: rust-service :7001 not listening. VELXOR_RUST_AUTOSTART=1 로 자동 기동 가능." >&2
  exit 2
fi
echo "[ac6] rust-service :7001 OK"

# ---------------------------------------------------------------
# 2. 희생 프로세스 spawn (sleep 9999)
# ---------------------------------------------------------------
sleep 9999 &
TARGET_PID=$!
sleep 0.1
# spawn 직후 alive 확인
if ! kill -0 "$TARGET_PID" 2>/dev/null; then
  echo "[ac6] FAIL: target PID $TARGET_PID not running after spawn" >&2
  [[ "$need_autostart" == "1" ]] && kill ${RUST_PID:-0} 2>/dev/null
  exit 3
fi
echo "[ac6] target spawned pid=$TARGET_PID (sleep 9999)"

# ---------------------------------------------------------------
# 3. POST /block/{pid} 호출
# ---------------------------------------------------------------
echo "[ac6] POST $BLOCK_URL/$TARGET_PID"
RESP=$(curl -sf -X POST "$BLOCK_URL/$TARGET_PID" -o "$LOG_DIR/block-response.json" -w "%{http_code}")
echo "[ac6] HTTP=$RESP body=$(cat "$LOG_DIR/block-response.json")"

if [[ "$RESP" != "200" ]]; then
  echo "[ac6] FAIL: HTTP $RESP from /block endpoint" >&2
  kill "$TARGET_PID" 2>/dev/null
  [[ "$need_autostart" == "1" ]] && kill ${RUST_PID:-0} 2>/dev/null
  exit 4
fi

# ---------------------------------------------------------------
# 4. PID 사망 검증 — SIGTERM 200ms + margin 후 kill -0
# ---------------------------------------------------------------
sleep "$(awk "BEGIN {print $KILL_WAIT_MS/1000}")"

if kill -0 "$TARGET_PID" 2>/dev/null; then
  echo "[ac6] FAIL: pid $TARGET_PID still alive after block + ${KILL_WAIT_MS}ms" >&2
  kill -9 "$TARGET_PID" 2>/dev/null
  [[ "$need_autostart" == "1" ]] && kill ${RUST_PID:-0} 2>/dev/null
  exit 5
fi
echo "[ac6] pid $TARGET_PID dead (kill -0 ESRCH 확인)"

# /proc 부재 추가 검증 (race-safe)
if [[ -d "/proc/$TARGET_PID" ]]; then
  echo "[ac6] WARN: /proc/$TARGET_PID still exists (zombie?) — kernel reap 대기"
  sleep 0.2
fi

OUTCOME=$(jq -r '.outcome' "$LOG_DIR/block-response.json" 2>/dev/null || echo "?")
echo "[ac6] outcome=$OUTCOME"

# ---------------------------------------------------------------
# 5. 정리 + PASS
# ---------------------------------------------------------------
if [[ "$need_autostart" == "1" ]]; then
  kill ${RUST_PID:-0} 2>/dev/null
  sleep 0.3
  kill -9 ${RUST_PID:-0} 2>/dev/null || true
fi

# outcome 검증: killed / terminated 만 PASS (already_gone / invalid / error / eperm 은 FAIL)
case "$OUTCOME" in
  killed|terminated)
    echo "[ac6] PASS — outcome=$OUTCOME, target pid=$TARGET_PID dead"
    echo "[ac6] artifacts: $LOG_DIR/{block-response.json, rust.log}"
    exit 0
    ;;
  *)
    echo "[ac6] FAIL — unexpected outcome=$OUTCOME (expected killed|terminated)" >&2
    exit 6
    ;;
esac
