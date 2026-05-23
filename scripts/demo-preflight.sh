#!/usr/bin/env bash
# 발표 30분 전 사전 점검 — 무대에서 발생할 수 있는 모든 장애 사전 차단.
# 사용법: scripts/demo-preflight.sh
# 실패 항목이 하나라도 있으면 비-zero exit. green 이면 무대에 올라도 됨.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0
pass()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
step()  { printf '\n\033[1m[%s]\033[0m\n' "$*"; }

step "1) 작업 디렉터리"
WORK="$HOME/velxor-work"
mkdir -p "$WORK/dst" "$WORK/src"
[ -d "$WORK" ] && pass "$WORK 존재 (dst/, src/)"

step "2) 포트 점유 (7000 / 7001 / 8765 / 5173)"
for port in 7000 7001 8765 5173; do
  if ss -tlnp 2>/dev/null | grep -q ":$port "; then
    fail "포트 $port 점유 중 — pkill 후 재시도"
  else
    pass "포트 $port free"
  fi
done

step "3) Rust release 바이너리"
if [ -x rust-service/target/release/rust-service ]; then
  pass "release 바이너리 존재"
else
  warn "release 미빌드 — cargo build --release 자동 실행"
  (cd rust-service && cargo build --release 2>&1 | tail -5)
  [ -x rust-service/target/release/rust-service ] && pass "빌드 완료" || fail "빌드 실패"
fi

step "4) Python venv + 의존성"
if [ -d python-engine/.venv ]; then
  if python-engine/.venv/bin/python -c 'import flask,waitress,sklearn' 2>/dev/null; then
    pass "venv + flask/waitress/sklearn OK"
  else
    fail "venv 의존성 누락 — scripts/setup-venv.sh 재실행"
  fi
else
  fail "venv 없음 — scripts/setup-venv.sh 실행 필요"
fi

step "5) UI node_modules"
if [ -d ui/node_modules ]; then
  pass "ui/node_modules 존재"
else
  warn "node_modules 없음 — npm install 자동 실행"
  (cd ui && npm install 2>&1 | tail -3)
fi

step "6) sudo (USE_SUDO=1 일 때만 필수)"
if sudo -n true 2>/dev/null; then
  pass "sudo 캐시 유효 (USE_SUDO=1 모드 대비)"
else
  warn "sudo 캐시 만료 — USE_SUDO=1 쓸 거면 'sudo -v' 실행"
fi

step "7) Rust 바이너리 capabilities (setcap)"
BIN="rust-service/target/release/rust-service"
if command -v getcap >/dev/null 2>&1; then
  CAPS=$(getcap "$BIN" 2>/dev/null || true)
  if echo "$CAPS" | grep -q 'cap_sys_admin\|cap_dac'; then
    pass "setcap 적용됨 — sudo 없이 fanotify 동작 ($CAPS)"
  else
    warn "setcap 미적용 — USE_SUDO=1 로 실행하거나 setcap 추가 필요"
    echo "         sudo setcap 'cap_sys_admin,cap_dac_read_search+ep' $BIN"
  fi
else
  warn "getcap 미설치 — 'sudo apt install -y libcap2-bin'"
fi

step "8) tmux"
if command -v tmux >/dev/null; then
  pass "tmux $(tmux -V | awk '{print $2}')"
else
  fail "tmux 미설치 — sudo apt install -y tmux"
fi

step "9) 백업 영상"
BACKUP_VIDEO="$ROOT/docs/demo/ac3-demo.mp4"
if [ -f "$BACKUP_VIDEO" ]; then
  size=$(stat -c%s "$BACKUP_VIDEO" 2>/dev/null || echo 0)
  if [ "$size" -gt 10000 ]; then
    pass "백업 영상 OK ($((size/1024)) KB)"
  else
    fail "백업 영상 크기 비정상 ($size byte)"
  fi
else
  fail "백업 영상 없음 — scripts/record-demo.sh 실행"
fi

step "10) 시연용 트리거 스크립트"
if [ -x scripts/demo-trigger.sh ]; then
  pass "demo-trigger.sh 실행 가능"
else
  fail "demo-trigger.sh 실행 권한 없음 — chmod +x"
fi

step "11) 발표 슬라이드 standalone.html"
SLIDE="$ROOT/docs/presentation/standalone.html"
if [ -f "$SLIDE" ]; then
  size=$(stat -c%s "$SLIDE")
  pass "standalone.html OK ($((size/1024)) KB)"
else
  warn "standalone.html 없음 (선택 — index.html 로 발표 시 무시)"
fi

step "12) 디스크 여유"
avail=$(df --output=avail -BG "$WORK" 2>/dev/null | tail -1 | tr -d 'G ')
if [ "${avail:-0}" -ge 1 ]; then
  pass "$WORK 여유 ${avail} GB"
else
  warn "디스크 여유 ${avail}GB — 1GB 이상 권장"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32m=== PREFLIGHT PASS — 무대 준비 완료 ===\033[0m\n'
  exit 0
else
  printf '\033[1;31m=== PREFLIGHT FAIL — %d 항목 수정 필요 ===\033[0m\n' "$FAIL"
  exit 1
fi
