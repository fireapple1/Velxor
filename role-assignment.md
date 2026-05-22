# Velxor 팀 Zeraxis — 역할 분담 (공동 작업자 3인, 2026-05-22 재분배)

## Metadata
- **기술 명세 출처 (Source of truth)**: [`velxor-consensus-plan.md`](./velxor-consensus-plan.md) (참고: `.omc/`는 session-local, `.gitignore` 처리됨)
- **형식 참고**: [`velxor_planning_doc.html`](./velxor_planning_doc.html) (3인 카드 + 4계층 layer-card 레이아웃만)
- **Generated**: 2026-05-20
- **Revised**: 2026-05-22 — 사용자 지시 "Rust 전부 A / B는 UI만 / C 필요시 변경"에 따라 재분배. CCG(Codex+Gemini) 검토 합성 반영.
- **Mode**: 3인 공동 작업자, A=Rust 단일 소유(critical path) 모델 (각 ~32~58h, 합계 ~135-140h, deferral 트리거 >145h)

---

## 한 줄 요약
Ubuntu 24.04 **사용자공간** **랜섬웨어 행위 탐지** 데모급 백신. 4계층(Rust+libfanotify 수집기 / Rust 통합 서비스 / Python 분석 엔진 / React+Electron UI)을 합성 PoC로 시연하며, ≤1초 안에 wow 모먼트(빨간 노드 + verdict panel)를 달성한다.

> **2026-05-21 마이그레이션**: 원안의 layer ① "C+WDK 미니필터 드라이버"가 **Rust + libfanotify userspace collector**로 대체. kernel module 없음, BSOD/test-signing 의존성 제거.
> **2026-05-22 재분배**: 종전 "A=collector, B=Rust integration+UI, C=Python" → **"A=모든 Rust(collector+service+integration+tracing), B=UI 풀스택+발표 퀄리티, C=Python+orchestration glue"**.

---

## 4계층 아키텍처 & 데이터 흐름 (Ubuntu)

```
① 사용자공간 수집기 (Rust + libfanotify, root)          ─┐
       ↓ Collector→Service (BehaviorEventV1 JSONL on    │ A
         UNIX socket 또는 stdout pipe)                   │ 전부
② 사용자공간 통합 서비스 (Rust)                          │ 소유
       ↓ REST POST /classify ───────────────────────────┘
③ 분석 엔진 (Python + Flask + Waitress, threads=4)     ← C
       ↑ verdict { benign|ransomware, confidence, evidence[], model_version }
② Rust 서비스                                            ← A
       ↓ WebSocket (live broadcast + 5초 replay VecDeque, ?last_seq=N 핸드셰이크)
④ UI (TypeScript + React + Electron)                    ← B
```

**1초 wow 모먼트 흐름**: PoC 실행 → fanotify FAN_MODIFY/FAN_CLOSE_WRITE → A의 Rust collector가 `/proc/<pid>` 메타 보강 → `BehaviorEventV1` emit → A의 Rust aggregator(sliding window + burst detection) → A의 `classifier_client`가 C의 `/classify` 호출 → verdict → A의 `ws_broadcaster` → B의 UI 빨간 노드 + verdict panel → 자동 차단(`kill(pid, SIGTERM)` → `SIGKILL` fallback, A) 또는 Block 버튼(B → A IPC).

---

## 3인 공동 작업자

| 코드 | 역할 이름 | 주 책임 계층 | 시간 |
|---|---|---|---|
| **A** | **모든 Rust + Interface Contract Rust DRI + Critical Path 오너** | ① Rust+libfanotify collector + ② Rust 통합 서비스 전체 | ~58h |
| **B** | **React+Electron UI 풀스택 + 발표 퀄리티 오너** | ④ UI + DEMO/AC3/리허설/슬라이드 | ~32h |
| **C** | **Python 분석 엔진 + PoC/평가 + System Orchestration glue** | ③ Python + 데이터셋 + 측정 + run-all.sh + ARCHITECTURE.md | ~45h |

> **재분배 결과**: A가 모든 Rust 코드를 단일 소유함에 따라 critical path 단일 점이 됨. B는 UI에 집중하되 발표 퀄리티(DEMO-SCRIPT/AC3 evidence/리허설 코디네이션/footgun 문서)를 흡수해 underload 회피. C는 system orchestration(`run-all.sh`)과 Python-side Interface Contract DRI, ARCHITECTURE.md를 추가 흡수해 A 단독 risk를 분산.

