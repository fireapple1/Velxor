#!/usr/bin/env bash
# AC3 발표 영상 자동 녹화 — SSH/headless 환경 전용
# 사용법: scripts/record-demo.sh [output.mp4]
set -uo pipefail

# ── 출력 경로 ──────────────────────────────────────────────────
REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
OUT="${1:-$REPO_ROOT/docs/demo/ac3-demo.mp4}"
mkdir -p "$(dirname "$OUT")"

# ── PID 추적 (cleanup용) ────────────────────────────────────────
XVFB_PID=""
ELECTRON_PGID=""
FFMPEG_PID=""

# ── cleanup trap ───────────────────────────────────────────────
cleanup() {
  if [[ -n "${FFMPEG_PID:-}" ]] && kill -0 "$FFMPEG_PID" 2>/dev/null; then
    kill -TERM "$FFMPEG_PID" 2>/dev/null || true
  fi
  if [[ -n "${ELECTRON_PGID:-}" ]]; then
    kill -TERM -- -"$ELECTRON_PGID" 2>/dev/null || true
  fi
  if [[ -n "${XVFB_PID:-}" ]] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
  fi
  sleep 0.3
  if [[ -n "${FFMPEG_PID:-}" ]] && kill -0 "$FFMPEG_PID" 2>/dev/null; then
    kill -KILL "$FFMPEG_PID" 2>/dev/null || true
  fi
  if [[ -n "${ELECTRON_PGID:-}" ]]; then
    kill -KILL -- -"$ELECTRON_PGID" 2>/dev/null || true
  fi
  if [[ -n "${XVFB_PID:-}" ]] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill -KILL "$XVFB_PID" 2>/dev/null || true
  fi
  rm -f "$HOME/velxor-work/dst/ransom_"*.enc
}
trap cleanup EXIT INT TERM

# ── 1. 사전조건 체크 ───────────────────────────────────────────
echo "[1/6] 사전조건 확인 중..."

if ! curl -sf http://127.0.0.1:5173 >/dev/null 2>&1; then
  echo "ERROR: Vite dev 서버(5173)가 응답하지 않습니다." >&2
  echo "       다른 터미널에서 'scripts/run-all.sh'를 먼저 실행하세요." >&2
  exit 1
fi
echo "  ✓ Vite dev (5173) 가동 확인"

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "ERROR: Xvfb 바이너리를 찾을 수 없습니다." >&2
  echo "       sudo apt install -y xvfb xdotool x11-utils" >&2
  exit 1
fi
echo "  ✓ Xvfb 바이너리 확인"

if ! command -v xdpyinfo >/dev/null 2>&1; then
  echo "ERROR: xdpyinfo 바이너리를 찾을 수 없습니다." >&2
  echo "       sudo apt install -y xvfb xdotool x11-utils" >&2
  exit 1
fi
echo "  ✓ xdpyinfo 바이너리 확인"

if ! command -v xdotool >/dev/null 2>&1; then
  echo "ERROR: xdotool 바이너리를 찾을 수 없습니다." >&2
  echo "       sudo apt install -y xvfb xdotool x11-utils" >&2
  exit 1
fi
echo "  ✓ xdotool 바이너리 확인"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: ffmpeg 바이너리를 찾을 수 없습니다." >&2
  echo "       sudo apt install -y ffmpeg" >&2
  exit 1
fi
echo "  ✓ ffmpeg 바이너리 확인"

# ── 루트 경로 계산 ─────────────────────────────────────────────
UI_DIR="$REPO_ROOT/ui"

# ── 2. Electron main 컴파일 (캐싱) ────────────────────────────
echo "[2/6] Electron main 컴파일 확인 중..."

MAIN_JS="$UI_DIR/dist-electron/main.js"
if [[ ! -f "$MAIN_JS" ]]; then
  echo "  → dist-electron/main.js 없음, 컴파일 시작..."
  if ! ( cd "$UI_DIR" && npx tsc --ignoreConfig --ignoreDeprecations 6.0 \
          --target es2022 --module commonjs --moduleResolution node \
          --esModuleInterop --skipLibCheck \
          --outDir dist-electron electron/main.ts ); then
    echo "[record] ERROR: Electron main.ts 컴파일 실패" >&2
    exit 1
  fi
  echo "  ✓ 컴파일 완료"
