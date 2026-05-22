#!/usr/bin/env bash
# Velxor 성공 기준 — UI 제외, A/B/C 통합 13 게이트.
# 모든 게이트 PASS 시 exit 0 → ralph 완료.
#
# 사용:
#   bash scripts/verify-success.sh
#   AC7_DURATION=300 bash scripts/verify-success.sh    # AC7 5분 dev 모드 (기본)
#   AC7_DURATION=3600 bash scripts/verify-success.sh   # AC7 1시간 release 모드
#
# 각 게이트 실패는 fail 배열에 누적 (early-exit X) — ralph 가 baseline + delta
# 둘 다 보기 위해.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 기본 dev 모드 — ralph iter 내부 AC7 5분 검증
export AC7_DURATION="${AC7_DURATION:-300}"

fail=()
pass=()
gate() {
  local name="$1"; shift
  echo "[gate] $name"
  if "$@" > /tmp/gate-out.log 2>&1; then
    pass+=("$name")
    echo "  → PASS"
  else
    fail+=("$name (exit $?)")
    echo "  → FAIL"
    sed 's/^/    /' /tmp/gate-out.log | tail -10
  fi
  echo
}

gate G1_walking_skeleton_tag \
  bash -c '[ "$(git tag -l walking-skeleton-v1 | wc -l)" = "1" ]'

gate G2_ac2_poc_bench \
  bash scripts/poc-bench.sh

# G3: 가장 최근 rehearsal trace 또는 multi-PID trace 중 존재하는 것 사용
G3_TRACE=""
for cand in rust-service/logs/multi-pid-trace.json \
            "$HOME"/velxor-work/rehearsal-*/iter-*/rust.log; do
  for f in $cand; do
    [ -s "$f" ] && G3_TRACE="$f" && break 2
  done
done
if [ -n "$G3_TRACE" ]; then
  gate "G3_ac4_classify_p99(${G3_TRACE##*/})" \
    bash scripts/eval-ac4.sh "$G3_TRACE"
else
  fail+=("G3_ac4_classify_p99 (no trace found)")
  echo "[gate] G3_ac4_classify_p99 → FAIL (no trace)"
fi

# G4: AC4 표본 충분성 (multi-PID trace 의 classify_done count >= 10)
if [ -s rust-service/logs/multi-pid-trace.json ]; then
  N=$(grep -c '"classify_done"' rust-service/logs/multi-pid-trace.json || echo 0)
  gate "G4_ac4_sample_n>=10($N)" \
    bash -c "[ $N -ge 10 ]"
else
  fail+=("G4_ac4_sample (multi-pid-trace.json 없음)")
  echo "[gate] G4_ac4_sample → FAIL"
fi

gate G5_ac5_accuracy \
  bash scripts/eval-ac5.sh

gate G6_ac5c_disclaimer \
  grep -q "synthetic PoC" docs/AC5-results.md

gate G7_ac6_block \
  bash -c 'command -v bash >/dev/null && VELXOR_RUST_AUTOSTART=1 bash scripts/ac6-verify-block.sh'

gate "G8_ac7_sustained(${AC7_DURATION}s)" \
  bash scripts/ac7-sustained.sh

gate G9_ac8_stub_smoke \
  bash scripts/ac8-stub-smoke.sh

gate G10_pytest \
  bash -c 'cd python-engine && .venv/bin/python -m pytest tests/ -q'

gate G11_cargo_clippy \
  bash -c 'cd rust-service && cargo clippy --release --quiet -- -D warnings 2>&1'

gate G12_schema_drift \
  bash scripts/check-schema-drift.sh

gate G13_repo_hygiene \
  bash -c '[ -z "$(git status --porcelain)" ] && [ -z "$(git rev-list origin/main..main 2>/dev/null)" ]'

echo "============================================================"
echo "[verify-success] PASS: ${#pass[@]} / $((${#pass[@]} + ${#fail[@]}))"
if [ ${#fail[@]} -eq 0 ]; then
  echo "[verify-success] ALL GATES PASS"
  exit 0
fi
printf "[verify-success] FAIL gates:\n"
printf "  - %s\n" "${fail[@]}"
exit 1
