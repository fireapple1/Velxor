# Velxor 팀 Zeraxis — 역할 분담 (공동 작업자 3인)

## Metadata
- **기술 명세 출처 (Source of truth)**: [`velxor-consensus-plan.md`](./velxor-consensus-plan.md) (참고: `.omc/`는 session-local, `.gitignore` 처리됨)
- **형식 참고**: [`velxor_planning_doc.html`](./velxor_planning_doc.html) (3인 카드 + 4계층 layer-card 레이아웃만)
- **Generated**: 2026-05-20
- **Mode**: 3인 공동 작업자 균등 분담 (각 ~40h, 합계 ≤126h, deferral 트리거 >145h)

---

## 한 줄 요약
Ubuntu 24.04 **사용자공간** **랜섬웨어 행위 탐지** 데모급 백신. 4계층(Rust+libfanotify 수집기 / Rust 통합 서비스 / Python 분석 엔진 / React+Electron UI)을 합성 PoC로 시연하며, ≤1초 안에 wow 모먼트(빨간 노드 + verdict panel)를 달성한다.

> **2026-05-21 마이그레이션**: 원안의 layer ① "C+WDK 미니필터 드라이버"가 **Rust + libfanotify userspace collector**로 대체되었다. kernel module 없음, BSOD·test-signing 의존성 제거, A 영역 학습 곡선 단축. `BehaviorEventV1` JSONL wire 포맷은 그대로 유지되어 B/C 영역은 변경 없음. 자세한 마이그레이션 노트는 [`velxor-consensus-plan.md` §Migration](./velxor-consensus-plan.md)·[`ENVIRONMENT.md`](./ENVIRONMENT.md) 참조.

---

## 4계층 아키텍처 & 데이터 흐름 (Ubuntu)

```
① 사용자공간 수집기 (Rust + libfanotify, root)
       ↓ Collector→Service 메시지 (BehaviorEventV1, JSONL on UNIX socket 또는 stdout pipe)
② 사용자공간 통합 서비스 (Rust)
       ↓ REST POST /classify
③ 분석 엔진 (Python + Flask + Waitress, threads=4)
       ↑ verdict { benign|ransomware, confidence, evidence[], model_version }
② Rust 서비스
       ↓ WebSocket (live broadcast + 5초 replay VecDeque, ?last_seq=N 핸드셰이크)
④ UI (TypeScript + React + Electron)
```

**1초 wow 모먼트 흐름**: PoC 실행 → fanotify FAN_MODIFY/FAN_CLOSE_WRITE 이벤트 → Rust collector가 `/proc/<pid>` 메타 보강 → `BehaviorEventV1` emit → Rust 집계(sliding window + burst detection) → `/classify` 호출 → verdict → WebSocket → UI 빨간 노드 + verdict panel → 자동 차단(`kill(pid, SIGTERM)` → `SIGKILL` fallback) 또는 Block 버튼.

---

## 3인 공동 작업자 (각 ~40h)

| 코드 | 역할 이름 | 주 책임 계층 |
|---|---|---|
| **A** | 사용자공간 collector & Rust 입력 파이프라인 | ① Rust+libfanotify collector + ② Rust 저수준 |
| **B** | Rust 통합 서비스 & UI & Interface Contract | ② Rust 통합 + ④ UI |
| **C** | Python 분석 엔진 & PoC/평가 | ③ Python + 데이터셋 + 측정 |

> 각 작업자는 단일 계층의 owner가 아니라 **계층 간 통합 포인트를 공유하는 공동 작업자**다. Interface Contract는 B가 주관하되 v1.1 review에서 A/C 동등 input. Walking Skeleton(Week 1)은 3인 모두 자기 머신에서 `run-all.sh` 재현 가능해야 AC1 통과.

---

## A — 사용자공간 collector & Rust 입력 파이프라인 (~40h)