---

## A — 모든 Rust + Interface Contract Rust DRI + Critical Path 오너 (~58h)

### Owns
- **사용자공간 collector (Rust + libfanotify, root)**
  - `fanotify_init` + `fanotify_mark` (mount-point 모니터링; FAN_MODIFY/FAN_CLOSE_WRITE/FAN_OPEN_EXEC, 선택적으로 FAN_OPEN_PERM)
  - 프로세스 메타 보강 (`/proc/<pid>/{exe,comm,status}`, `parent_pid` via `status:PPid`)
  - Collector→Service 송신측 (`BehaviorEventV1` JSONL, UNIX socket `/run/velxor/events.sock` 또는 stdout pipe; 큐 깊이 1024, `dropped_since_last`)
- **Rust 통합 서비스 전체**
  - `rust-service/src/main.rs` (tokio runtime, tracing init)
  - `collector_source.rs` (events.jsonl ↔ libfanotify 어댑터, `VELXOR_STUB=collector` 분기)
  - `aggregator.rs` (PID별 sliding window 1s/5s, burst detection)
  - `classifier_client.rs` (REST 클라이언트 → C의 Waitress)
  - `ws_broadcaster.rs` (tokio broadcast = live fan-out + 별도 `VecDeque` lock-protected 5초 replay, `?last_seq=N` 핸드셰이크)
- **자동 차단 (AC6)**: `nix::sys::signal::kill(Pid::from_raw(pid), Signal::SIGTERM)` → 200ms timeout → `SIGKILL` fallback; root 필요
- **Interface Contract Rust DRI**: `contracts/interface-schema.md`의 BehaviorEventV1 + WS message 섹션 authoring (C는 `/classify` REST 섹션 DRI, B는 UI consumer review)
- **scripts**: `ws-record.sh`(WS 캡처), `ac6-verify-block.sh`(`! kill -0 $PID` 또는 `! test -e /proc/$PID`)
- **AC4 tracing instrumentation (Rust 측)**: `event_received_ts`, `ws_sent_ts`, `classify_start_ts`, `classify_end_ts` JSON field emit. 측정 정의·해석은 C와 공동 검토.

### Week 0 (~9h, 학기 시작 ≥1주 전 주말)
- Ubuntu 24.04 + fanotify smoke (Week 0 AC) + inotify 백업 spike (0.6)
- `cargo new velxor-rust-service` + 의존성(tokio, tokio-tungstenite, reqwest, serde, tracing, nix, fanotify-rs) 컴파일 통과

### Week 1 (~16h, **최대 부하 — A critical path 시작**)
- **1.1 Interface Contract v1-draft 발행** (collector→service, WS message 섹션 authoring; C와 `/classify` 섹션 동기화)
- Rust 4 stub: `collector_source`(events.jsonl poll), `aggregator`(skeleton), `classifier_client`(reqwest stub), `ws_broadcaster`(broadcast+VecDeque 분리)
- `ws-record.sh` 작성
- B의 Vite/Electron 측에 v1-draft 링크 전달 → "compiles-against-ui" 한 줄 ack 요청

### Week 3 (~3h, v1.1 review collation)
- A 주관 v1.1 async 48h review: B/C에 부족·잘못된 필드 노트 요청 → 받은 노트만 통합해 additive-only v1.1 발행 (무응답 시 A 단독 발행)

### Week 4-5 (~21h, 본구현 — 두 번째 최대 부하)
- libfanotify 어댑터 본구현 (FAN_MODIFY, FAN_CLOSE_WRITE, FAN_OPEN_EXEC, kernel 6.8의 FAN_RENAME)
- `/proc/<pid>` 메타 보강 (PID race 대비 — fanotify FD 닫기 전 stat)
- `BehaviorEventV1` JSONL 송신 (UNIX socket `SO_SNDTIMEO=10ms`, mutex 보유/signal handler context 금지)
- `aggregator.rs`: sliding window + burst detection (FileWrite ≥ 50/1s OR FileRename ≥ 30/1s)
- `classifier_client.rs`: REST `/classify` + verdict cache per PID (TTL 1s)
- `ws_broadcaster.rs`: broadcast(live)/VecDeque(replay) 분리 finalize + `?last_seq=N` 처리 + gap 검출
- 통합 포인트 4.5/4.6: A 단독으로 collector ↔ service ↔ engine 어댑터 결선

