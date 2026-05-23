#!/usr/bin/env bash
# 무대 4-pane tmux 세션 자동 기동.
# Layout (16:9 가정):
#   ┌──────────────┬──────────────┐
#   │ ① Rust       │ ③ Electron   │
#   ├──────────────┼──────────────┤
#   │ ② Python     │ ④ Trigger    │
#   └──────────────┴──────────────┘
#
# 사용법:
#   scripts/demo-start.sh             # STUB=engine (무대 기본)
#   STUB_MODE=both scripts/demo-start.sh   # collector + engine 모두 stub
#   STUB_MODE=none scripts/demo-start.sh   # full real (위험)
#
# 사전조건:
#   - scripts/demo-preflight.sh 통과
#   - sudo -v 캐시 갱신됨
#
# 종료:
#   scripts/demo-stop.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SESSION="velxor-demo"
STUB_MODE="${STUB_MODE:-engine}"
LOG_DIR="$HOME/velxor-work/demo-logs"
mkdir -p "$LOG_DIR"

if ! command -v tmux >/dev/null; then
  echo "ERROR: tmux 미설치 — sudo apt install -y tmux" >&2
  exit 1
fi

# 기존 세션 있으면 종료
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[start] 기존 세션 종료 ($SESSION)"
  tmux kill-session -t "$SESSION"
  sleep 1
fi

# 포트 사전 점검
for port in 7000 7001 8765 5173; do
  if ss -tlnp 2>/dev/null | grep -q ":$port "; then
    echo "ERROR: 포트 $port 점유 — scripts/demo-stop.sh 후 재시도" >&2
    exit 1
  fi
done

# sudo 캐시 갱신 (Rust 가 fanotify 위해 root 필요)
if ! sudo -n true 2>/dev/null; then
  echo "[start] sudo 캐시 만료 — 비밀번호 입력 필요"
  sudo -v || { echo "ERROR: sudo 인증 실패" >&2; exit 1; }
fi

echo "[start] STUB_MODE=$STUB_MODE — tmux 세션 '$SESSION' 생성"

# ① Rust (좌상)
tmux new-session -d -s "$SESSION" -n main \
  "echo '── ① Rust collector + aggregator + WS :7000 + REST :7001 ──'; \
   sleep 2; \
   sudo VELXOR_STUB='$STUB_MODE' VELXOR_LOG=info \
     rust-service/target/release/rust-service \
     2>&1 | tee '$LOG_DIR/rust.log'"

# ② Python (좌하) — Rust 아래로 split-window
tmux split-window -t "$SESSION:0" -v \
  "echo '── ② Python engine (Flask + Waitress) :8765 ──'; \
   sleep 4; \
   cd python-engine && source .venv/bin/activate && \
   VELXOR_STUB='$STUB_MODE' python waitress_conf.py \
     2>&1 | tee '$LOG_DIR/engine.log'"

# ③ Electron UI (우상) — 메인 페인의 오른쪽으로 split-window
tmux select-pane -t "$SESSION:0.0"
tmux split-window -t "$SESSION:0.0" -h \
  "echo '── ③ Electron UI (vite :5173) ──'; \
   sleep 6; \
   cd ui && npm run dev \
     2>&1 | tee '$LOG_DIR/ui.log'"

# ④ Trigger shell (우하) — UI 페인 아래로 split-window
tmux select-pane -t "$SESSION:0.2"
tmux split-window -t "$SESSION:0.2" -v \
  "echo '── ④ Trigger shell — 준비 완료 후 [Enter] ──'; \
   echo ''; \
   echo '  ▶  scripts/demo-trigger.sh        (인터랙티브)'; \
   echo '  ▶  scripts/demo-trigger.sh --now  (즉시 burst)'; \
   echo ''; \
   cd '$ROOT'; \
   exec bash"

# 4-pane equal layout (2x2)
tmux select-layout -t "$SESSION:0" tiled
tmux select-pane  -t "$SESSION:0.3"

echo ""
echo "[start] 세션 준비 완료. 헬스체크 대기 중..."

# 서비스 ready 대기
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then
    echo "[start] ✓ Python engine :8765 ready"
    break
  fi
  sleep 1
done

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:7001/health >/dev/null 2>&1 || \
     ss -tln 2>/dev/null | grep -q ':7001 '; then
    echo "[start] ✓ Rust REST :7001 ready"
    break
  fi
  sleep 1
done

for i in $(seq 1 60); do
  if ss -tln 2>/dev/null | grep -q ':5173 '; then
    echo "[start] ✓ UI :5173 ready"
    break
  fi
  sleep 1
done

echo ""
echo "  ▶ 세션 attach:  tmux attach -t $SESSION"
echo "  ▶ 트리거:       scripts/demo-trigger.sh --now"
echo "  ▶ 종료:         scripts/demo-stop.sh"
echo ""
