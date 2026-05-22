#!/usr/bin/env bash
# Week 8-9 §5.3 리허설 — 통합 시나리오 3회 반복 측정.
# A 측 책임 (timeline §5.3): collector 안정성(dropped_since_last),
# WS reconnect 성공률, tracing JSON 4-field emit 누락 모니터링.
#
# 사용법:
#   bash scripts/rehearsal.sh                # 3회 반복 (기본)
#   ITER=5 bash scripts/rehearsal.sh         # N회 반복
#
# 시나리오 (회당):
#   1. burst events.jsonl 60건 → rust-service stub mode 기동
#   2. WS 캡처 client #1 (last_seq=0) 3초
#   3. client #1 종료 → 마지막 seq=N 기록
#   4. WS 캡처 client #2 (last_seq=N) 3초 — backlog + dedupe 검증
#   5. 종료 → rust.log 메트릭 추출
#
# 측정 지표:
#   - tracing 4 field emit count (event_received_ts / ws_sent_ts /
#     classify_start_ts / classify_end_ts)
#   - dropped_since_last >0 발생 라인 수
#   - reconnect: client #2 가 #1 의 마지막 seq+1 부터 backlog 받음 여부
#   - dedupe: client #2 캡처에 last_seq 이하 seq 가 없음 (서버 측 dedupe 검증)
#
# `set -e` 미사용: 회별 PASS/FAIL accumulate + iter 별 측정값 수집이 목적이라
# 한 iter 실패가 다음 iter / 보고서 생성을 막으면 안 됨. trap cleanup 으로 leak 방지.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ITER="${ITER:-3}"
DATE="$(date +%Y-%m-%d)"
OUT_BASE="$HOME/velxor-work/rehearsal-${DATE}"
mkdir -p "$OUT_BASE"

# trap cleanup — 인터럽트 시 leftover 정리
cleanup_rehearsal() {
  pkill -u "$USER" -f "rust-service/target/release/rust-service" 2>/dev/null || true
  pkill -u "$USER" -f "python-engine/.venv/bin/python" 2>/dev/null || true
  pkill -u "$USER" -f "websocat" 2>/dev/null || true
}
trap cleanup_rehearsal EXIT INT TERM

# events.jsonl 백업 + 60 burst 생성
BACKUP="$HOME/velxor-work/events.jsonl.orig.bak"
if [[ ! -f "$BACKUP" ]]; then
  cp "$ROOT/events.jsonl" "$BACKUP" 2>/dev/null || true
fi
python3 -c "
import json, time
base = int(time.time() * 1000)
with open('$ROOT/events.jsonl','w') as f:
    for i in range(60):
        f.write(json.dumps({'schema_version':'1.0','seq':i+1,'dropped_since_last':0,
            'pid':1234,'parent_pid':1,'image_path':'/usr/local/bin/burst',
            'event_type':'FileWrite','file_path':f'/home/lsy/velxor-work/src/burst_{i:03d}.dat',
            'ts_unix_ms':base+i*10}, separators=(',',':')) + '\n')
"

