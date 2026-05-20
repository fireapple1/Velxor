# Velxor 행위 기반 백신 — Consensus Plan (Draft v2)

## Metadata
- **Plan ID**: velxor-consensus-plan-v2
- **Source Spec**: `/home/lsy/ht/.omc/specs/deep-interview-velxor-behavior-vaccine.md`
- **Mode**: `--consensus --direct` (RALPLAN-DR short, non-interactive)
- **Generated**: 2026-05-20
- **Status**: DRAFT v2 — pending Architect/Critic re-review (iteration 2/5)
- **v1 → v2 diff**: incorporated Architect APPROVE-WITH-IMPROVEMENTS (5 items) + Critic REVISE (5 items)

## Requirements Summary (from spec, unchanged)
- Windows 커널 레벨 **랜섬웨어 행위 탐지** 데모급 백신 (학교/공모전)
- 4계층: C+WDK driver / Rust service / Python+AI / React+Electron UI
- 합성 PoC만, 한 학기 ~80-120 user-hours, 본인=Rust+UI+Contract, 팀원1=driver, 팀원2=Python+AI
- 통합 전략 = **Walking Skeleton + interface evolution gate** (v1 → v2 진화)

## RALPLAN-DR Summary (short mode)

### Principles (5)
1. **데모 임팩트가 1차 척도**.
2. **통합 리스크 0** — Week 1 v1-draft 스키마 + 4계층 stub end-to-end; **Week 3에 v1.1 additive evolution gate**.
3. **안전·재현성 우선** — 합성 PoC, held-out variant + bursty-benign negatives.
4. **팀원 통합 포인트는 명시하되 의존성은 격리** — stub code-path 영속 (env flag `VELXOR_STUB`); teammate review = **async 48h, 무응답 시 본인 단독 진행**.
5. **시간 제약 존중** — ≤120 user-hours, 명시적 hour ledger + 사전 정의된 deferral order.

### Decision Drivers (top 3)
1. **시간 제약**: 한 학기, 주당 ~10h, 총 ≤120h
2. **통합 위험**: 4계층 / 3 언어 / kernel-userspace 경계 / 2 팀원
3. **시연 임팩트**: ≤1초 안에 wow 모먼트

### Viable Options

**Option A: Walking Skeleton + Interface Evolution Gate (CHOSEN)**
- Week 0: 환경 설치만 (6-8h, 학기 전 주말).
- Week 1: v1-**draft** 스키마 + 4계층 stub end-to-end (~15h on top of Week 0).
- Week 3: **async 48h v1.1 review** — driver/engine 팀원이 "missing/wrong field" 노트 제출, 본인이 additive-only v1.1 발행. 무응답 시 그대로 진행.
- Stub Deprecation Gate: 각 계층의 실제 구현 도착 시 stub은 **삭제하지 않고 env flag `VELXOR_STUB=driver|engine|both`로 재활성 가능한 code path로 영속**.
- **Pros**: 통합 리스크 0, 매주 시연 가능, 팀원 지연 흡수, 스키마가 구현 학습과 함께 진화.
- **Cons**: Week 0+Week 1 합산 ~21-23h 전반 부하; teammate review 무응답 시 v1.1이 일방적 가능성 (Principle 4로 의도된 trade).

**Option B: Module-First (기획서 원안)** — invalidate: Week 5-6 통합 폭풍 위험.
**Option C: 본인 단독 4계층 stub + 팀 비-의존** — invalidate: ≥200h 추산, 시간 예산 위반.

**Convergence note**: v1.1 review gate는 Module-First의 좋은 본능(구현 학습으로부터의 인터페이스 진화)을 통합 폭풍 없이 흡수합니다. 즉 Walking Skeleton + v1.1 = pure WS와 Module-First 사이의 의도된 hybrid.