### Owns
- **fanotify 수집기** (`fanotify_init` + `fanotify_mark`로 mount-point 모니터링; FAN_MODIFY/FAN_CLOSE_WRITE/FAN_OPEN_EXEC, 선택적으로 FAN_OPEN_PERM)
- 프로세스 메타 보강 (`/proc/<pid>/{exe,comm,status}`, `parent_pid` via `status:PPid`)
- Collector→Service 메시지 송신측 (`BehaviorEventV1` JSONL, UNIX socket `/run/velxor/events.sock` 또는 stdout pipe; 큐 깊이 1024, `dropped_since_last`, queue full 시 drop counter 증가)
- Rust `collector_source.rs` (events.jsonl ↔ libfanotify 어댑터, `VELXOR_STUB=collector` 분기)
- Rust `aggregator.rs` (PID별 sliding window 1s/5s, burst detection)
- 자동 차단 (`nix::sys::signal::kill(Pid::from_raw(pid), Signal::SIGTERM)` → 200ms timeout → `SIGKILL` fallback; root 필요)
- 권한·실행 모드 핸들링 (root 실행 + `CAP_SYS_ADMIN`만 부여하는 systemd unit 옵션 문서화)

> *(Why fanotify, not LKM)* libfanotify는 userspace API라 kernel build/insmod·OOPS 위험 없이 동일한 "system-wide file event intercept"를 얻는다. `FAN_OPEN_PERM`은 permission event(허용·거부 가능)까지 제공해 자동 차단의 기초가 된다. trade-off는 kernel-level 정체성 약화 — README 마이그레이션 노트 참조.

### Week 0 (~7h)
- 0.1 Ubuntu 24.04 bare-metal 또는 VM(KVM/VirtualBox) + (선택) timeshift/LVM snapshot 1
- 0.2 **fanotify smoke**: 최소 Rust 또는 C 샘플로 `~/velxor-work/src`에 `touch foo` 했을 때 FAN_MODIFY 1개 캡처 → **Week 0 AC**
- 0.6 fallback 경로 실증: `inotifywait -m -r ~/velxor-work` 로 inotify 백업 경로 1개 캡처 (fanotify 실패 시 demo backup)

### Week 1 (~5h)
- 1.2(부분) collector stub: `events.jsonl` writer (mock 이벤트 emit, schema v1-draft 호환)
- Rust `collector_source.rs`: `events.jsonl` poll ↔ 실 libfanotify 어댑터 분기 (`VELXOR_STUB=collector` flag)
- 1.6 schema v1-draft mechanical ack (컴파일 가능 한 줄 응답)

### Week 3 (~1h)
- 2.6 v1.1 async review: collector 관점에서 missing/wrong field 노트 1개 제출 (48h 내)

### Week 4-5 (~18h)
- libfanotify 어댑터 본구현 (FAN_MODIFY, FAN_CLOSE_WRITE, FAN_OPEN_EXEC; FAN_RENAME는 kernel 5.17+에서 가능, 24.04는 6.8 → OK)
- `/proc/<pid>/{exe,comm,status}` 메타 보강 (PID race: 짧은 수명 프로세스 대비 fanotify FD 닫기 전에 stat 시도)
- `BehaviorEventV1` JSONL 송신: 큐 깊이 1024, `dropped_since_last` 카운트
- 4.1 Rust sliding window per PID (1s / 5s)
- 4.2 burst detection (FileWrite ≥ 50/1s OR FileRename ≥ 30/1s)
- **4.5 통합 포인트**: B의 Rust 서비스 어댑터를 실 fanotify collector로 교체. 미도착 시 `VELXOR_STUB=collector` 영속, 진행 차단 없음

