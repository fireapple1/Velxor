#!/usr/bin/env bash
# AC7 sustained run — engine + rust-service 가동 + 메모리 leak / drop / classify_failed 검증.
#
# env:
#   AC7_DURATION=3600       기본 1h (release 모드), dev 모드는 300 (5분)
#   AC7_POLL_INTERVAL=30    헬스 폴링 간격 (초)
#   AC7_RSS_DELTA_MAX_PCT=10  RSS 증가 허용 상한 (퍼센트)
#   AC7_FAILED_RATIO_MAX=0.01 classify_failed/done 허용 상한
#
# PASS 조건 (모두 충족):
#   1. AC7_DURATION 만큼 engine + rust-service 가동 유지 (헬스 폴링 100%)
#   2. RSS Δ ≤ AC7_RSS_DELTA_MAX_PCT (engine + rust 각각)
#   3. dropped_since_last 증가 0 (silent loss 없음)
#   4. classify_failed_ratio < AC7_FAILED_RATIO_MAX
#
# Owner: A (rust-service stability) + C (engine stability)
#
# `set -e` 미사용: 폴링 실패 카운트 + cleanup 모두 보장.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DURATION="${AC7_DURATION:-3600}"
POLL="${AC7_POLL_INTERVAL:-30}"
RSS_MAX_PCT="${AC7_RSS_DELTA_MAX_PCT:-10}"
FAILED_MAX="${AC7_FAILED_RATIO_MAX:-0.01}"

OUT_BASE="$HOME/velxor-work/ac7-sustained"
mkdir -p "$OUT_BASE"
DATE="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_BASE/run-$DATE"
mkdir -p "$OUT"

ENGINE_LOG="$OUT/engine.log"
RUST_LOG="$OUT/rust.log"
RSS_LOG="$OUT/rss.tsv"
HEALTH_LOG="$OUT/health.tsv"

echo "[ac7] duration=${DURATION}s  poll=${POLL}s  RSS_max=${RSS_MAX_PCT}%  failed_max=${FAILED_MAX}"
echo "[ac7] artifacts: $OUT"