## Acceptance Criteria (spec AC1-AC8 + AC5a/b + 검증 강화)
- **AC1**: 본인 walking skeleton 시연 → 검증 = (a) `scripts/run-all.sh` exit 0, (b) `scripts/ws-record.sh` 캡처에 `node_add { event_type: "FileWrite" }` 메시지 포함, (c) 각 팀원이 본인 머신에서 `run-all.sh` 재실행 시 동일 결과. 통과 시 git tag `walking-skeleton-v1`.
- **AC2**: `scripts/poc-bench.sh` → wall-clock < 1s for 300 file ops (script returns 0).
- **AC3**: PoC 실행 화면 녹화 + **screenshot-diff** = 1초 이내 빨간 노드 + verdict panel 가시 (frame at t+1000ms).
- **AC4**: Rust `tracing` 측정에서 `event_received_ts → ws_sent_ts` p99 < 1000ms. **sub-budget**: classifier `/classify` p99 < 100ms (gunicorn + 2 workers).
- **AC5**: `scripts/eval-ac5.sh` → markdown 표 (TP, FP, accuracy). 통과: ≥9/10 TP, ≤1/10 FP.
  - **AC5a**: positive set ≥2 PoC variants (확장자/속도/사이즈 변형), ≥1은 학습 held-out.
  - **AC5b**: negative set에 bursty-but-benign workload 포함 (예: `robocopy /MIR` 대량 복사, 7zip 압축해제).
  - **AC5c (slide deck)**: 발표 자료에 "evaluated on synthetic PoC, not real-world malware" 명시.
- **AC6**: 차단 후 자동 검증 = `tasklist /fi "pid eq <PID>"` 빈 결과 또는 `ps -p <pid>` exit≠0.
- **AC7**: `docs/DEMO-SCRIPT.md` + 30-60초 영상 파일 존재.
- **AC8 (재정의)**: Stub code path가 env flag로 재활성 가능. 검증 = `VELXOR_STUB=both scripts/run-all.sh`로 모든 layer를 stub로 가동 → walking-skeleton-v1 smoke 통과.

## Hour Ledger (≤120h ceiling)
| Bucket | Hours | Notes |
|--------|-------|-------|
| Week 0 (tooling install, 학기 전 주말) | 6-8 | **추가 부하** (Week 1과 합산 ~21-23h 전반 집중) |
| Week 1 (v1-draft schema + 4 stubs + smoke) | 15 | |
| Week 2-3 (UI 깊이) | 20 | |
| Week 3 (v1.1 async review collation) | 2-3 | |
| Week 4-5 (실데이터 흐름, Rust 집계/burst/REST) | 20 | |
| Week 6-7 (합성 PoC + 데이터셋 + AC5a/b 확장) | 15 + **4-5** = ~20 | |
| Week 8-9 (통합, 차단, 리허설, AC5 측정) | 15 | |
| Week 10 (발표) | 10 | |
| Architect 추가 작업 (transport doc, gunicorn, WS framing, layout fix, stub cleanup) | **8-10** | 해당 주에 흡수 (별도 bucket X) |
| **Total** | **~116-124h** | **약간 over-budget — deferral order로 흡수** |

### Deferral Order (사전 정의, hour ledger 초과 시 자동 적용)
누적 시간이 계획 + 15%를 넘으면 아래 순서로 잘라낸다 (가장 먼저 잘리는 항목이 1번):
1. 2.4 사운드 효과 (Web Audio)
2. 2.2 Threat Timeline (D3) → 간단 리스트 뷰로 대체
3. 8.1 자동 차단 → Block 버튼 수동 차단만 유지
4. 10.2 백업 시연 영상

## Implementation Steps

### Week 0 — Tooling Install (학기 전 주말, 6-8h, 본인 단독)
- 0.1 VM 준비: Hyper-V/VMware로 Windows 10/11 격리 VM, snapshot 1개
- 0.2 `bcdedit /set testsigning on` 적용 + hello-world signed driver(WDK 샘플) 로드 검증 → **Week 0 AC**
- 0.3 `cargo new velxor-rust-service` 컴파일 성공 (deps: tokio, tokio-tungstenite, reqwest, serde, tracing)
- 0.4 `npm create vite@latest velxor-ui -- --template react-ts` + electron + `@xyflow/react` dev server 기동
- 0.5 Flask hello-world `/health` 200 응답 (venv + Flask + gunicorn)
- 0.6 ETW provider 스파이크: PowerShell `Get-WinEvent` 또는 `xperf`로 file I/O 이벤트 1개 캡처 → fallback 경로 사전 검증 (드라이버 fallback이 진짜로 가능한지 확인)

