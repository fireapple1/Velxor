#!/usr/bin/env bash
# Velxor walking skeleton 통합 startup — engine + Rust service + UI 일괄 기동
# Owner: C (재분배 2026-05-22)
set -euo pipefail

# 작업 디렉토리는 ext4 로컬 — /tmp(tmpfs) 회피
WORK="${VELXOR_WORK:-$HOME/velxor-work}"
mkdir -p "$WORK/src" "$WORK/dst"

# 1) Engine — venv 활성 + Waitress 기동 (C)
(
  cd python-engine && source .venv/bin/activate
  VELXOR_STUB="${VELXOR_STUB:-}" python waitress_conf.py
) &
ENGINE_PID=$!
trap 'kill $ENGINE_PID $RUST_PID $UI_PID 2>/dev/null || true' EXIT

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

# UI ready wait
until curl -sf http://127.0.0.1:5173 > /dev/null; do sleep 0.5; done
echo "[run-all] engine=$ENGINE_PID rust=$RUST_PID ui=$UI_PID — all started"

# Smoke: VELXOR_STUB=both 또는 collector 모드면 events.jsonl 한 줄 emit
if [[ "${VELXOR_STUB:-}" == "both" || "${VELXOR_STUB:-}" == "collector" ]]; then
  echo '{"schema_version":"1.0","seq":1,"dropped_since_last":0,"pid":1234,"parent_pid":1,"image_path":"/usr/local/bin/smoke","event_type":"FileWrite","file_path":"'"$WORK"'/dst/a.docx","ts_unix_ms":'"$(date +%s%3N)"'}' >> events.jsonl
fi

sleep 3
echo "[run-all] OK — VELXOR_STUB='${VELXOR_STUB:-}'"
wait