# cleanup
EPID=""; RPID=""
cleanup() {
  [ -n "$EPID" ] && kill "$EPID" 2>/dev/null || true
  [ -n "$RPID" ] && kill "$RPID" 2>/dev/null || true
  sleep 0.5
  pkill -u "$USER" -f 'rust-service/target/release/rust-service' 2>/dev/null || true
  pkill -u "$USER" -f 'python-engine/.venv/bin/python.*waitress_conf' 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 잔존 정리
pkill -u "$USER" -f 'rust-service/target/release/rust-service' 2>/dev/null || true
pkill -u "$USER" -f 'python-engine/.venv/bin/python.*waitress_conf' 2>/dev/null || true
sleep 0.5

# events.jsonl 60 burst (sustained 동안 polling 으로 stub 모드 트리거 유지)
[ -f "$ROOT/events.jsonl" ] || python3 -c "
import json, time
base = int(time.time() * 1000)
with open('$ROOT/events.jsonl','w') as f:
    for i in range(60):
        f.write(json.dumps({'schema_version':'1.0','seq':i+1,'dropped_since_last':0,
            'pid':1234,'parent_pid':1,'image_path':'/usr/local/bin/ac7-burst',
            'event_type':'FileWrite','file_path':f'/tmp/ac7_{i:03d}.dat',
            'ts_unix_ms':base+i*10}, separators=(',',':')) + '\n'
        )"

# 1) engine
( cd "$ROOT" && python-engine/.venv/bin/python python-engine/waitress_conf.py ) \
  >"$ENGINE_LOG" 2>&1 &
EPID=$!
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1 && break
  sleep 0.2
done
if ! curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then
  echo "[ac7] FAIL: engine /health 시작 실패"
  exit 1
fi

# 2) rust-service stub=collector
( cd "$ROOT" && VELXOR_STUB=collector \
    VELXOR_EVENTS_PATH="$ROOT/events.jsonl" \
    ./rust-service/target/release/rust-service ) \
  >"$RUST_LOG" 2>&1 &
RPID=$!
for _ in $(seq 1 30); do
  ss -tln 2>/dev/null | grep -q ':7000 ' && break
  sleep 0.2
done
if ! ss -tln 2>/dev/null | grep -q ':7000 '; then
  echo "[ac7] FAIL: rust-service WS :7000 시작 실패"
  exit 1
fi

# 시작 RSS 측정 (KB)
rss_kb() { ps -o rss= -p "$1" 2>/dev/null | tr -d ' ' || echo 0; }

E_START=$(rss_kb "$EPID"); R_START=$(rss_kb "$RPID")
echo "[ac7] start RSS  engine=${E_START}KB  rust=${R_START}KB"
echo -e "ts\tengine_rss\trust_rss" > "$RSS_LOG"
echo -e "ts\tengine_health\trust_ws" > "$HEALTH_LOG"

# 폴링 루프
END_TS=$(( $(date +%s) + DURATION ))
HEALTH_FAILS=0
while [ "$(date +%s)" -lt "$END_TS" ]; do
  sleep "$POLL"
  TS=$(date +%s)
  E_RSS=$(rss_kb "$EPID"); R_RSS=$(rss_kb "$RPID")
  echo -e "$TS\t$E_RSS\t$R_RSS" >> "$RSS_LOG"

  if curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then E_H=1; else E_H=0; fi
  if ss -tln 2>/dev/null | grep -q ':7000 '; then R_W=1; else R_W=0; fi
  echo -e "$TS\t$E_H\t$R_W" >> "$HEALTH_LOG"

  if [ "$E_H" = 0 ] || [ "$R_W" = 0 ]; then
    HEALTH_FAILS=$(( HEALTH_FAILS + 1 ))
    echo "[ac7] health fail at $TS: engine=$E_H rust=$R_W (fails=$HEALTH_FAILS)"
  fi

  REMAIN=$(( END_TS - TS ))
  [ "$REMAIN" -gt 0 ] && echo "[ac7] t=${TS}  engine=${E_RSS}KB  rust=${R_RSS}KB  remain=${REMAIN}s"
done

E_END=$(rss_kb "$EPID"); R_END=$(rss_kb "$RPID")
echo "[ac7] end RSS  engine=${E_END}KB  rust=${R_END}KB"

# RSS Δ % (정수 산술, 0 division 방어)
pct_delta() { local s=$1 e=$2; [ "$s" -le 0 ] && echo 0 && return; echo $(( ( (e - s) * 100 ) / s )); }
E_DELTA=$(pct_delta "$E_START" "$E_END")
R_DELTA=$(pct_delta "$R_START" "$R_END")

# 메트릭 추출 — rust.log 에서 dropped_since_last > 0 + classify done/failed 카운트
DROPPED=$(grep -oE '"dropped_since_last":[1-9][0-9]*' "$RUST_LOG" | wc -l || echo 0)
N_DONE=$(grep -c '"classify_done"' "$RUST_LOG" || echo 0)
N_FAILED=$(grep -c '"classify_failed"' "$RUST_LOG" || echo 0)
# float ratio via awk
RATIO=$(awk -v d="$N_DONE" -v f="$N_FAILED" 'BEGIN { tot=d+f; if (tot==0) print 0; else printf "%.4f", f/tot }')

# 게이트 평가
RESULT=PASS
REASONS=()
[ "$HEALTH_FAILS" -gt 0 ] && { RESULT=FAIL; REASONS+=("health_fails=$HEALTH_FAILS"); }
[ "$E_DELTA" -gt "$RSS_MAX_PCT" ] && { RESULT=FAIL; REASONS+=("engine RSS Δ=${E_DELTA}% > ${RSS_MAX_PCT}%"); }
[ "$R_DELTA" -gt "$RSS_MAX_PCT" ] && { RESULT=FAIL; REASONS+=("rust RSS Δ=${R_DELTA}% > ${RSS_MAX_PCT}%"); }
[ "$DROPPED" -gt 0 ] && { RESULT=FAIL; REASONS+=("dropped_since_last=$DROPPED > 0"); }
awk -v r="$RATIO" -v m="$FAILED_MAX" 'BEGIN { exit !(r > m) }' \
  && { RESULT=FAIL; REASONS+=("classify_failed_ratio=$RATIO > $FAILED_MAX"); }

cat > "$OUT/summary.txt" <<EOF
duration=${DURATION}s  poll=${POLL}s
RSS  engine: ${E_START} → ${E_END} KB (Δ ${E_DELTA}%)
RSS  rust  : ${R_START} → ${R_END} KB (Δ ${R_DELTA}%)
health_fails=$HEALTH_FAILS  dropped_lines=$DROPPED
classify  done=$N_DONE  failed=$N_FAILED  ratio=$RATIO
RESULT=$RESULT
EOF
cat "$OUT/summary.txt"

if [ "$RESULT" = PASS ]; then
  echo "[ac7] PASS"
  exit 0
fi
printf "[ac7] FAIL: %s\n" "${REASONS[@]}"
exit 1
