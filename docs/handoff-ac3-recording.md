# Worker C 인계: AC3 데모 영상 작업

**날짜**: 2026-05-23 09:30~10:00 KST
**작성자**: Worker A 세션
**목적**: SSH/headless 환경에서 AC3 발표 영상(fanotify → ransomware 판정 → 자동 차단) 자동 녹화

## 작업 결과
**완료** — `docs/demo/ac3-demo.mp4` 확보 (130KB, 30초, 1280×800 H.264)

## 변경된 파일

| 파일 | 변경 | 사유 |
|---|---|---|
| `scripts/record-demo.sh` | **신규** (~160줄) | Xvfb + Electron + ffmpeg 자동 녹화 |
| `scripts/run-all.sh` | release binary 우선 분기 추가 (라인 58~) | cargo run 재빌드 시 setcap 손실 회피 |
| `ui/dist-electron/main.js` | 신규 (컴파일 산출물) | Electron entry, ts 컴파일 후 commonjs |
| `ui/dist-electron/package.json` | 신규 (`{"type":"commonjs"}`) | `ui/package.json`의 `"type":"module"` 충돌 회피 |

git 변경 없는 환경 설정:
- `rust-service/target/release/rust-service`에 `cap_sys_admin,cap_dac_read_search=ep` setcap 적용 (sudo 없이 fanotify mount mark 가능)
- 신규 패키지: `xvfb`, `xdotool` (apt 설치됨)

## 산출물

| 경로 | 내용 |
|---|---|
| `docs/demo/ac3-demo.mp4` | 30초 1280×800 H.264 발표 영상 (130KB) |
| `docs/demo/frames/f_*.png` | 시점별 8 프레임 (1s/5s/6s/7s/8s/15s/25s/28s) |
| `f_4.png` 특히 | AC3 evidence — burst 직후 `[warn] auto_block_ransomwa...` 배너 + 타임라인 빨간 마커 |

## 영상 내용 검증 결과
- VELXOR 헤더 + `connected` WS 상태
- 시스템 daemon 노드 5개 정상 표시
- burst 직후 **우측 상단 alert 배너** (`auto_block_ransomware`)
- 타임라인에 차단 시점 **빨간 점**
- "노드 자체가 빨간색으로 변하는" 시각화는 영상에 명확하지 않음 (burst 프로세스가 SIGTERM으로 즉시 사라져서 노드 색 전환 프레임 짧음). alert 배너 + 타임라인 마커로 차단을 표현.

## 진단 사실 (검수 시 참고)

1. **AUTOBLOCK 전체 파이프라인 작동 확인** — rust-service trace.json 라인 직접 확인:
   - `classify_start` (pid=487627, n_arrived=52) → `classify_done` (latency 1ms) → `block_pid` SIGTERM → `auto_block_ransomware` alert broadcast
2. **ws-record(websocat)는 high-throughput WS 수신에 부적합** — fanotify burst 800+ events/0.05s 폭주 시 backpressure로 verdict/alert 메시지 lost. Electron UI는 React 처리 속도로 정상 수신.
3. **lr 모델(prod)은 4KB urandom 200개를 benign으로 판정** (lr_proba=0.23 < 0.5). 영상은 `VELXOR_STUB=engine` 모드(ransomware 0.95 하드코드)로 시연.

## 운영 주의

- **run-all.sh 실행 시 sudo 불필요** (setcap 덕분). PATH 문제 없이:
  ```
  cd /home/lsy/htA/Velxor && VELXOR_STUB=engine VELXOR_AUTOBLOCK=1 scripts/run-all.sh
  ```
- **`cargo build`가 binary를 재빌드하면 setcap 사라짐** → 다시 적용 필요:
  ```
  sudo setcap cap_sys_admin,cap_dac_read_search+ep rust-service/target/release/rust-service
  ```
- **record-demo.sh 사전조건**: `xvfb`, `xdotool`, `x11-utils`, `ffmpeg` 설치 + 별도 터미널에서 run-all.sh 가동 중
- vite의 `.vite` cache가 권한 꼬이면 `rm -rf ui/node_modules/.vite` 후 vite 재시작
- Electron 호출은 `npx electron` 대신 `./node_modules/.bin/electron` 직접 사용 (setsid 환경에서 npx가 stuck됨)

## 검수 권장 사항

1. **AC3 evidence**: `docs/demo/frames/f_4.png`가 1초 내 차단 표시 요구사항 충족하는지 (burst 5초 → 6초 시점에 alert + 타임라인 마커)
2. **stub disclaimer**: 발표 슬라이드/스크립트에 "engine은 stub-v1 모드, Rust+fanotify는 실제 작동" 명시 권장
3. **AC1**: 영상은 30초만 — AC1 sustained 5분 ws-replay 검증은 별도로 (기존 ac7-sustained.sh PASS 기반)
4. **선택**: lr 모델에 urandom 패턴 학습 추가하면 stub 없이도 정직한 데모 가능 (단 시간 비용)

## 남은 후속 작업 (Week 8-9 발표 준비, Week 10 제외)

- [ ] `docs/demo/AC3-evidence/frame-1000ms.png` 정식 명명 (현재 `f_4.png`)
- [ ] `DEMO-SCRIPT.md`의 30초 시나리오와 영상 정합성 확인
- [ ] `REHEARSAL-LOG.md` 3회 리허설 기록
- [ ] G10 gate pytest 환경 (python-engine/.venv에 pytest 미설치)
- [ ] (선택) AC7 release 모드 1시간 sustained 추가 검증

## 인계 시점 상태
- 사용자 별도 터미널에 run-all.sh 가동 중 (engine + rust + vite)
- 본 세션의 record-demo.sh 마지막 실행으로 영상 갱신 완료 (09:57)
- git 상태: `scripts/record-demo.sh` 신규 + `scripts/run-all.sh` 수정 untracked (사용자가 커밋 여부 결정)