else
  echo "  ✓ 이미 컴파일된 main.js 존재, 스킵"
fi

# ESM 해석 방지 — dist-electron/package.json에 commonjs 명시
PKG_JSON="$UI_DIR/dist-electron/package.json"
if [[ ! -f "$PKG_JSON" ]]; then
  echo '{"type":"commonjs"}' > "$PKG_JSON"
  echo "  ✓ dist-electron/package.json (commonjs) 작성"
else
  echo "  ✓ dist-electron/package.json 이미 존재, 스킵"
fi

# ── 3. Xvfb 기동 ──────────────────────────────────────────────
echo "[3/6] Xvfb :99 기동 중..."
Xvfb :99 -screen 0 1280x800x24 -ac -nolisten tcp &
XVFB_PID=$!
if ! timeout 5 bash -c 'until DISPLAY=:99 xdpyinfo >/dev/null 2>&1; do sleep 0.1; done'; then
  echo "[record] ERROR: Xvfb 기동 실패" >&2
  exit 1
fi
echo "  ✓ Xvfb :99 기동 완료 (PID=$XVFB_PID)"

# ── 4. Electron 기동 ──────────────────────────────────────────
echo "[4/6] Electron 기동 중..."
setsid bash -c "cd '$UI_DIR' && DISPLAY=:99 npx electron dist-electron/main.js --no-sandbox" >/dev/null 2>&1 &
ELECTRON_PGID=$!
echo "[record] Electron 창 표시 대기..."
if ! DISPLAY=:99 timeout 10 bash -c 'until xdotool search --name "." >/dev/null 2>&1; do sleep 0.3; done'; then
  echo "[record] ERROR: Electron 창 표시 실패 (10s timeout). vite dev 5173 응답 확인." >&2
  exit 1
fi
echo "  ✓ Electron 기동 (PGID=$ELECTRON_PGID), 창 표시 확인 완료"

# ── 5. ffmpeg 녹화 시작 (30초) ────────────────────────────────
echo "[5/6] ffmpeg 녹화 시작 (30초)..."
ffmpeg -y -loglevel error \
  -f x11grab -framerate 30 -video_size 1280x800 -i :99.0 \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -t 30 "$OUT" &
FFMPEG_PID=$!
echo "  ✓ ffmpeg 녹화 중 (PID=$FFMPEG_PID)"

# ── 6. burst 트리거 (5초 후) ──────────────────────────────────
echo "[6/6] 5초 후 burst 트리거 예정..."
sleep 5
echo "  → burst 200 files (단일 PID, python urandom)..."
mkdir -p "$HOME/velxor-work/dst"
# 핵심: aggregator.PidWindow가 PID별 분리이므로 동일 PID가 50+ files/1s 만들어야 burst 트리거.
# dd 100개 spawn은 100 PIDs × 1 file → fail. python 한 프로세스가 200 files 작성.
python3 -c "
import os, time
home = os.environ['HOME']
dst = f'{home}/velxor-work/dst'
os.makedirs(dst, exist_ok=True)
t0 = time.time()
for i in range(200):
    with open(f'{dst}/ransom_{i}.enc', 'wb') as f:
        f.write(os.urandom(4096))
print(f'  ✓ 200 files in {time.time()-t0:.2f}s (single PID burst)')
"
echo "  ✓ burst 트리거 완료 (fanotify → /classify → verdict 기대)"

# ── ffmpeg 완료 대기 ──────────────────────────────────────────
echo "ffmpeg 녹화 완료 대기 중..."
if ! wait "$FFMPEG_PID"; then
  echo "WARNING: ffmpeg 비정상 종료" >&2
fi
FFMPEG_PID=""

# ── 결과 출력 ─────────────────────────────────────────────────
echo ""
echo "녹화 완료:"
ls -lh "$OUT"