### Week 8-9 (~10h)
- 자동 차단 시퀀스 본구현 + `ac6-verify-block.sh`
- tracing instrumentation (Rust 측 4개 timestamp field) + `rust-service/logs/trace.json` 저장 → C가 `eval-ac4.sh`에서 파싱
- 리허설 3회 collector 안정성/queue overflow 모니터링; collector crash 1회 시 즉시 `VELXOR_STUB=collector` 데모 모드 전환

### Week 10 (~3h)
- 슬라이드 collector + service 섹션 (libfanotify, root 권한 모델, FAN_OPEN_PERM, broadcast/replay 분리)
- 미완 시 "future work: LSM/eBPF 강화"

---

## B — React+Electron UI 풀스택 + 발표 퀄리티 오너 (~32h)

### Owns
- **React + Electron UI 전체** (ProcessTree, Timeline, DetailPanel, Block 버튼, ws 클라이언트)
  - `velxor-ui/src/App.tsx`, `components/*.tsx`, `ws/client.ts` (exponential backoff + `last_seq` 기록)
  - `velxor-ui/electron/main.ts` (dev 핫리로드 disable)
  - UI는 `seq` 기반 dedupe + gap 시 full refresh
- **`docs/electron-ws-footgun.md`** (Electron+Vite dev 핫리로드 vs preload context isolation footgun)
- **DEMO-SCRIPT.md** (1분 발표 흐름, UX 시나리오)
- **AC3 evidence** (OBS 영상 + `docs/AC3-evidence/frame-1000ms.png` 빨간 노드 + verdict panel)
- **리허설 코디네이션** (Week 9 3회 진행 총괄, `REHEARSAL-LOG.md` 작성·취합)
- **발표 영상** (`videos/demo.mp4` ≥ 30s OBS 녹화·편집)
- **슬라이드 UI 섹션** (4계층 다이어그램의 UI layer card, 빨간 노드 애니메이션 demo)
- **Interface Contract UI consumer review**: A의 v1.1 발행 전 WS message·reconnect 핸드셰이크 부분 review input

### Week 0 (~2h)
- `npm create vite@latest velxor-ui -- --template react-ts` + electron + `@xyflow/react`
- `npm run dev` 200 확인 (Node 20 LTS via nvm; apt nodejs 22는 회피)

### Week 1 (~4h)
- UI stub: Electron + Vite + React Flow + WS client (reconnect 골격, `?last_seq=N` 사용)
- A의 v1-draft mechanical ack (컴파일/연결 가능 여부만)

### Week 2-3 (~18h, **B 최대 부하**)
- ProcessTree (`@xyflow/react`) — batched dagre, 300 nodes/1s jank 회피
- Detail Panel (PID, image_path, parent_pid, verdict, confidence, evidence[])
- Threat Timeline (D3 또는 visx) — *Deferral #2*
- Block/Allow 버튼 — IPC로 A의 Rust 서비스에 `/block/:pid` HTTP POST (A의 kill 시퀀스 호출)
- WS reconnect 안정화 + `electron-ws-footgun.md`
- v1.1 review input (UI consumer 관점, 48h 내)

### Week 8-9 (~5h)
- UI 폴리싱 (빨간 노드 깜빡임 keyframe, verdict panel slide-in, 1초 wall-clock 시각화)
- `docs/DEMO-SCRIPT.md` (1분 발표 흐름)
- AC3 evidence: OBS 영상 + frame-1000ms.png 캡처
- 리허설 3회 진행 총괄 + `REHEARSAL-LOG.md` 취합

### Week 10 (~3h)
- 슬라이드 UI 섹션 + Walking Skeleton 진화 다이어그램(C의 ARCHITECTURE.md 인용)
- 발표 영상 편집 (≥ 30s)
- 풀 리허설 1-2회 진행