### Week 1 — Walking Skeleton (~15h)
- **1.1 Interface contract v1-draft** → `Velxor/contracts/interface-schema.md` (semver-locked: v1 = additive only)
  - **IOCTL `BehaviorEventV1`**:
    ```
    { schema_version: "1.0",
      seq: u64,                // monotonic per session
      dropped_since_last: u32, // kernel buffer pressure signal
      pid: u32, parent_pid: u32,
      image_path: string,
      event_type: enum(FileWrite|FileRename|ProcessCreate),
      file_path: string?,
      volume_id: string?,      // disambiguate across volumes
      op_detail: object?,      // typed sub-records per event_type
      ts_unix_ms: u64 }
    ```
  - **IOCTL 전송 방식**: `FltSendMessage` (kernel→user inverted call). 큐 깊이 1024, drop 시 `dropped_since_last` 증가.
  - **REST `POST /classify`** (Flask + gunicorn 2 workers, p99 < 100ms sub-budget):
    ```
    req: { events: BehaviorEventV1[], window_ms: u32 }
    resp: { verdict: enum(benign|ransomware), confidence: f32, evidence: string[],
            model_version: string }
    ```
  - **WS message** (server: tokio-tungstenite, replay buffer = 5-second sliding window, frame = JSON + `\n` delimiter):
    ```
    { schema_version: "1.0",
      seq: u64,
      type: enum(node_add|node_update|verdict|alert),
      payload: object }
    ```
  - **Evolution policy**: v1.x = additive only (new optional fields), v2 = breaking change, requires team sign-off.
- 1.2 Rust service stub: `events.jsonl` poll, REST stub call, WS server with replay buffer.
- 1.3 Python engine stub: Flask + gunicorn 2 workers, hard-coded `{verdict: "ransomware", 0.95}`.
- 1.4 UI stub: Electron + Vite + React Flow, WS client with reconnect (`Velxor/ui/`).
- 1.5 `scripts/run-all.sh` + `scripts/ws-record.sh` (records WS messages to file, used for AC1).
- **1.6 Mechanical schema acknowledgment**: 팀원1/팀원2가 `interface-schema.md` 읽고 한 줄 "compiles in my head" 응답. 의미 검토는 Week 3.

### Week 2-3 — UI 깊이 + 인터페이스 진화 (~20h + 2-3h review)
- 2.1 ProcessTree (`@xyflow/react`) — **batched dagre**: 새 노드가 기존 부모 아래 추가될 때만 dagre 재실행, 동일 부모의 후속 자식은 manual incremental positioning. 300 nodes/1s 시 jank 회피.
- 2.2 Threat Timeline (D3 또는 visx) — deferral 후보 #2
- 2.3 Detail Panel
- 2.4 Block/Allow 버튼 — deferral 후보 #1 (사운드만 deferral)
- 2.5 WS reconnect 안정화: **Electron+Vite 핫리로드 vs preload context isolation** footgun pin (관련 PR/이슈 링크 `docs/electron-ws-footgun.md`로 기록); exponential backoff + replay buffer.
- **2.6 Week 3 v1.1 async review (~2-3h)**:
  - 본인 → 팀원1/팀원2에게 v1-draft 전달, "이 스키마의 부족하거나 잘못된 점 1개씩 PR comment로" 요청, **48h deadline**
  - 48h 후: 본인이 받은 노트만 통합해 **additive-only v1.1** 발행. 무응답 팀원의 입력은 다음 review로.

### Week 4-5 — 실데이터 흐름 (~20h, 팀과 통합 포인트)
- 4.1 Rust: tokio sliding window (1s/5s) per PID
- 4.2 Rust: burst detection (FileWrite≥50/1s OR FileRename≥30/1s)
- 4.3 Rust: REST → `/classify` + verdict cache
- 4.4 Rust: WS broadcast + **replay buffer = 5초 sliding window** (>1000 events 가능)
- **4.5 통합 포인트 (드라이버)** — 팀원1 driver가 도착하면 본인 Rust 입력 어댑터 교체. **미도착 시**: stub code path 영속 (`VELXOR_STUB=driver`), 진행 차단 없음.
- **4.6 통합 포인트 (모델)** — 팀원2 모델 도착하면 Python `/classify` 응답 교체. **미도착 시**: rule-based fallback (write rate ≥50/1s → ransomware 0.9). 동일 인터페이스 유지.

