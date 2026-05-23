#!/usr/bin/env bash
# 무대 burst 트리거 — record-demo.sh 와 동일한 방식.
#
# 핵심: aggregator.PidWindow 는 PID별 분리이므로,
#       **동일 PID 가 50+ files/1s 작성** 해야 burst gate 발동.
#       bash for-loop 의 `(...) &` 는 매 iter 마다 새 PID → fail.
#       → python 단일 PID 가 200 files 동시 작성 = 유일하게 동작하는 패턴.
#
# 사용법:
#   scripts/demo-trigger.sh           # 인터랙티브 (Enter 후 시작)
#   scripts/demo-trigger.sh --now     # 무대 자동화용 (즉시 시작)
set -uo pipefail

DST="$HOME/velxor-work/dst"
N_BURST=200

if [[ "${1:-}" == "--now" ]]; then
  AUTO=1
else
  AUTO=0
fi

mkdir -p "$DST"

# 1) 이전 잔존 파일 정리
rm -f "$DST"/ransom_*.enc 2>/dev/null || true

# 2) 신호 대기
if [[ "$AUTO" -eq 0 ]]; then
  echo ""
  echo "  ── 무대에서 Enter 누르면 burst 시작 ──"
  read -r
fi

START_MS=$(date +%s%3N)
echo "[trigger] BURST START $START_MS — $N_BURST files (단일 PID, urandom)"

# 3) 단일 PID burst — record-demo.sh 와 동일한 방식
python3 -c "
import os, time, sys
home = os.environ['HOME']
dst  = f'{home}/velxor-work/dst'
os.makedirs(dst, exist_ok=True)
n = $N_BURST
t0 = time.time()
for i in range(n):
    with open(f'{dst}/ransom_{i}.enc', 'wb') as f:
        f.write(os.urandom(4096))
dur = time.time() - t0
print(f'[trigger]   ✓ {n} files in {dur:.2f}s (rate {n/dur:.0f}/s)')
sys.stdout.flush()
"

END_MS=$(date +%s%3N)
DUR=$((END_MS - START_MS))
echo "[trigger] BURST END   $END_MS  (소요 ${DUR}ms)"
echo "[trigger] → UI 에서 alert 배너 + 타임라인 빨간 점 + Block 버튼 확인"

# 4) UI 캡처/Block 시간 확보 (30s) — Ctrl+C 로 즉시 cleanup 가능
echo ""
echo "  ── 30초 후 cleanup. Ctrl+C 로 즉시 종료 가능 ──"
sleep 30 || true

# 5) cleanup
echo "[trigger] cleanup..."
rm -f "$DST"/ransom_*.enc 2>/dev/null || true
echo "[trigger] done."
