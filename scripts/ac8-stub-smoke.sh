#!/usr/bin/env bash
# AC8 stub 3-mode smoke — VELXOR_STUB={collector,both} 단독 기동 후
# ws-record.sh 가 PASS 하는지 확인. CI 자동화용 wrap.
#
# 사용법:
#   bash scripts/ac8-stub-smoke.sh                    # 두 모드 모두 검증
#   bash scripts/ac8-stub-smoke.sh collector          # 단일 모드만
#   bash scripts/ac8-stub-smoke.sh both
#
# Done 기준 (모드 당):
#   1. engine /health 응답 (200)
#   2. rust-service :7000 (WS) + :7001 (block) listening
#   3. scripts/ws-record.sh exit 0 (node_add + FileWrite 매칭)
#
# Owner: A (CLAUDE.md AC8 wrap)
#
# `set -e` 미사용: 모드별 explicit pass/fail accumulate (OVERALL 결과 산출용).
# -e 가 있으면 첫 mode FAIL 시 second mode 검증 skip → CI 가시성 저하.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_BASE="$HOME/velxor-work/ac8-smoke"
mkdir -p "$LOG_BASE"

# SIGINT/EXIT 시 leftover engine + rust-service 정리.
cleanup_ac8() {
  pkill -u "$USER" -f "rust-service/target/release/rust-service" 2>/dev/null || true
  pkill -u "$USER" -f "python-engine/.venv/bin/python" 2>/dev/null || true
}
trap cleanup_ac8 EXIT INT TERM

# events.jsonl 이 burst 가 아니어도 OK — AC8은 node_add 1건 만으로 충족.
# 단, events.jsonl 비어있으면 FAIL이므로 사전 확인.
if [[ ! -s "$ROOT/events.jsonl" ]]; then
  echo "[ac8] FAIL: $ROOT/events.jsonl 비어있음 — stub collector 모드에서 emit할 게 없음" >&2
  exit 1
fi

run_mode() {
  local label="$1"
  local stub_val="$2"
  local logdir="$LOG_BASE/$label"
  mkdir -p "$logdir"
  : > "$logdir/engine.log"; : > "$logdir/rust.log"

  echo "[ac8] === mode=$label (VELXOR_STUB=$stub_val) ==="

  # 잔존 프로세스 정리
  pkill -u "$USER" -f "rust-service/target/release/rust-service" 2>/dev/null || true
  pkill -u "$USER" -f "python-engine/.venv/bin/python" 2>/dev/null || true
  sleep 0.3

  # 1. engine
  ( cd "$ROOT" && VELXOR_STUB="$stub_val" \
      python-engine/.venv/bin/python python-engine/waitress_conf.py ) \
    >"$logdir/engine.log" 2>&1 &
  local epid=$!

  for _ in $(seq 1 25); do
    curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1 && break
    sleep 0.2
  done
  if ! curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then
    echo "[ac8] FAIL: engine /health unreachable (mode=$label)" >&2
    kill $epid 2>/dev/null; return 2
  fi

  # 2. rust-service
  ( cd "$ROOT" && VELXOR_STUB="$stub_val" \
      VELXOR_EVENTS_PATH="$ROOT/events.jsonl" \
      ./rust-service/target/release/rust-service ) \
    >"$logdir/rust.log" 2>&1 &
  local rpid=$!

  for _ in $(seq 1 40); do
    ss -tln 2>/dev/null | grep -q ':7000 ' && \
    ss -tln 2>/dev/null | grep -q ':7001 ' && break
    sleep 0.2
  done
  if ! ss -tln 2>/dev/null | grep -q ':7000 '; then
    echo "[ac8] FAIL: WS :7000 never listened (mode=$label)" >&2
    tail -20 "$logdir/rust.log" >&2
    kill $rpid $epid 2>/dev/null; return 3
  fi
  if ! ss -tln 2>/dev/null | grep -q ':7001 '; then
    echo "[ac8] FAIL: block :7001 never listened (mode=$label)" >&2
    tail -20 "$logdir/rust.log" >&2
    kill $rpid $epid 2>/dev/null; return 4
  fi
  echo "[ac8] mode=$label engine OK, WS :7000 + block :7001 listening"

  # collector_source 가 events.jsonl 한 차례 polling 하도록 잠시 대기
  sleep 0.5

  # 3. ws-record AC1 verifier (5s default)
  "$ROOT/scripts/ws-record.sh" "$logdir/ws-capture.jsonl" >>"$logdir/rust.log" 2>&1
  local ret=$?

  # cleanup
  kill $rpid $epid 2>/dev/null
  sleep 0.3
  kill -9 $rpid $epid 2>/dev/null || true
  wait 2>/dev/null || true

  if [[ $ret -ne 0 ]]; then
    echo "[ac8] FAIL: ws-record exit=$ret (mode=$label)" >&2
    return $ret
  fi
  echo "[ac8] mode=$label PASS"
  return 0
}

# 인자 파싱
if [[ $# -gt 0 ]]; then
  MODES=("$1")
else
  MODES=("collector" "both")
fi

OVERALL=0
for m in "${MODES[@]}"; do
  if ! run_mode "$m" "$m"; then
    OVERALL=1
  fi
done

echo
if [[ $OVERALL -eq 0 ]]; then
  echo "[ac8] OVERALL PASS — modes: ${MODES[*]}"
  echo "[ac8] artifacts: $LOG_BASE/{${MODES[*]/ /,}}/"
  exit 0
else
  echo "[ac8] OVERALL FAIL — see $LOG_BASE/" >&2
  exit 1
fi