### B의 UI-only 책임이 "코드"가 아닌 4가지
1. **DEMO-SCRIPT.md** — UX 흐름 작성. UI를 가장 잘 아는 사람이 시연 동선을 짠다.
2. **AC3 evidence** — OBS 녹화 + 1000ms 캡처. UI 렌더링 시점이 핵심.
3. **리허설 코디네이션** — A는 collector/service 안정성 모니터링, C는 측정 출력에 집중하므로 진행 총괄은 B.
4. **발표 영상 편집** — UI 데모가 시연의 주역. B가 직접 cutting + 자막.

---

## C — Python 분석 엔진 & PoC/평가 & System Orchestration glue (~45h)

### Owns
- Flask + **Waitress** (threads=4, cross-platform) REST API (`/classify`, `/health`)
- `features.py` (행위 윈도우 통계 추출)
- `fallback_rules.py` (rule-based 영속 백업)
- 학습 모델 (`/classify` p99 < 100ms 만족)
- PoC v1/v2/v3 + 데이터셋 (positive/negative/heldout)
- AC2/AC4/AC5 측정 (`poc-bench.sh`, `eval-ac4.sh`, `eval-ac5.sh`, `AC5-results.md`)
- **(신규)** `scripts/run-all.sh` — engine + Rust service + UI 통합 startup orchestration (engine이 자연스러운 시작점)
- **(신규)** Interface Contract Python DRI: `contracts/interface-schema.md`의 `/classify` REST 섹션 (req/resp schema, p99 SLA, model_version 컨벤션) authoring + A의 v1.1 발행 전 review input
- **(신규)** `docs/ARCHITECTURE.md` — 4계층 다이어그램 + 데이터 흐름 + Walking Skeleton 진화 (B는 슬라이드 UI 섹션에서 인용)

### Week 0 (~2h)
- Flask `/health` 200 (venv 3.12 + Flask 3.0 + Waitress 3.0 threads=4)

### Week 1 (~7h, +2h: run-all.sh)
- 1.3 engine stub (`VELXOR_STUB=engine` 하드코드 verdict)
- `fallback_rules.py` 골격
- A의 v1-draft `/classify` 섹션에 Python DRI ack (compiles-against-engine + schema review)
- **신규**: `scripts/run-all.sh` 작성 (engine venv 활성→Waitress 기동, Rust `cargo run`, UI `npm run dev`, smoke 이벤트 emit). trap으로 3 PID 정리.

### Week 3 (~1h)
- v1.1 async review: Python/모델 관점 노트 1개 제출 (48h 내, A 단독 발행 회피)

### Week 6-7 (~22h, **C 최대 부하**)
- PoC v1/v2/v3 (v3는 held-out)
- positive 데이터셋 생성 (v1+v2 학습용, v3 held-out)
- **AC5b bursty-benign (Ubuntu)**: `rsync -aH --delete`, `unzip`/`7z`, `git clone`(대형 저장소), `npm install`(node_modules 폭발) → negative
- `features.py` (write_rate, rename_rate, ext_diversity, size_mean/std, pid_fanout)
- 학습 모델 트레이닝 → `/classify` p99 < 100ms 검증 (자체 측정 100회 요청)
- 미달성 시 `fallback_rules.py` 영속, `model_version: "rule-based-v1"`
- `scripts/poc-bench.sh` (AC2)

### Week 8-9 (~10h, +2h: ARCHITECTURE.md + run-all.sh 통합 검증)
- **AC5 측정**: `scripts/eval-ac5.sh` + `docs/AC5-results.md` (≥9/10 TP, ≤1/10 FP, honest reporting)
- **AC4 측정**: `scripts/eval-ac4.sh` — A의 tracing JSON 파싱 → event→ws p99 < 1000ms, classify p99 < 100ms
- 임계값 완화 X, honest reporting (held-out v3 결과 그대로 슬라이드)
- **신규**: `docs/ARCHITECTURE.md` 작성 (4계층 다이어그램, BehaviorEventV1 흐름, broadcast/replay 분리 설명)
- 리허설 참여 + `run-all.sh` 안정화 (3 모드 stub smoke 자동 sweep)

### Week 10 (~3h, +1h: 발표 영상 데이터 섹션)
- 슬라이드 데이터 전략 + AC5 결과 + **AC5c disclaimer**
- 백업 시연 영상 — *Deferral #4*

