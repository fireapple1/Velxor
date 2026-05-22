#!/usr/bin/env bash
# AC4 표본 보강 — multi-PID burst → 10 PID 동시 trigger → classify n ≥ 10.
#
# 단일 PID burst (rehearsal.sh) 는 verdict cache TTL 1s × 1 PID 로 classify
# 1회만 발생. 본 스크립트는 10 PID × 50 events 를 events.jsonl 에 합성해
# aggregator.PidWindow 가 10 PID 모두 burst threshold (50/1s) 트리거시켜
# classify 10 회 강제.
#
# 산출:
#   rust-service/logs/multi-pid-trace.json  (tracing JSON, eval-ac4 입력)
#
# Owner: C (AC4 표본 보강).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/rust-service/logs/multi-pid-trace.json"
mkdir -p "$(dirname "$OUT")"

# 잔존 정리 — 포트 7000/7001/8765 모두 해방되도록 polling 으로 확인
kill_all() {
  pkill -u "$USER" -f 'rust-service/target/release/rust-service' 2>/dev/null || true
  pkill -u "$USER" -f 'python-engine/.venv/bin/python.*waitress_conf' 2>/dev/null || true
}
kill_all
# 포트 해방 대기 (max 5s)
for _ in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -qE ':(7000|7001|8765) ' || break
  sleep 1
done

BACKUP="$HOME/velxor-work/events.jsonl.multipid.bak"
[ -f "$BACKUP" ] || cp "$ROOT/events.jsonl" "$BACKUP" 2>/dev/null || true

# events.jsonl: 10 PID × 50 events
python3 - <<'PYEOF'
import json, time
base = int(time.time() * 1000)
N_PIDS = 10
N_EVENTS_PER_PID = 50  # aggregator burst threshold 50/1s 정렬
seq = 0
with open('events.jsonl', 'w') as f:
    for pid_idx in range(N_PIDS):
        pid = 10000 + pid_idx
        for i in range(N_EVENTS_PER_PID):
            seq += 1
            f.write(json.dumps({
                'schema_version':'1.0', 'seq': seq, 'dropped_since_last': 0,
                'pid': pid, 'parent_pid': 1,
                'image_path': f'/usr/local/bin/multi-pid-{pid_idx:02d}',
                'event_type': 'FileWrite',
                'file_path': f'/tmp/mp_{pid_idx:02d}_{i:03d}.dat',
                'ts_unix_ms': base + i * 10,
            }, separators=(',', ':')) + '\n')
print(f"emitted {seq} events  ({N_PIDS} PID × {N_EVENTS_PER_PID})")
PYEOF

# 1) engine
( cd "$ROOT" && python-engine/.venv/bin/python python-engine/waitress_conf.py ) \
  > /dev/null 2>&1 &
EPID=$!

# 2) engine /health 준비 — until 패턴
HEALTH_OK=0
for _ in $(seq 1 25); do
  if curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then
    HEALTH_OK=1; break
  fi
  sleep 0.2
done

cleanup() {
  [ -n "${RPID:-}" ] && kill "$RPID" 2>/dev/null || true
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null || true
  kill_all
  [ -f "$BACKUP" ] && cp "$BACKUP" "$ROOT/events.jsonl" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ "$HEALTH_OK" = 0 ]; then
  echo "[multi-pid-burst] FAIL: engine /health 시작 실패"
  exit 1
fi

# 3) rust-service stub=collector — stderr 캡처
( cd "$ROOT" && VELXOR_STUB=collector \
    VELXOR_EVENTS_PATH="$ROOT/events.jsonl" \
    ./rust-service/target/release/rust-service ) \
  > "$OUT" 2>&1 &
RPID=$!

# 4) WS :7000 listening 확인 — bind 실패 (port 7001 점유 등) 조기 검출
WS_OK=0
for _ in $(seq 1 20); do
  if ss -tln 2>/dev/null | grep -q ':7000 '; then WS_OK=1; break; fi
  if ! kill -0 "$RPID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [ "$WS_OK" = 0 ]; then
  echo "[multi-pid-burst] FAIL: rust-service WS :7000 시작 실패 (rust dead?)"
  echo "---trace head---"; head -20 "$OUT"
  exit 2
fi

# 5) classify_done count >= 10 까지 polling (max 12s)
TARGET=10
for _ in $(seq 1 24); do
  N=$(grep -c '"classify_done"' "$OUT" 2>/dev/null)
  [ "${N:-0}" -ge "$TARGET" ] && break
  sleep 0.5
done

# 6) 측정
N_EVT=$(grep -c '"evt_in"' "$OUT" 2>/dev/null)
N_WS=$(grep -c '"ws_out"' "$OUT" 2>/dev/null)
N_DONE=$(grep -c '"classify_done"' "$OUT" 2>/dev/null)
N_FAILED=$(grep -c '"classify_failed"' "$OUT" 2>/dev/null)
N_EVT="${N_EVT:-0}"; N_WS="${N_WS:-0}"; N_DONE="${N_DONE:-0}"; N_FAILED="${N_FAILED:-0}"

echo "[multi-pid-burst] evt_in=$N_EVT  ws_out=$N_WS  classify done=$N_DONE failed=$N_FAILED"
echo "[multi-pid-burst] trace: $OUT"

if [ "$N_DONE" -ge "$TARGET" ]; then
  echo "[multi-pid-burst] PASS (classify n=$N_DONE >= $TARGET)"
  exit 0
fi
echo "[multi-pid-burst] FAIL (classify n=$N_DONE < $TARGET)"
exit 1
