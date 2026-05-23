# Velxor 시연 치트시트 (한 장 인쇄용)

발표 무대에서 책상에 두고 보는 한 페이지 가이드.

---

## 0. 한 줄 요약

```
scripts/demo.sh           # 인터랙티브 메뉴 (이거 하나만 외우면 됨)
```

---

## 1. D-1 (전날 밤)

```bash
cd ~/htA/Velxor
cargo build --release --manifest-path rust-service/Cargo.toml
(cd ui && npm run build)
scripts/demo-preflight.sh        # 12개 항목 모두 PASS 인지 확인
```

---

## 2. D-Day · 발표 30분 전

```bash
scripts/demo.sh check            # PASS 받으면 무대 진입 OK
sudo -v                          # sudo 캐시 갱신
```

WiFi 비행기모드 ON (외부 트래픽 차단), 폰트는 이미 캐시됨.

---

## 3. 무대 사이클 (90초 안)

| 순서 | 명령 / 동작 | 멘트 (1줄) |
|---|---|---|
| 1 | `scripts/demo.sh start` (사전 백그라운드) | (대기 중) |
| 2 | `tmux attach -t velxor-demo` 화면 띄움 | "지금부터 30초 데모" |
| 3 | UI(우상 ③) 페인에서 vite 화면 확인 | "정상 상태" |
| 4 | 트리거(우하 ④) 페인에서 `scripts/demo.sh trigger` | "랜섬웨어 행위 모사" |
| 5 | UI 에 alert 배너 + 빨간 점 (1~2초 내) | "burst 감지 · confidence 0.95" |
| 6 | UI 의 **Block 버튼** 클릭 | "PID 에 SIGTERM 전송" |
| 7 | outcome `terminated_sigterm` 표시 | "200ms 안에 차단 완료" |
| 8 | Rust 페인(좌상 ①) 로그에 `block_outcome=...` 확인 | "burst → alert → block, 1초 closed loop" |
| 9 | 슬라이드 8 로 복귀 | (다음 슬라이드) |

---

## 4. 4-pane 레이아웃

```
┌───────────────────────┬───────────────────────┐
│ ① Rust (sudo)         │ ③ Electron UI         │
│ rust.log              │ vite :5173            │
├───────────────────────┼───────────────────────┤
│ ② Python engine       │ ④ Trigger shell       │
│ :8765                 │ scripts/demo.sh ...   │
└───────────────────────┴───────────────────────┘
```

- 청중 시선: 메인은 ③ UI, 보조는 ① Rust 로그
- ② Python 은 가끔 흘끗 (classify 200 로그)
- ④ 는 발표자만 봄

---

## 5. Plan B — 무엇이든 망가지면

```bash
scripts/demo.sh backup           # docs/demo/ac3-demo.mp4 재생
```

멘트: "라이브 시연 환경 이슈로 녹화본으로 대체합니다. STUB=engine 모드는 동일합니다."

---

## 6. 종료

```bash
scripts/demo.sh stop             # 모든 프로세스 + 포트 + sandbox 정리
```

---

## 7. 청중 질문 30초 답

| Q | A |
|---|---|
| real-world ransomware? | 합성 PoC 기준, Future Work 에 VirusTotal corpus 포함 |
| 분류 결과 늘 0.95? | 발표 안전을 위해 engine 만 STUB, full 모드는 LR predict_proba |
| fanotify root? | 예, mount-level 이벤트는 root 필수 — 데모도 sudo |
| SIGTERM 200ms 근거? | graceful shutdown 후 fallback, 200ms 는 dev 측정 기반 |

---

## 8. 비상 키 (한 손가락)

| 상황 | 단축키 |
|---|---|
| 발표 슬라이드 다음 | `→` 또는 `Space` |
| 발표 슬라이드 이전 | `←` |
| 발표 화면 블랙아웃 | `B` |
| tmux pane 이동 | `Ctrl+b → ↑↓←→` |
| tmux pane zoom | `Ctrl+b → z` |
| 백업 영상 즉시 재생 | `Ctrl+Alt+T` → `scripts/demo.sh backup` |

---

## 9. 5분 리허설 체크 (D-1 3회)

- [ ] trigger → alert 까지 1초 이내인가
- [ ] Block outcome 표시되는가
- [ ] outcome `already_gone` 한 번이라도 봤는가
- [ ] WS 끊겼을 때 UI 가 청중 보기에 이상하지 않은가
- [ ] 백업 영상 책상에서 1초 안에 재생 가능한가
