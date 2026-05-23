#!/usr/bin/env bash
# 무대 burst 트리거 — 1초 안에 FileWrite/Rename 80회 이상 발생시켜
# aggregator 의 burst gate(FileWrite ≥ 50/s 또는 FileRename ≥ 30/s) 를 넘김.
#
# 사용법:
#   scripts/demo-trigger.sh           # 인터랙티브 (read prompt 후 시작)
#   scripts/demo-trigger.sh --now     # 무대 자동화용 (즉시 시작)
#
# 동작:
#   1. ~/velxor-work/demo/victim/ 에 doc_001..doc_100.txt 100개 파일을 만들고
#   2. 무대 신호 (--now 또는 Enter) 직후 0.5s 안에 80개 파일을 동시에
#      .locked 로 rename + 원본 rm → FileRename + FileWrite + FileDelete burst.
#   3. 끝나면 30초 대기 후 자동 cleanup (UI 캡처 시간 확보).
set -uo pipefail

VICTIM="$HOME/velxor-work/demo/victim"
N_PREP=100
N_BURST=80

if [[ "${1:-}" == "--now" ]]; then
  AUTO=1
else
  AUTO=0
fi

mkdir -p "$VICTIM"
cd "$VICTIM"

# 1) 피해자 파일 사전 배치 (정상 상태)
echo "[trigger] 정상 파일 $N_PREP 개 배치 중..."
rm -f doc_*.txt doc_*.txt.locked 2>/dev/null || true
for i in $(seq -f "%03g" 1 "$N_PREP"); do
  printf 'important data %s\n' "$i" > "doc_${i}.txt"
done
echo "[trigger] ready — victim/ 에 $N_PREP 파일 배치 완료"

# 2) 신호 대기
if [[ "$AUTO" -eq 0 ]]; then
  echo ""
  echo "  ── 무대에서 Enter 누르면 burst 시작 ──"
  read -r
fi

START_MS=$(date +%s%3N)
echo "[trigger] BURST START $START_MS"

# 3) burst: 80개 파일을 동시에 .locked 로 rename + 원본 삭제
#   - mv → FileRename × 80 (gate 30/s 초과)
#   - 새 .locked 파일 write → FileWrite × 80 (gate 50/s 초과)
#   - 원본 rm → FileDelete × 80
for i in $(seq -f "%03g" 1 "$N_BURST"); do
  (
    echo "ENCRYPTED_$(date +%N)_$RANDOM" > "doc_${i}.txt.locked"
    rm -f "doc_${i}.txt"
  ) &
done
wait

END_MS=$(date +%s%3N)
DUR=$((END_MS - START_MS))
echo "[trigger] BURST END   $END_MS  (소요 ${DUR}ms, $N_BURST 파일)"
echo "[trigger] → UI 에서 alert 배너 + 타임라인 빨간 점 + Block 버튼 확인"

# 4) UI 캡처/Block 시간 확보 (30s) — Ctrl+C 로 즉시 cleanup 가능
echo ""
echo "  ── 30초 후 cleanup. Ctrl+C 로 즉시 종료 가능 ──"
sleep 30 || true

# 5) cleanup
echo "[trigger] cleanup..."
rm -f "$VICTIM"/doc_*.txt "$VICTIM"/doc_*.txt.locked 2>/dev/null || true
echo "[trigger] done."
