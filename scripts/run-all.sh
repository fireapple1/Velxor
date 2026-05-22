#!/usr/bin/env bash
# Velxor walking skeleton 통합 startup — engine + Rust service + UI 일괄 기동
# Owner: C (재분배 2026-05-22)
set -euo pipefail

# 어디서 호출되어도 레포 루트에서 실행되도록 cd
cd "$(dirname "$0")/.."

# 작업 디렉토리는 ext4 로컬 — /tmp(tmpfs) 회피
WORK="${VELXOR_WORK:-$HOME/velxor-work}"
mkdir -p "$WORK/src" "$WORK/dst"

# rust-service stderr → logs/trace.json (tracing output) 사전 준비
mkdir -p rust-service/logs

# 포트 사전 점검 — 좀비/충돌 감지 후 명시적 에러
for port in 8765 7000 5173; do
  if ss -tlnp 2>/dev/null | grep -q ":$port "; then
    echo "[run-all] ERROR: 포트 $port 이미 점유 중. 다음으로 정리 후 재시도:" >&2
    echo "  pkill -u \$USER -f 'waitress_conf|cargo run|vite'" >&2
    exit 1
  fi
done

# UI 의존성 미설치 시 자동 설치 (fresh clone 대응)
if [ ! -d ui/node_modules ]; then
  echo "[run-all] ui/node_modules 없음 → npm install 실행 중..."
  (cd ui && npm install)
fi

# 1) Engine — venv 활성 + Waitress 기동 (C)
(
  cd python-engine && source .venv/bin/activate
  VELXOR_STUB="${VELXOR_STUB:-}" python waitress_conf.py
) &
ENGINE_PID=$!

# trap: SIGTERM 먼저, 200ms 후 SIGKILL — 좀비 잔류 방지
cleanup() {
  for pid in "${ENGINE_PID:-}" "${RUST_PID:-}" "${UI_PID:-}"; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.2
  for pid in "${ENGINE_PID:-}" "${RUST_PID:-}" "${UI_PID:-}"; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# engine health wait
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8765/health > /dev/null && break
  sleep 0.5
done

# 2) Rust service (A의 산출물)
(
  cd rust-service && VELXOR_STUB="${VELXOR_STUB:-}" cargo run --release 2> logs/trace.json
) &
RUST_PID=$!

# 3) UI (B의 산출물)
(
  cd ui && npm run dev
) &
UI_PID=$!

# UI ready wait (max 30s, 무한 hang 방지)
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:5173 > /dev/null && break
  sleep 0.5
done
echo "[run-all] engine=$ENGINE_PID rust=$RUST_PID ui=$UI_PID — all started"

# Smoke: VELXOR_STUB=both 또는 collector 모드면 events.jsonl 한 줄 emit
if [[ "${VELXOR_STUB:-}" == "both" || "${VELXOR_STUB:-}" == "collector" ]]; then
  echo '{"schema_version":"1.0","seq":1,"dropped_since_last":0,"pid":1234,"parent_pid":1,"image_path":"/usr/local/bin/smoke","event_type":"FileWrite","file_path":"'"$WORK"'/dst/a.docx","ts_unix_ms":'"$(date +%s%3N)"'}' >> events.jsonl
fi

sleep 3
echo "[run-all] OK — VELXOR_STUB='${VELXOR_STUB:-}'"
wait