### C의 신규 흡수분 정당성
- **`run-all.sh`**: engine startup이 가장 복잡한 (venv 활성, Waitress 기동, p99 자가측정 대기) 요소. C가 자기 환경에서 가장 자주 돌리므로 owner가 자연스러움.
- **Python contract DRI**: `/classify` schema는 C가 가장 자주 수정 (모델·features 진화). A가 단독으로 contract 운영하면 drift 위험.
- **ARCHITECTURE.md**: A는 Rust 깊이 집중, B는 UI 데모 집중. 4계층 전체를 외부 시점에서 글로 풀어내기에 C가 적임.

---

## 공동 책임 (3인 모두)

| 항목 | 주관 | 공동 작업 |
|---|---|---|
| **Week 1 AC1 walking skeleton 재현성** | C (`run-all.sh` 신규 owner) | A의 Rust 4 stub + B의 UI + C의 engine stub이 통합되어 `run-all.sh` exit 0 + `ws-record.sh`(A) 캡처에 `node_add{event_type:"FileWrite"}` → `git tag walking-skeleton-v1` |
| **Interface Contract v1.0 / v1.1** | A 주관 발행 (단독 발행권) | A=Rust DRI(BehaviorEventV1+WS), C=Python DRI(`/classify` REST), B=UI consumer review. 48h 무응답 시 A 단독 발행 |
| **Week 9 리허설 3회** | B (진행 총괄, `REHEARSAL-LOG.md`) | A=collector/service 안정성 모니터링, C=p99 측정 출력 검증 |
| **Week 10 발표** | B (UI 섹션 + 영상 편집 + 풀 리허설 진행) | A=collector/service 섹션, C=데이터/AC5/AC4 섹션 |
| **AC8 stub 모드 검증** | A=collector + both, C=engine | `VELXOR_STUB=collector`/`engine`/`both` 3 모드 smoke pass. B는 UI가 stub 모드 무관하게 동일 동작함을 ack |

---

## 통합 포인트 & 의존성 격리