run_iter() {
  local n="$1"
  local iter_dir="$OUT_BASE/iter-$n"
  mkdir -p "$iter_dir"
  : > "$iter_dir/engine.log"; : > "$iter_dir/rust.log"
  : > "$iter_dir/ws1.jsonl"; : > "$iter_dir/ws2.jsonl"

  echo "[rehearsal] === iter $n / $ITER ==="

  # 잔존 정리
  pkill -u "$USER" -f "rust-service/target/release/rust-service" 2>/dev/null || true
  pkill -u "$USER" -f "python-engine/.venv/bin/python" 2>/dev/null || true
  pkill -u "$USER" -f "websocat" 2>/dev/null || true
  sleep 0.4

  # 1. engine
  ( cd "$ROOT" && python-engine/.venv/bin/python python-engine/waitress_conf.py ) \
    >"$iter_dir/engine.log" 2>&1 &
  local epid=$!
  for _ in $(seq 1 25); do
    curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1 && break
    sleep 0.2
  done
  if ! curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then
    echo "[rehearsal] FAIL iter $n: engine /health"; kill $epid 2>/dev/null; return 1
  fi

  # 2. rust-service (stderr=tracing JSON 으로 rust.log)
  ( cd "$ROOT" && VELXOR_STUB=collector \
      VELXOR_EVENTS_PATH="$ROOT/events.jsonl" \
      ./rust-service/target/release/rust-service ) \
    >"$iter_dir/rust.log" 2>&1 &
  local rpid=$!
  for _ in $(seq 1 40); do
    ss -tln 2>/dev/null | grep -q ':7000 ' && break
    sleep 0.2
  done
  if ! ss -tln 2>/dev/null | grep -q ':7000 '; then
    echo "[rehearsal] FAIL iter $n: WS :7000"; kill $rpid $epid 2>/dev/null; return 2
  fi

  # 3. WS client #1 (last_seq=0) 3s
  timeout 3 websocat "ws://127.0.0.1:7000?last_seq=0" >"$iter_dir/ws1.jsonl" 2>/dev/null || true
  local last_seq
  last_seq=$(tail -n 50 "$iter_dir/ws1.jsonl" 2>/dev/null | \
    grep -oE '"seq":[0-9]+' | grep -vE '"seq":0' | \
    sort -t: -k2 -n | tail -n1 | grep -oE '[0-9]+' || echo "0")
  last_seq=${last_seq:-0}
  echo "[rehearsal] iter $n: ws1 last_seq=$last_seq lines=$(wc -l < "$iter_dir/ws1.jsonl")"

  # 4. WS client #2 (?last_seq=N) — reconnect + dedupe 검증
  timeout 3 websocat "ws://127.0.0.1:7000?last_seq=$last_seq" >"$iter_dir/ws2.jsonl" 2>/dev/null || true
  echo "[rehearsal] iter $n: ws2 (last_seq=$last_seq) lines=$(wc -l < "$iter_dir/ws2.jsonl")"

  # 5. cleanup
  kill $rpid $epid 2>/dev/null
  sleep 0.4
  kill -9 $rpid $epid 2>/dev/null || true
  wait 2>/dev/null || true

  # 6. metric 추출
  {
    echo "iter=$n"
    echo "ws1_lines=$(wc -l < "$iter_dir/ws1.jsonl")"
    echo "ws2_lines=$(wc -l < "$iter_dir/ws2.jsonl")"
    echo "ws1_last_seq=$last_seq"
    echo "tracing_event_received_ts=$(grep -c '"event_received_ts"' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "tracing_ws_sent_ts=$(grep -c '"ws_sent_ts"' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "tracing_classify_start_ts=$(grep -c '"classify_start_ts"' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "tracing_classify_end_ts=$(grep -c '"classify_end_ts"' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "tracing_n_arrived=$(grep -c '"n_arrived"' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "tracing_latency_ms=$(grep -c '"latency_ms"' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "broadcast_lag_count=$(grep -c 'broadcast lag' "$iter_dir/rust.log" 2>/dev/null || true)"
    echo "dropped_since_last_positive=$(grep -oE '"dropped_since_last":[1-9][0-9]*' "$iter_dir/ws1.jsonl" "$iter_dir/ws2.jsonl" 2>/dev/null | wc -l)"
    # reconnect dedupe 검증: ws2 에 last_seq 이하 seq 가 있으면 dedupe FAIL
    local dup_violation
    dup_violation=$(grep -oE '"seq":[0-9]+' "$iter_dir/ws2.jsonl" 2>/dev/null | \
      grep -vE '"seq":0' | \
      awk -F: -v th="$last_seq" '$2 <= th {c++} END {print c+0}')
    echo "reconnect_dedupe_violations=${dup_violation:-0}"
  } > "$iter_dir/metrics.kv"

  cat "$iter_dir/metrics.kv"
  echo
  return 0
}

PASS_COUNT=0
for n in $(seq 1 "$ITER"); do
  if run_iter "$n"; then
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
done

# 합산 보고서
REPORT="$OUT_BASE/rehearsal-report.md"
{
  echo "# §5.3 리허설 보고서 — $DATE"
  echo
  echo "**iter**: $PASS_COUNT/$ITER PASS"
  echo "**시나리오**: events.jsonl 60건 burst + WS client #1 (3s) + client #2 reconnect (?last_seq=N, 3s)"
  echo "**모드**: VELXOR_STUB=collector (옵션 C, A timeline §5.1)"
  echo
  echo "## 회별 메트릭"
  echo
  echo '| iter | ws1 lines | ws2 lines | ws1 last_seq | event_received_ts | ws_sent_ts | classify_start_ts | classify_end_ts | broadcast_lag | dropped>0 | dedupe violations |'
  echo '|---|---|---|---|---|---|---|---|---|---|---|'
  for n in $(seq 1 "$ITER"); do
    local_f="$OUT_BASE/iter-$n/metrics.kv"
    [[ ! -f "$local_f" ]] && { echo "| $n | (FAIL) | | | | | | | | | |"; continue; }
    # bash trick: source kv
    set -a
    ws1_lines=""; ws2_lines=""; ws1_last_seq=""
    tracing_event_received_ts=""; tracing_ws_sent_ts=""
    tracing_classify_start_ts=""; tracing_classify_end_ts=""
    broadcast_lag_count=""; dropped_since_last_positive=""; reconnect_dedupe_violations=""
    # shellcheck disable=SC1090
    source "$local_f"
    set +a
    echo "| $n | $ws1_lines | $ws2_lines | $ws1_last_seq | $tracing_event_received_ts | $tracing_ws_sent_ts | $tracing_classify_start_ts | $tracing_classify_end_ts | $broadcast_lag_count | $dropped_since_last_positive | $reconnect_dedupe_violations |"
  done
  echo
  echo "## 판정 기준"
  echo "- **collector 안정성**: dropped>0 + broadcast_lag = 0 이면 PASS"
  echo "- **WS reconnect**: dedupe violations = 0 (서버 측 backlog_max_seq dedupe 검증)"
  echo "- **tracing JSON 누락 없음**: event_received_ts ≥ 60 (per event), classify_start_ts/end_ts ≥ 1 (burst 50+ → trigger)"
  echo
  echo "## 아티팩트"
  echo "- 회별 디렉토리: \`$OUT_BASE/iter-{1..$ITER}/\`"
  echo "- 회별 파일: \`engine.log / rust.log / ws1.jsonl / ws2.jsonl / metrics.kv\`"
} > "$REPORT"

echo "[rehearsal] OVERALL $PASS_COUNT/$ITER PASS"
echo "[rehearsal] report: $REPORT"

# events.jsonl 복원
[[ -f "$BACKUP" ]] && cp "$BACKUP" "$ROOT/events.jsonl"
echo "[rehearsal] events.jsonl restored"

[[ "$PASS_COUNT" -eq "$ITER" ]] && exit 0 || exit 1