### Week 8-9 (~8h)
- 8.1 자동 차단 — Rust에서 `kill(pid, SIGTERM)` → 200ms 대기 → `kill(pid, SIGKILL)` 시퀀스 구현. `EPERM`/`ESRCH` 발생 시 fallback 로그 (Deferral #3 후보). root 권한 또는 동일 uid 필요 — collector가 root로 떠 있어 충족.
- `scripts/ac6-verify-block.sh` — `! kill -0 "$PID" 2>/dev/null && echo "blocked"` 또는 `! test -e /proc/$PID`로 자동 확인
- 리허설 3회 collector 안정성, queue overflow 발생 시 fanotify mark 재초기화 (drop counter 모니터)
- 1회 이상 collector crash 시 즉시 `VELXOR_STUB=collector` 데모 모드 전환

### Week 10 (~2h)
- 슬라이드 collector 섹션 (libfanotify, root 권한 모델, FAN_OPEN_PERM 차단 메커니즘)
- collector 미완 시 "future work: LSM/eBPF로 kernel-level 강화" 표기

---

## B — Rust 통합 서비스 & UI & Interface Contract (~40h)

### Owns
- Interface Contract v1-draft / v1.1 (`contracts/interface-schema.md`) — wire encoding, reconnect 핸드셰이크 포함
- Rust `classifier_client.rs` (REST 클라이언트, 대상 = Waitress)
- Rust `ws_broadcaster.rs` (tokio broadcast = live fan-out + 별도 `VecDeque` lock-protected 5초 replay, `?last_seq=N` 핸드셰이크)
- React + Electron UI 전체 (ProcessTree, Timeline, DetailPanel, Block 버튼) — UI는 `seq` 기반 dedupe
- WS 클라이언트 (exponential backoff, `last_seq` 기록 후 reconnect 시 query param 전달)
- `run-all.sh`, `ws-record.sh`
- `DEMO-SCRIPT.md`, `electron-ws-footgun.md`

### Week 0 (~3h)
- 0.3 `cargo new velxor-rust-service` (tokio, tokio-tungstenite, reqwest, serde, tracing)
- 0.4 `npm create vite@latest velxor-ui -- --template react-ts` + electron + `@xyflow/react`

### Week 1 (~12h)
- **1.1 Interface Contract v1-draft** → `Velxor/contracts/interface-schema.md`
  - Collector→Service 메시지 `BehaviorEventV1` (UNIX socket `/run/velxor/events.sock` 또는 stdout pipe JSONL, `schema_version`, `seq`, `dropped_since_last`, `pid`, `parent_pid`, `image_path`, `event_type`, `file_path?`, `volume_id?`, `op_detail?`, `ts_unix_ms`)
  - **Wire encoding**: JSON UTF-8, max 4 KiB/msg; `image_path`/`file_path`는 **UTF-8 string, 최대 4096 bytes** (Linux PATH_MAX 대응). NUL-terminator 불필요(JSON string으로 인코딩됨)
  - REST `POST /classify` (Waitress 호스팅; `req.events[]`, `req.window_ms`, `resp.verdict`, `resp.confidence`, `resp.evidence[]`, `resp.model_version`)
  - WS message (`schema_version`, `seq`, `type` ∈ {node_add|node_update|verdict|alert|gap}, `payload`)
  - **Reconnect 프로토콜**: client 연결 시 `?last_seq=N` 전달, server는 seq>N replay 후 live; VecDeque 5초 초과로 N+1 부재 시 `{type:"gap", from, to}` → UI 트리 재구성; UI는 동일 seq 중복 무시
  - Evolution policy (v1.x additive only, v2 breaking, `*_v2` parallel field escape hatch)
  - `VELXOR_STUB` semantics 표 (driver/engine/both)
- Rust `ws_broadcaster.rs`: broadcast channel + 별도 `VecDeque` lock-protected replay (>1000 events 가능)
- Rust `classifier_client.rs` stub
- 1.4 UI stub: Electron + Vite + React Flow + WS client (reconnect 골격)
- 1.5 `scripts/run-all.sh`, `scripts/ws-record.sh`

### Week 2-3 (~22h)
- 2.1 **ProcessTree** (`@xyflow/react`) — batched dagre (새 부모-자식 추가 시에만 재실행, 후속 자식은 manual incremental positioning), 300 nodes/1s jank 회피
- 2.2 **Threat Timeline** (D3 또는 visx) — *Deferral #2*
- 2.3 **Detail Panel** (PID, image, verdict, confidence, evidence)
- 2.4 **Block/Allow 버튼** — IPC로 A의 `kill(pid, SIGTERM/SIGKILL)` 시퀀스 호출 (사운드는 *Deferral #1*)
- 2.5 WS reconnect 안정화 + `docs/electron-ws-footgun.md` (Electron+Vite 핫리로드 vs preload context isolation footgun, dev 핫리로드 disable)
- **2.6 v1.1 async review 주관**: A/C에게 48h deadline 통지, 노트 수집, additive-only v1.1 발행 (무응답 시 단독 발행)
- 4.3 Rust REST `/classify` 호출 + verdict cache per PID
- 4.4 broadcast/replay 분리 finalize

### Week 8 (~5h)
- 8.2 `docs/DEMO-SCRIPT.md` (1분 발표 흐름)
- 8.3 UI 폴리싱 (애니메이션, 색상, 타이밍, 빨간 노드 강조)

### Week 10 (~3h)
- 10.1 슬라이드 아키텍처 섹션 (4계층, Walking Skeleton 진화 과정, Interface Evolution Gate)
- 10.3 발표 리허설 진행 총괄

---

## C — Python 분석 엔진 & PoC/평가 (~40h)

### Owns
- Flask + **Waitress** (threads=4, cross-platform; Linux/Ubuntu에서도 그대로 가동) REST API (`/classify`, `/health`)
- `features.py` (행위 윈도우 통계 추출)
- `fallback_rules.py` (rule-based 영속 백업: write rate ≥ 50/1s → ransomware 0.9)
- 학습 모델 (`/classify` p99 < 100ms 만족, `model_version` 채움)
- PoC v1/v2/v3 + 데이터셋 (positive/negative)
- AC2/AC4/AC5 측정 (`poc-bench.sh`, `eval-ac4.sh`, `eval-ac5.sh`, `AC5-results.md`)

### Week 0 (~2h)
- 0.5 Flask `/health` 200 (venv + Flask + **Waitress** threads=4)

### Week 1 (~5h)
- 1.3 Python engine stub: Flask + Waitress threads=4, 하드코드 verdict `{ransomware, 0.95}` (`VELXOR_STUB=engine` 모드)
- `fallback_rules.py` 골격 (write rate ≥ 50/1s → ransomware 0.9)
- 1.6 schema v1-draft ack

### Week 3 (~1h)
- 2.6 v1.1 async review: Python/모델 관점 노트 1개 제출 (48h 내)

### Week 6-7 (~22h)
- 6.1 `poc-samples/ransomware_simulator/v1/`: .docx → .docx.enc rename + 32B prefix write, 300 files/1s
- **6.2 AC5a variants**:
  - `v2/`: .txt → .crypted, 500 files/0.8s
  - `v3/`: .pdf → .locked, 200 files/2s (**held-out**)
- 6.3 positive 데이터셋 생성기 (v1+v2 학습, v3 held-out)
- **6.4 AC5b bursty-benign (Ubuntu)**: `rsync -aH --delete src/ dst/`, `unzip`/`7z`, `git clone`(대형 저장소), `npm install`(node_modules 폭발) → negative 로그
- `features.py`: 행위 윈도우 통계 (write rate, rename rate, 확장자 다양성, 파일 크기 분포, PID 트리 fan-out)
- 학습 모델 트레이닝 → `/classify` p99 < 100ms 만족 (Waitress threads=4)
- 미달성 시 `fallback_rules.py` 영속, `model_version: "rule-based-v1"`
- `scripts/poc-bench.sh` (AC2: 300 file ops wall-clock < 1s 검증)

### Week 8-9 (~8h)
- **8.4 AC5 측정**: `scripts/eval-ac5.sh` 작성
  - v1+v2 학습, v3 held-out + rsync/unzip/git-clone/npm-install negative로 평가
  - `docs/AC5-results.md` 산출 (≥9/10 TP, ≤1/10 FP)
- **AC4 측정**: `scripts/eval-ac4.sh` — Rust `tracing` JSON 파싱 → event→ws p99 < 1000ms, classify p99 < 100ms 출력
- 임계값 완화 X, honest reporting (held-out v3 결과 그대로 슬라이드)

### Week 10 (~2h)
- 10.1 슬라이드 데이터 전략 + AC5 결과 페이지
- **AC5c disclaimer**: "evaluated on synthetic PoC, not real-world malware"
- 10.2 백업 시연 영상 — *Deferral #4*

---

## 공동 책임 (3인 모두)

| 항목 | 주관 | 공동 작업 |
|---|---|---|
| **Week 1 AC1 walking skeleton 재현성** | B (`run-all.sh`) | A/C 각자 머신에서 `run-all.sh` exit 0 + `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}` 확인 → `git tag walking-skeleton-v1` |
| **Week 3 v1.1 schema review (async 48h)** | B (단독 발행권) | A/C 노트 1개씩 제출 |
| **Week 9 리허설 3회** | B (진행) | 전원 참석, `REHEARSAL-LOG.md` (snapshot rollback < 60s) |
| **Week 10 발표** | B (총괄) | 각자 담당 섹션 슬라이드 |
| **AC8 stub 모드 검증** | A=collector, C=engine, B=both | `VELXOR_STUB=collector`/`engine`/`both` 3 모드 smoke pass |

---

## 통합 포인트 & 의존성 격리

| 통합 포인트 | 시점 | Primary owner | Fallback |
|---|---|---|---|
| ① → ② Collector→Service 메시지 (libfanotify → UNIX socket/stdout pipe JSONL) | Week 4-5 | A | `VELXOR_STUB=collector` (events.jsonl poll 영속) |
| ② → ③ REST `/classify` (Rust → Python) | Week 1 (stub) / Week 7 (real) | B + C | `VELXOR_STUB=engine` 또는 `fallback_rules.py` (`model_version: "rule-based-v1"`) |
| ② → ④ WebSocket (Rust → UI) | Week 1 | B | (단일 owner, fallback 불필요) |
| Schema v1 / v1.1 | Week 1 / Week 3 | B (주관) | 48h 무응답 시 B 단독 발행 (Principle 4) |
| 자동 차단 IPC (UI → Rust → kill) | Week 8 | A + B | UI Block 버튼 수동 차단만 유지 (*Deferral #3*) |

> **원칙 (consensus-plan Principle 4)**: 팀원 통합 포인트는 명시하되 의존성은 격리. A 또는 C가 지연되어도 stub fallback으로 데모 완성 가능 → 통합 리스크 0.

---

## Hour Ledger (3인 합산 ≤126h, deferral 트리거 >145h)

| Week | A | B | C | 합계 | 비고 |
|---|---|---|---|---|---|
| Week 0 (학기 전 주말) | 7 | 3 | 2 | 12 | Additive |
| Week 1 (walking skeleton) | 5 | 12 | 5 | 22 | v1-draft + 4 stubs |
| Week 2-3 (UI + review) | 1 | 22 | 1 | 24 | v1.1 async 48h |
| Week 4-5 (실데이터 흐름) | 18 | 0 | 0 | 18 | 통합 포인트 1차 |
| Week 6-7 (PoC + 데이터셋) | 0 | 0 | 22 | 22 | AC5a/b |
| Week 8-9 (통합 + 차단 + 측정) | 8 | 5 | 8 | 21 | AC5 측정 |
| Week 10 (발표) | 2 | 3 | 2 | 7 | 슬라이드 + 리허설 |
| **Total** | **~41h** | **~45h** | **~40h** | **~126h** | ceiling 126h에 부합, deferral 트리거 145h(126×1.15)에 미달 → 자동 절단 불필요. (원 spec 120h ceiling 대비 +5% 공식 조정) |

> B가 ~5h 더 많은 이유: Interface Contract 주관 + UI 풀스택 책임. Week 2-3에 집중되므로 다른 주에서 흡수 가능.

### Deferral Order (사전 정의, >145h 시 자동 적용)
1. 2.4 UI 사운드 효과 (Web Audio) → B
2. 2.2 Threat Timeline (D3) → 간단 리스트 뷰 → B
3. 8.1 자동 차단 → Block 버튼 수동 차단만 → A
4. 10.2 백업 시연 영상 → C

---

## Acceptance Criteria 책임 매핑

| AC | 검증 artifact | 주 책임 |
|---|---|---|
| AC1 Walking Skeleton | `run-all.sh` exit 0, `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}`, 3인 재현, `walking-skeleton-v1` tag | B (스크립트), 전원 (재현) |
| AC2 PoC 동작 | `poc-bench.sh` wall-clock < 1s for 300 ops | C |
| AC3 탐지 화면 | OBS 영상 + `docs/AC3-evidence/frame-1000ms.png` 빨간 노드 + verdict panel | B |
| AC4 지연시간 | event→ws p99 < 1000ms (측정), 데모 wall-clock ≤ 1s (체감); classify p99 < 100ms (Waitress threads=4 sub-budget); `scripts/eval-ac4.sh` 산출 | B (tracing instrumentation) + C (측정 스크립트) |
| AC5 분류 정확도 (≥9/10 TP, ≤1/10 FP) | `eval-ac5.sh`, `AC5-results.md` | C |
| AC5a held-out v3 | `poc-samples/v3/` (.pdf → .locked) | C |
| AC5b bursty-benign negative | rsync/unzip/git-clone/npm-install 로그 (Ubuntu) | C |
| AC5c disclaimer | slide deck "evaluated on synthetic PoC, not real-world malware" | C |
| AC6 차단 검증 | `ac6-verify-block.sh` (`! kill -0 "$PID" 2>/dev/null` 또는 `! test -e /proc/$PID`) | A |
| AC7 발표 자료 | `docs/DEMO-SCRIPT.md` + `videos/demo.mp4` ≥ 30s | B (스크립트), 전원 (촬영) |
| AC8 stub 영속성 | 3 모드 (`driver`/`engine`/`both`) smoke pass | A + B + C |

---

## Risks & Mitigations (consensus-plan Risk Table 그대로 적용, owner 추가)

| Risk | Likelihood | Impact | Trigger | Mitigation | Owner |
|---|---|---|---|---|---|
| 팀원1(A) collector 지연 | High | Medium | Week 4 종료 시 `events.jsonl`조차 emit 안함 | Week 0 fanotify smoke 가동, `VELXOR_STUB=collector` 영속, collector "future work" 표기 | A |
| 팀원2(C) 모델 미완성 | Medium | Medium | Week 7 종료 시 학습 모델 없음 | `fallback_rules.py` 영속, `model_version: "rule-based-v1"` | C |
| fanotify mark/init 권한 실패 | Low | High | Week 0 AC 0.2 미달성 (root 권한 누락·커널 옵션 X·AppArmor 차단) | inotify 백업 경로 확정(0.6에서 캡처), collector 슬라이드 "permission caveats" 표기 | A |
| Collector crash / queue overflow | Low | High | 리허설 중 collector 1회 이상 sigsegv·`dropped_since_last` 폭증 | systemd `Restart=on-failure` + drop counter alert; 1회 crash 시 `VELXOR_STUB=collector` 데모 모드 | A |
| WS reconnect 불안정 | Medium | Low | 리허설 중 끊김 관측 | Rust 5초 replay (separate VecDeque) + UI exponential backoff + Electron dev 핫리로드 disable | B |
| 합성 PoC 일반화 의문 | Medium | Low | 발표 Q&A | AC5c slide note + "real-world testing future work" | C |
| 시간 예산 ≥115% 초과 (>145h) | High | Medium | 누적 hours > 145 | 사전 정의 deferral order 자동 적용 | 전원 |
| Week 0+1 부하 집중 (~21-23h) | High | Medium | 학기 전 주말 + Week 1 | Week 0를 학기 시작 ≥1주 전 완료 | A + B |
| Week 3 review 응답 부진 | Medium | Low | 48h 후 노트 0건 | v1.1 B 단독 발행 (Principle 4 의도된 trade) | B |
| v1.0 필드 잘못 타입 결정 | Low | Medium | Week 3 review에서 wrong-typed 발견 | additive `*_v2` 필드 추가 + 슬라이드 deprecated (escape hatch) | B |

---

## Files Created (planned, consensus-plan과 동일)

```
Velxor/
├── contracts/
│   └── interface-schema.md                  # B
├── rust-service/
│   ├── Cargo.toml                           # B
│   └── src/
│       ├── main.rs                          # B
│       ├── collector_source.rs              # A (libfanotify ↔ events.jsonl 어댑터)
│       ├── aggregator.rs                    # A
│       ├── classifier_client.rs             # B
│       └── ws_broadcaster.rs                # B
├── python-engine/
│   ├── app.py                               # C
│   ├── waitress_conf.py                     # C — Waitress threads=4 (cross-platform WSGI)
│   ├── features.py                          # C
│   ├── fallback_rules.py                    # C
│   ├── requirements.txt                     # C
│   └── model/                               # C
├── ui/
│   ├── package.json                         # B
│   ├── electron/main.ts                     # B
│   ├── src/
│   │   ├── App.tsx                          # B
│   │   ├── components/{ProcessTree,Timeline,DetailPanel,BlockButton}.tsx    # B
│   │   └── ws/client.ts                     # B
│   └── vite.config.ts                       # B
├── poc-samples/ransomware_simulator/{v1,v2,v3}/    # C
├── datasets/{positive,negative}/            # C
├── scripts/
│   ├── run-all.sh                           # B
│   ├── ws-record.sh                         # B
│   ├── poc-bench.sh                         # C
│   ├── eval-ac4.sh                          # C (tracing JSON → p99 출력)
│   ├── eval-ac5.sh                          # C
│   └── ac6-verify-block.sh                  # A
└── docs/
    ├── ARCHITECTURE.md                      # B
    ├── DEMO-SCRIPT.md                       # B
    ├── REHEARSAL-LOG.md                     # B + 전원
    ├── AC5-results.md                       # C
    ├── AC3-evidence/                        # B
    └── electron-ws-footgun.md               # B
```

---

## consensus-plan 원안 vs 본 분담 — 변경점

| 항목 | consensus-plan 원안 | 본 분담 |
|---|---|---|
| 역할 비대칭 | "본인=Rust+UI+Interface Contract owner" 70% 단독 | A/B/C 균등 ~40h씩 |
| Rust 책임 | "본인" 단독 | A(저수준 입력: driver_source/aggregator) + B(통합: classifier_client/ws_broadcaster) 분할 |
| UI | "본인" 단독 | B 단독 (계층 1개 집중) |
| Interface Contract | "본인" 단독 발행 | B 주관, A/C 동등 review input |
| v1.1 async 48h | "본인" 무응답 시 단독 발행 | B 무응답 시 단독 발행 |
| Hour 합계 | ~116-124h (ceiling 120h) | ~126h (ceiling 126h 공식 조정, deferral 트리거 145h에 미달) |

> 본 분담은 consensus-plan의 모든 기술 명세(Interface Contract, AC1-AC8, VELXOR_STUB, Walking Skeleton, Interface Evolution Gate, Stub Retention Gate, 합성 PoC 정책, `fallback_rules.py`, AC5a/b/c, 4-item Deferral Order, Risk Table)를 그대로 유지하며, 역할만 3인 균등 분담으로 재배치한다.

---

## Branch Strategy

- `main` — protected, 발표용 안정 브랜치. PR target.
- `devA` / `devB` / `devC` — 작업자 A/B/C 개별 작업 브랜치 (A→devA, B→devB, C→devC). 본인 owns 영역의 모든 PR은 자기 dev 브랜치에서 main으로.
- `dev1` / `dev2` / `dev3` — 레거시 (Initial commit 직후 생성), **신규 사용 중단**. 기존 PR 머지 후 정리 권장.
- Walking Skeleton 완성 시점 `walking-skeleton-v1` tag (AC1). 이후 `v1.1-schema`, `ac5-baseline` 같은 의미 단위 tag.
- 모든 main 머지는 3인 review 통과 필수 (CODEOWNERS 도입 권장 — `rust-service/{classifier_client.rs,ws_broadcaster.rs,main.rs}` → @B, `rust-service/{collector_source.rs,aggregator.rs}` → @A, `python-engine/` → @C). `kernel-driver/` 폴더는 마이그레이션으로 폐지.

---

## Status
- **계획 단계**: 🟡 PENDING APPROVAL
- **다음 단계**: 사용자 명시적 승인 후 Week 0 시작
- **승인 시 실행**: 별도 협의 (반복 작업 자동화/병렬 agent 활용 등 도구 선택은 승인 후 결정)