| 통합 포인트 | 시점 | Primary owner | Fallback |
|---|---|---|---|
| ① → ② Collector→Service 메시지 (libfanotify → UNIX socket/stdout pipe JSONL) | Week 4-5 | A (내부 통합 — A가 양쪽 모두 소유) | `VELXOR_STUB=collector` (events.jsonl poll 영속) |
| ② → ③ REST `/classify` (A Rust → C Python) | Week 1 (stub) / Week 7 (real) | A + C | `VELXOR_STUB=engine` 또는 `fallback_rules.py` (`model_version: "rule-based-v1"`) |
| ② → ④ WebSocket (A Rust → B UI) | Week 1 | A + B | (단일 owner 분할, fallback 불필요. A의 stub은 events.jsonl로 항상 emit 가능) |
| Schema v1 / v1.1 | Week 1 / Week 3 | A (단독 발행권) | 48h 무응답 시 A 단독 발행 (Principle 4). C/B 각자 도메인 review |
| 자동 차단 IPC (B UI → A Rust → kill) | Week 8 | A + B | UI Block 버튼 비활성, A 측 일괄 kill (*Deferral #3*) |
| **(신규)** `run-all.sh` 통합 startup | Week 1 (작성) / Week 8-9 (안정화) | C | 각 컴포넌트 단독 실행 + 수동 종합 (B/A는 시연 시 자기 환경에서 단독 실행 가능해야 함) |

> **원칙 (consensus-plan Principle 4)**: 팀원 통합 포인트는 명시하되 의존성은 격리. A가 모든 Rust를 소유하므로 ②계층 내부 통합은 A 단일 책임이지만, **A 자신이 critical path**이므로 B/C가 각자 도메인에서 stub fallback을 항상 유지해야 A 단독 risk가 분산된다.

---

## Hour Ledger (3인 합산 ~135-140h, deferral 트리거 >145h, 여유 ~5-10h)

| Week | A | B | C | 합계 | 비고 |
|---|---|---|---|---|---|
| Week 0 (학기 전 주말) | 9 | 2 | 2 | 13 | Additive. A는 fanotify + cargo scaffold + Rust 의존성 확정 |
| Week 1 (walking skeleton) | 16 | 4 | 7 | 27 | A=v1-draft + 4 Rust stub + ws-record.sh; C=run-all.sh + engine stub; B=UI stub |
| Week 2-3 (UI + review) | 3 | 18 | 1 | 22 | A=v1.1 collation (3h); B 풀스택 UI; C 노트 1건 |
| Week 4-5 (Rust 본구현 + 통합) | 21 | 0 | 0 | 21 | A 단독 critical path (libfanotify + service + WS) |
| Week 6-7 (PoC + 데이터셋) | 0 | 0 | 22 | 22 | C 데이터·모델 집중 |
| Week 8-9 (차단·측정·리허설) | 10 | 5 | 10 | 25 | A 자동차단+tracing; B 리허설 총괄+AC3; C AC4/AC5+ARCHITECTURE.md |
| Week 10 (발표) | 3 | 3 | 3 | 9 | A=Rust 섹션, B=UI+영상, C=데이터 섹션 |
| **Total** | **~62h** | **~32h** | **~45h** | **~139h** | A 단독 overload 인정. trigger 145h에 ~6h 여유 |

> **A overload 정당화**: 사용자 지시 "Rust 전부 A"의 자연스러운 귀결. 145h trigger 이전이지만 A 단독 risk는 critical path 단일 점 실패로 발현 가능. **Mitigation**:
> 1. Week 1+4-5 부하(37h)에 학기 시작 ≥1주 전 Week 0를 9h로 두텁게 잡아 사전 흡수
> 2. C가 `run-all.sh` orchestration을 흡수해 A의 통합 검증 부담 경감
> 3. B는 UI 안정화 후 발표 퀄리티 흡수로 underload 회피, A를 정신적으로 받쳐주는 역할
> 4. v1.1 schema review 48h 무응답 정책 — A가 진행 차단되지 않게 함

### Deferral Order (사전 정의, >145h 시 자동 적용)
1. 2.4 UI 사운드 효과 (Web Audio) → B
2. 2.2 Threat Timeline (D3) → 간단 리스트 뷰 → B
3. 8.1 자동 차단 → Block 버튼 수동 차단만 → A
4. 10.2 백업 시연 영상 → B
5. **(신규)** AC4 tracing instrumentation 단순화 → A의 4개 timestamp 중 event→ws 2개만 유지

---

## Acceptance Criteria 책임 매핑

| AC | 검증 artifact | 주 책임 |
|---|---|---|
| AC1 Walking Skeleton | `run-all.sh` exit 0, `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}`, 3인 재현, `walking-skeleton-v1` tag | C (run-all.sh) + A (ws-record.sh) + 전원 (재현) |
| AC2 PoC 동작 | `poc-bench.sh` wall-clock < 1s for 300 ops | C |
| AC3 탐지 화면 | OBS 영상 + `docs/AC3-evidence/frame-1000ms.png` | B |
| AC4 지연시간 | A의 tracing JSON → C의 `eval-ac4.sh` → event→ws p99 < 1000ms, classify p99 < 100ms; 데모 wall-clock ≤ 1s | A (instrumentation) + C (측정 스크립트·해석) |
| AC5 분류 정확도 (≥9/10 TP, ≤1/10 FP) | `eval-ac5.sh`, `AC5-results.md` | C |
| AC5a held-out v3 | `poc-samples/v3/` (.pdf → .locked) | C |
| AC5b bursty-benign negative | rsync/unzip/git-clone/npm-install 로그 | C |
| AC5c disclaimer | slide deck "synthetic PoC, not real-world malware. Linux/ext4 + fanotify userspace collector" | C |
| AC6 차단 검증 | `ac6-verify-block.sh` (`! kill -0 "$PID"` 또는 `! test -e /proc/$PID`) | A |
| AC7 발표 자료 | `docs/DEMO-SCRIPT.md` + `videos/demo.mp4` ≥ 30s | B |
| AC8 stub 영속성 | 3 모드 (`collector`/`engine`/`both`) smoke pass | A=collector+both, C=engine |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Trigger | Mitigation | Owner |
|---|---|---|---|---|---|
| **A 단독 critical path 병목** | **High** | **High** | Week 4 종료 시 Rust 본구현 미완 또는 통합 결선 실패 | C가 `run-all.sh`로 통합 부담 분담; B/C 각자 stub 영속 가능; A의 Week 0~1 부하 ≥1주 전 사전 흡수 | A + 전원 |
| **Interface Contract drift (A 단독 운영)** | Medium | Medium | C의 `/classify` 변경 또는 B의 WS 요구사항이 v1.1 review에 누락 | A가 v1.0/v1.1 발행 전 B/C 각 도메인 ack 필수; A=Rust DRI / C=Python DRI 명시 | A 주관, C 공동 |
| **Integration verification 공백** | Medium | Medium | B가 UI 코드만 하면 통합 self-review 부재 | C가 `run-all.sh` 3모드 sweep + B가 UI 측 end-to-end smoke; A는 Rust unit/integration test | C + B + A |
| 팀원 A collector·service 지연 | High | High | Week 4 종료 시 `events.jsonl`조차 emit 안함 | `VELXOR_STUB=collector` 영속, `VELXOR_STUB=both` 데모로 B/C 진행 차단 X | A |
| 팀원 C 모델 미완성 | Medium | Medium | Week 7 종료 시 학습 모델 없음 | `fallback_rules.py` 영속, `model_version: "rule-based-v1"` | C |
| fanotify mark/init 권한 실패 | Low | High | Week 0 AC 미달성 (root·CONFIG_FANOTIFY·AppArmor) | inotify 백업 경로 (0.6 캡처), 슬라이드 "permission caveats" | A |
| Collector crash / queue overflow | Low | High | 리허설 중 1회 이상 sigsegv·`dropped_since_last` 폭증 | systemd `Restart=on-failure` + drop counter alert; 1회 crash 시 `VELXOR_STUB=collector` 데모 모드 | A |
| WS reconnect 불안정 | Medium | Low | 리허설 중 끊김 관측 | A의 5초 replay (separate VecDeque) + B의 exponential backoff + Electron dev 핫리로드 disable | A + B |
| 합성 PoC 일반화 의문 | Medium | Low | 발표 Q&A | AC5c disclaimer + "real-world testing future work" | C |
| 시간 예산 ≥115% 초과 (>145h) | High | Medium | 누적 hours > 145 | 사전 정의 deferral order 자동 적용 | 전원 |
| Week 0+1 부하 집중 (A: ~25h) | High | Medium | 학기 전 주말 + Week 1 | Week 0를 학기 시작 ≥1주 전 완료 (사전 흡수) | A |
| Week 3 review 응답 부진 | Medium | Low | 48h 후 노트 0건 | v1.1 A 단독 발행 (Principle 4 의도된 trade) | A |
| v1.0 필드 잘못 타입 결정 | Low | Medium | Week 3 review에서 wrong-typed 발견 | additive `*_v2` 필드 추가 + 슬라이드 deprecated (escape hatch) | A |

---

## Files Created (planned)

```
Velxor/
├── contracts/
│   └── interface-schema.md                  # A 주관 발행 + A=Rust DRI / C=Python DRI / B=UI review
├── rust-service/                            # ⬅ 전부 A 단독 소유
│   ├── Cargo.toml                           # A
│   └── src/
│       ├── main.rs                          # A
│       ├── collector_source.rs              # A (libfanotify ↔ events.jsonl 어댑터)
│       ├── aggregator.rs                    # A
│       ├── classifier_client.rs             # A
│       └── ws_broadcaster.rs                # A (broadcast + VecDeque 분리)
├── python-engine/                           # ⬅ 전부 C 단독 소유
│   ├── app.py                               # C
│   ├── waitress_conf.py                     # C — Waitress threads=4
│   ├── features.py                          # C
│   ├── fallback_rules.py                    # C
│   ├── requirements.txt                     # C
│   └── model/                               # C
├── ui/                                      # ⬅ 전부 B 단독 소유
│   ├── package.json                         # B
│   ├── electron/main.ts                     # B
│   ├── src/
│   │   ├── App.tsx                          # B
│   │   ├── components/{ProcessTree,Timeline,DetailPanel,BlockButton}.tsx    # B
│   │   └── ws/client.ts                     # B
│   └── vite.config.ts                       # B
├── poc-samples/ransomware_simulator/{v1,v2,v3}/    # C
├── datasets/{positive,negative,heldout}/    # C
├── scripts/
│   ├── run-all.sh                           # C  ← 신규 owner
│   ├── ws-record.sh                         # A
│   ├── poc-bench.sh                         # C
│   ├── eval-ac4.sh                          # C (A의 tracing JSON 파싱)
│   ├── eval-ac5.sh                          # C
│   └── ac6-verify-block.sh                  # A
└── docs/
    ├── ARCHITECTURE.md                      # C  ← 신규 owner
    ├── DEMO-SCRIPT.md                       # B
    ├── REHEARSAL-LOG.md                     # B 취합 + 전원 기여
    ├── AC5-results.md                       # C
    ├── AC3-evidence/                        # B
    └── electron-ws-footgun.md               # B
```

---

## 종전(2026-05-20) vs 본 재분배(2026-05-22) — 변경점

| 항목 | 종전 (2026-05-20) | 본 재분배 (2026-05-22) |
|---|---|---|
| Rust 책임 | A=저수준(collector_source, aggregator), B=통합(classifier_client, ws_broadcaster, main) | **A 전부 단독** |
| UI | B 단독 | **B 단독 + 발표 퀄리티(DEMO/AC3/리허설/영상/슬라이드 UI)** |
| Interface Contract | B 단독 발행 | **A 단독 발행권, A=Rust DRI / C=Python DRI / B=UI review (공동 ack)** |
| `scripts/run-all.sh` | B | **C** (engine startup orchestration이 자연스러움) |
| `scripts/ws-record.sh` | B | **A** (WS 서버 owner) |
| `docs/ARCHITECTURE.md` | B | **C** (4계층 외부 시점 글, B는 UI 슬라이드에서 인용) |
| AC8 stub 검증 | A=collector, B=both, C=engine | **A=collector+both, C=engine, B=UI 측 ack** |
| Hour ledger | A=41, B=45, C=40 | **A=62, B=32, C=45** (A overload 인정, 합계 ~139h, trigger 145h에 ~6h 여유) |
| Worker A timeline 형식 | 체크리스트 (간략) | **Copy-Paste Runnable 상세** (critical path 마일스톤·의존성 명시 필요 — CCG advisor 권고) |

> 본 재분배는 사용자 지시(Rust 전부 A / B UI만 / C 필요시 변경)에 따른 것이며, CCG 양 advisor(Codex, Gemini) 합성 결과 Interface Contract 공동 소유 + run-all.sh의 C 위임 + B의 발표 퀄리티 흡수가 권고되어 반영했다. A overload는 "Rust 전부 A" 지시의 자연스러운 귀결로, deferral trigger 미달이지만 critical path 단일 점 risk를 명시적으로 인지한다.

---

## Branch Strategy

- `main` — protected, 발표용 안정 브랜치. PR target.
- `devA` / `devB` / `devC` — 작업자 A/B/C 개별 작업 브랜치. 본인 owns 영역의 모든 PR은 자기 dev 브랜치에서 main으로.
- `dev1` / `dev2` / `dev3` — 레거시 (Initial commit 직후 생성), **신규 사용 중단**.
- Walking Skeleton 완성 시점 `walking-skeleton-v1` tag (AC1). 이후 `v1.1-schema`, `ac5-baseline` 같은 의미 단위 tag.
- 모든 main 머지는 3인 review 통과 필수.
- **CODEOWNERS 권장** (재분배 반영):
  - `rust-service/**` → @A
  - `python-engine/**` → @C
  - `ui/**` → @B
  - `contracts/interface-schema.md` → @A @C (Rust+Python DRI 공동)
  - `scripts/run-all.sh`, `scripts/eval-*.sh`, `scripts/poc-bench.sh` → @C
  - `scripts/ws-record.sh`, `scripts/ac6-verify-block.sh` → @A
  - `docs/ARCHITECTURE.md`, `docs/AC5-results.md` → @C
  - `docs/DEMO-SCRIPT.md`, `docs/AC3-evidence/**`, `docs/REHEARSAL-LOG.md`, `docs/electron-ws-footgun.md` → @B
- `kernel-driver/` 폴더는 마이그레이션(2026-05-21)으로 폐지.

---

## Status
- **계획 단계**: 🟡 PENDING APPROVAL (재분배 반영 버전)
- **다음 단계**: 사용자 명시적 승인 후 Week 0 시작
- **승인 시 실행**: 별도 협의