### Week 6-7 — 합성 PoC + 데이터셋 (~15-20h)
- 6.1 `poc-samples/ransomware_simulator/v1/`: .docx → .docx.enc rename + 32B prefix write, 300 files/1s
- **6.2 AC5a variants**:
  - `v2/`: .txt → .crypted (다른 확장자), 500 files/0.8s
  - `v3/`: .pdf → .locked, 200 files/2s (느린 burst, hardest case)
- 6.3 positive 데이터셋 생성기: v1 + v2 학습용, **v3 held-out**
- **6.4 AC5b bursty-benign 생성**: `robocopy /MIR src dst` 대량 복사, 7zip 압축해제 → negative 로그
- 6.5 데이터셋 인계 + 팀원2 학습 트리거 또는 rule-based fallback 검증
- 6.6 UI 통합 검증

### Week 8-9 — 통합 + 차단 + AC5 측정 (~15h)
- **8.1 자동 차단** (deferral 후보 #3) — Rust `TerminateProcess(pid)` (Windows API) 또는 UI Block 버튼 → IPC → kill
- 8.2 `docs/DEMO-SCRIPT.md` (1분 흐름)
- 8.3 UI 폴리싱
- **8.4 AC5 측정**: `scripts/eval-ac5.sh` — v1+v2 모델 학습, v3 held-out + robocopy/7z negative로 평가, markdown 표 결과 저장
- 8.5 **사전 리허설 3회 (Week 9)**, snapshot rollback 시간 측정 (목표 < 60s/round) → `docs/REHEARSAL-LOG.md`

### Week 10 — 발표 준비 (~10h)
- 10.1 슬라이드 (아키텍처, 데이터 전략, AC5 결과, **"evaluated on synthetic PoC" 명시**)
- 10.2 백업 시연 영상 — deferral 후보 #4
- 10.3 발표 리허설

## Risks and Mitigations (measurable triggers)

| Risk | Likelihood | Impact | Trigger | Mitigation |
|------|-----------|--------|---------|------------|
| 팀원1 driver 지연 | High | Medium | Week 4 종료 시 driver가 `events.jsonl`도 아직 못 emit | Week 0 ETW provider 스파이크 결과로 즉시 ETW fallback 가동 (`VELXOR_STUB=driver`); driver는 시연에서 stub 대체 |
| 팀원2 모델 미완성 | Medium | Medium | Week 7 종료 시 학습된 모델 없음 | Rule-based fallback (write rate ≥50/1s → ransomware 0.9) 영속화; `model_version: "rule-based-v1"` |
| Test signing → driver 로드 실패 | Medium | High | Week 0 AC 미달성 | ETW 백업 경로로 전환; driver 컴포넌트는 "future work" 표기 |
| Driver crash → BSOD | Low | High | 리허설 중 BSOD 발생 | VM snapshot, rollback < 60s; 리허설 3회 중 1회라도 BSOD 시 `VELXOR_STUB=driver` 모드로 데모 시나리오 변경 |
| WebSocket reconnect 불안정 | Medium | Low | 리허설에서 끊김 관측 | Replay 5초 buffer + UI exponential backoff + Electron+Vite 핫리로드 disable in dev for WS test |
| 합성 PoC 일반화 의문 | Medium | Low | 발표장 Q&A | AC5c slide deck 노트 + "real-world testing is future work" |
| **시간 예산 ≥115% 초과** | **High** | **Medium** | **Week N 누적 hours > planned×1.15** | **사전 정의 deferral order로 자동 절단** (사운드 → Timeline → 자동차단 → 백업영상) |
| Week 0+1 부하 집중 (~21-23h) | High | Medium | 학기 전 주말 + Week 1에 결합 | Week 0를 학기 시작 ≥1주 전에 완료, 학기 중에는 schema/stub만 |
| Week 3 review 응답 부진 | Medium | Low | 48h 후 teammate 노트 0건 | v1.1을 본인 단독 발행 (Principle 4); 의도된 trade |

## Verification Steps (per AC, concrete)
| AC | 검증 artifact |
|----|--------------|
| AC1 | `scripts/run-all.sh` exit 0; `scripts/ws-record.sh` 캡처에 `node_add { event_type: "FileWrite" }`; teammate 머신 재현; git tag `walking-skeleton-v1` |
| AC2 | `scripts/poc-bench.sh` exit 0 (wall-clock < 1s for 300 ops 측정 인쇄) |
| AC3 | OBS 영상 + frame-at-1000ms screenshot in `docs/AC3-evidence/` |
| AC4 | `tracing` JSON log, p99 계산 스크립트 출력 (event→ws p99 < 1000ms, classify p99 < 100ms) |
| AC5/5a/5b | `scripts/eval-ac5.sh` 산출 `docs/AC5-results.md` (held-out variant 표시, bursty-benign workload 라벨) |
| AC5c | `slides.pdf` page X에 disclaimer text |
| AC6 | block 후 `tasklist /fi "pid eq <PID>"` 빈 결과 (test 스크립트 자동화) |
| AC7 | `docs/DEMO-SCRIPT.md` + `videos/demo.mp4` (≥30s) |
| AC8 | `VELXOR_STUB=both scripts/run-all.sh` → walking-skeleton-v1 smoke 통과 |

## ADR
**Decision**: Walking Skeleton + Interface Evolution Gate. 본인 = interface contract owner; Week 0 환경 셋업 → Week 1 v1-draft + 4계층 stub end-to-end → Week 3 async v1.1 review (48h, 무응답 시 본인 단독 진행) → Week 4+ stub-deprecation gate(stub code path는 env flag로 영속) → Week 8-9 통합/측정 → Week 10 발표.

**Drivers**:
1. 시간 제약 (≤120h, deferral order 사전 정의)
2. 통합 리스크 최소화 (Week 1 skeleton + Week 3 interface evolution)
3. 시연 임팩트 (≤1초 wow 모먼트, AC3/AC4)
4. **팀원 통합 포인트는 명시하되 의존성 격리** (stub fallback 영속, 무응답 허용)

**Alternatives considered**:
- Module-First (Option B) — invalidate: 통합 폭풍, **Convergence note**: v1.1 review가 Module-First의 인터페이스 진화 본능을 흡수.
- 본인 단독 4계층 (Option C) — invalidate: ≥200h.
- 실제 ransomware 샘플 — invalidate (spec Round 4 Contrarian).
- AI 대신 룰 기반 only — fallback으로만 보존.

**Why chosen**: 시간/통합/시연/팀원 4 driver를 모두 충족하는 유일한 옵션. v1.1 evolution gate가 pure WS의 "premature freeze" 약점을 완화하면서도 Module-First의 통합 폭풍을 회피.

**Consequences**:
- 긍정: 본인이 system integrator 역할, 매주 시연 가능, stub fallback이 곧 demo backup.
- 부정: Week 0+1 부하 집중 (~21-23h 전반); 무응답 팀원의 입력은 자동 누락(Principle 4로 의도된 trade).

**Follow-ups**:
- Week 0 종료: tooling install AC + ETW 스파이크 sign-off
- Week 1 종료: walking-skeleton-v1 git tag
- Week 3 종료: v1.1 schema published
- Week 4 종료: 첫 정량 측정 (AC4 p99 latency)
- Week 8 종료: AC5 측정 결과 발표
- Week 9 종료: 3회 리허설 + snapshot rollback 시간 기록

## Status
DRAFT v2 — Architect/Critic 재검토 대기.

## Changelog
- **v1 → v2** (architect + critic items applied):
  - Added Week 0 (additive ~6-8h, tooling install)
  - Contract status v1-draft + Week 3 async 48h evolution gate
  - Stub Deprecation Gate redefined as code-path retention via `VELXOR_STUB` env flag
  - IOCTL schema: seq, dropped_since_last, volume_id, minor schema_version; transport = `FltSendMessage` documented
  - REST: gunicorn 2 workers + classifier p99 < 100ms sub-budget under AC4
  - WS replay buffer: 100 → 5-second sliding window (≥1000 events); seq added; framing specified
  - UI: batched dagre on parent additions only; Electron+Vite WS footgun pinned to docs
  - AC5 strengthened: AC5a held-out variant, AC5b bursty-benign negatives, AC5c slide disclaimer
  - Risk table: every mitigation now has measurable trigger + deferral order
  - ADR Driver 4 rewording: "통합 포인트는 명시하되 의존성은 격리"
  - AC1/AC3/AC6/AC8 verification specified concretely (scripts, flags, screenshots)
  - Hour ledger added (~116-124h) with explicit deferral order
  - Convergence note added to Alternatives section
