#!/usr/bin/env bash
# 무대 세션 깨끗하게 종료. tmux + rust-service + python engine + vite + 잔존 victim 파일.
# 사용법: scripts/demo-stop.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="velxor-demo"

echo "[stop] tmux 세션 종료"
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo "[stop] sudo 프로세스 정리"
sudo pkill -TERM -f 'rust-service/target/release/rust-service' 2>/dev/null || true

echo "[stop] python engine 정리"
pkill -TERM -u "$USER" -f 'python-engine/.venv/bin/python.*waitress_conf' 2>/dev/null || true

echo "[stop] vite 정리"
pkill -TERM -u "$USER" -f 'node.*vite' 2>/dev/null || true
pkill -TERM -u "$USER" -f 'electron' 2>/dev/null || true

sleep 0.3

# SIGKILL fallback (좀비 방지)
sudo pkill -KILL -f 'rust-service/target/release/rust-service' 2>/dev/null || true
pkill -KILL -u "$USER" -f 'python-engine/.venv/bin/python.*waitress_conf' 2>/dev/null || true
pkill -KILL -u "$USER" -f 'node.*vite' 2>/dev/null || true

# 포트 해방 확인
for port in 7000 7001 8765 5173; do
  if ss -tlnp 2>/dev/null | grep -q ":$port "; then
    echo "[stop] WARN: 포트 $port 여전히 점유 중"
  else
    echo "[stop] ✓ 포트 $port free"
  fi
done

# trigger sandbox 정리 — record-demo.sh 와 동일 경로
DST="$HOME/velxor-work/dst"
if [ -d "$DST" ]; then
  rm -f "$DST"/ransom_*.enc 2>/dev/null || true
  echo "[stop] ✓ dst sandbox 정리"
fi

echo "[stop] 완료."
