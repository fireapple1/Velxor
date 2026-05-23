#!/usr/bin/env bash
# 무대 오케스트레이터 — 한 명령으로 시연 전체 사이클 실행.
#
# 사용법:
#   scripts/demo.sh check     # preflight 만
#   scripts/demo.sh start     # 4-pane tmux 기동 (preflight 포함)
#   scripts/demo.sh trigger   # burst trigger (--now)
#   scripts/demo.sh stop      # 종료
#   scripts/demo.sh slides    # standalone.html 브라우저 오픈
#   scripts/demo.sh backup    # 백업 영상 재생 (Plan B)
#   scripts/demo.sh           # 인터랙티브 메뉴
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

action="${1:-menu}"

case "$action" in
  check)
    exec bash scripts/demo-preflight.sh
    ;;
  start)
    bash scripts/demo-preflight.sh || exit 1
    exec bash scripts/demo-start.sh
    ;;
  trigger)
    exec bash scripts/demo-trigger.sh --now
    ;;
  stop)
    exec bash scripts/demo-stop.sh
    ;;
  slides)
    SLIDE="$ROOT/docs/presentation/standalone.html"
    if [ ! -f "$SLIDE" ]; then
      echo "ERROR: $SLIDE 없음" >&2
      exit 1
    fi
    xdg-open "$SLIDE" 2>/dev/null &
    echo "[demo] 슬라이드 열림"
    ;;
  backup)
    VID="$ROOT/docs/demo/ac3-demo.mp4"
    if [ ! -f "$VID" ]; then
      echo "ERROR: 백업 영상 없음 — scripts/record-demo.sh 실행" >&2
      exit 1
    fi
    xdg-open "$VID" 2>/dev/null &
    echo "[demo] Plan B — 백업 영상 재생 중"
    ;;
  menu)
    cat <<'MENU'

  ╔══════════════════════════════════════════╗
  ║       Velxor Demo Orchestrator           ║
  ╠══════════════════════════════════════════╣
  ║  1)  check    — 사전 점검 (D-day 30분 전) ║
  ║  2)  start    — 4-pane tmux 서비스 기동   ║
  ║  3)  trigger  — burst trigger (--now)    ║
  ║  4)  stop     — 모두 종료                 ║
  ║  5)  slides   — 발표 슬라이드 열기        ║
  ║  6)  backup   — Plan B 백업 영상 재생     ║
  ║  q)  quit                                ║
  ╚══════════════════════════════════════════╝

MENU
    read -r -p "  선택: " choice
    case "$choice" in
      1|check)   exec bash "$0" check ;;
      2|start)   exec bash "$0" start ;;
      3|trigger) exec bash "$0" trigger ;;
      4|stop)    exec bash "$0" stop ;;
      5|slides)  exec bash "$0" slides ;;
      6|backup)  exec bash "$0" backup ;;
      q|quit)    exit 0 ;;
      *)         echo "unknown: $choice"; exit 1 ;;
    esac
    ;;
  *)
    echo "usage: $0 [check|start|trigger|stop|slides|backup]" >&2
    exit 1
    ;;
esac
