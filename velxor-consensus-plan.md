# Velxor 행위 기반 백신 — Consensus Plan (Final)

## Metadata
- **Plan ID**: velxor-consensus-plan
- **Source Spec**: `/home/lsy/ht/.omc/specs/deep-interview-velxor-behavior-vaccine.md`
- **Mode**: `--consensus --direct` (RALPLAN-DR short, non-interactive)
- **Generated**: 2026-05-20
- **Status**: 🟡 **PENDING APPROVAL** (no auto-execution; user must explicitly approve execution path)
- **Consensus**: reached at iteration 2/5
  - Iter 1: Architect APPROVE-WITH-IMPROVEMENTS, Critic REVISE → v1 → v2
  - Iter 2: Architect APPROVE-WITH-MINOR-IMPROVEMENTS, Critic APPROVE-WITH-MINOR-IMPROVEMENTS → polish pass → final

## Requirements Summary (from spec)
- Windows 커널 레벨 **랜섬웨어 행위 탐지** 데모급 백신 (학교/공모전)
- 4계층: C+WDK 커널 드라이버 / Rust 유저모드 서비스 / Python+AI 분석 엔진 / React+Electron UI
- **합성 PoC만** (학습/시연 자체생성), 한 학기 ~80-120 user-hours
- 본인=Rust+UI+Interface Contract owner, 팀원1=드라이버, 팀원2=Python+AI
- 통합 전략 = **Walking Skeleton + Interface Evolution Gate**

## RALPLAN-DR Summary (short mode)

### Principles (5)
1. **데모 임팩트가 1차 척도**. 코드 우아함·정확도는 부산물.
2. **통합 리스크 0** — Week 1 v1-draft 스키마 + 4계층 stub end-to-end, **Week 3 v1.1 additive evolution gate**.
3. **안전·재현성 우선** — 합성 PoC, held-out variant + bursty-benign negatives.
4. **팀원 통합 포인트는 명시하되 의존성은 격리** — stub code-path를 env flag `VELXOR_STUB`로 영속 보존, teammate review는 **async 48h, 무응답 시 본인 단독 진행**.
5. **시간 제약 존중** — ≤120 user-hours, 명시적 hour ledger + 사전 정의된 deferral order(>115% 트리거).

### Decision Drivers (top 3)
1. **시간 제약**: 한 학기, 주당 ~10h, 총 ≤120h
2. **통합 위험**: 4계층 / 3 언어 / kernel-userspace 경계 / 2 팀원
3. **시연 임팩트**: ≤1초 안에 wow 모먼트

### Viable Options
**Option A — Walking Skeleton + Interface Evolution Gate (CHOSEN)**
- Week 0: 환경 설치만 (6-8h, 학기 전 주말, additive).
- Week 1: v1-**draft** 스키마 + 4계층 stub end-to-end (~15h).
- Week 3: **async 48h v1.1 review** — driver/engine 팀원이 "missing/wrong field" 노트 제출, 본인이 additive-only v1.1 발행. 무응답 시 그대로 진행.
- **Stub Retention Gate** (이전 이름 "Stub Deprecation Gate"에서 수정): 각 계층 실제 구현 도착 시 stub은 **삭제하지 않고** env flag `VELXOR_STUB=driver|engine|both`로 재활성 가능한 code path로 영속.
- Pros: 통합 리스크 0, 매주 시연 가능, 팀원 지연 흡수, 스키마가 구현 학습과 함께 진화.
- Cons: Week 0+Week 1 합산 ~21-23h 전반 부하; teammate review 무응답 시 v1.1 일방적 발행 가능성(Principle 4로 의도된 trade).

**Option B — Module-First (기획서 원안)**: invalidate — Week 5-6 통합 폭풍 위험.
**Option C — 본인 단독 4계층 + 팀 비-의존**: invalidate — ≥200h, 예산 위반.

**Convergence note**: v1.1 review gate는 Module-First의 좋은 본능(구현 학습으로부터의 인터페이스 진화)을 통합 폭풍 없이 흡수합니다. 즉 Walking Skeleton + v1.1 = pure WS와 Module-First 사이의 의도된 hybrid.

## Acceptance Criteria

- **AC1 — Walking Skeleton 시연**: 검증 = (a) `scripts/run-all.sh` exit 0, (b) `scripts/ws-record.sh` 캡처에 `node_add { event_type: "FileWrite" }` 메시지, (c) 각 팀원이 본인 머신에서 `run-all.sh` 재실행 시 동일 결과. 통과 시 git tag `walking-skeleton-v1`.
- **AC2 — PoC 동작**: `scripts/poc-bench.sh` → wall-clock < 1s for 300 file ops (script exit 0).
- **AC3 — 탐지 시연 화면**: PoC 실행 → OBS 영상 + **frame-at-1000ms screenshot**에 빨간 노드 + verdict panel 가시.
- **AC4 — 지연시간**: Rust `tracing` 로그에서 `event_received_ts → ws_sent_ts` **p99 < 1000ms**. **Sub-budget**: classifier `/classify` **p99 < 100ms** (gunicorn 2 workers).
- **AC5 — 분류 정확도**: `scripts/eval-ac5.sh` → markdown 표. 통과: **≥9/10 TP, ≤1/10 FP**.
  - **AC5a**: positive set ≥2 PoC variants (확장자/속도/사이즈 변형); ≥1 (`v3 .pdf → .locked, 200 files/2s`)은 학습 held-out.
  - **AC5b**: negative set에 bursty-but-benign workload 포함 (`robocopy /MIR`, 7zip 압축해제).
  - **AC5c (slide deck)**: 발표 자료에 "evaluated on synthetic PoC, not real-world malware" 명시.
  - **AC5 정책**: held-out v3에서 ≥9/10 미달 시 임계값 완화 X, 결과 그대로 슬라이드에 기록(honest reporting).
- **AC6 — 차단 검증**: 차단 후 `tasklist /fi "pid eq <PID>"` 빈 결과 자동 확인 스크립트.
- **AC7 — 발표 자료**: `docs/DEMO-SCRIPT.md` + 30-60초 영상 파일 존재.
- **AC8 — Stub 영속성**: Stub code path가 env flag로 재활성. 검증 = `VELXOR_STUB=both`, `VELXOR_STUB=driver`, `VELXOR_STUB=engine` **3가지 단독 모드 모두** smoke test 통과.

## Hour Ledger (≤120h ceiling)

| Bucket | Hours | Notes |
|--------|-------|-------|
| Week 0 (tooling install, 학기 전 주말) | 6-8 | **Additive** (Week 1과 합산 ~21-23h 전반 집중) |
| Week 1 (v1-draft schema + 4 stubs + smoke) | 15 | |
| Week 2-3 (UI 깊이) | 20 | |
| Week 3 (v1.1 async review collation) | 2-3 | |
| Week 4-5 (Rust 집계/burst/REST + 통합 포인트) | 20 | |
| Week 6-7 (합성 PoC v1/v2/v3 + 데이터셋 + AC5a/b) | 20 | (~15 base + ~5 variant/bursty-benign) |
| Week 8-9 (통합, 차단, 리허설, AC5 측정) | 15 | |
| Week 10 (발표) | 10 | |
| Architect/Critic 추가 작업 (transport doc, gunicorn, WS framing/replay separate, stub env flag plumbing) | 8-10 | 해당 주에 흡수 |
| **Total** | **~116-124h** | **ceiling 120h 대비 +0~+3%, deferral 트리거(>115%, 즉 >138h)에 미달 → 자동 절단 불필요** |

### Deferral Order (사전 정의)
누적 hours > planned×1.15 (즉 ≥138h) 시 아래 순서로 자른다:
1. 2.4 사운드 효과 (Web Audio)
2. 2.2 Threat Timeline (D3) → 간단 리스트 뷰로 대체
3. 8.1 자동 차단 → Block 버튼 수동 차단만 유지
4. 10.2 백업 시연 영상

## Implementation Steps

### Week 0 — Tooling Install (학기 전 주말, 6-8h)
- 0.1 Hyper-V/VMware로 Windows 10/11 격리 VM + snapshot 1
- 0.2 `bcdedit /set testsigning on` + WDK 샘플 hello-world signed driver 로드 검증 → **Week 0 AC**
- 0.3 `cargo new velxor-rust-service` 컴파일 OK (deps: tokio, tokio-tungstenite, reqwest, serde, tracing)
- 0.4 `npm create vite@latest velxor-ui -- --template react-ts` + electron + `@xyflow/react` dev server
- 0.5 Flask `/health` 200 (venv + Flask + gunicorn)
- 0.6 **ETW provider 스파이크**: PowerShell `Get-WinEvent` 또는 `xperf`로 file I/O 이벤트 1개 캡처 → driver fallback 경로 실증

### Week 1 — Walking Skeleton (~15h)
- **1.1 Interface Contract v1-draft** → `Velxor/contracts/interface-schema.md` (semver: v1 = additive only)

  **IOCTL `BehaviorEventV1`**:
  ```
  { schema_version: "1.0",
    seq: u64,                  // monotonic per session
    dropped_since_last: u32,   // kernel buffer pressure signal
    pid: u32, parent_pid: u32,
    image_path: string,
    event_type: enum(FileWrite|FileRename|ProcessCreate),
    file_path: string?,
    volume_id: string?,        // disambiguate across volumes
    op_detail: object?,
    ts_unix_ms: u64 }
  ```

  **IOCTL 전송**: `FltSendMessage` (kernel→user inverted call). 큐 깊이 1024, drop 시 `dropped_since_last` 증가.
  ⚠️ **`FltSendMessage`는 user-mode 응답까지 kernel을 블록할 수 있음**. user-mode reader는 별도 thread에서 dequeue하여 burst 시 kernel-side stall 회피.

  **REST `POST /classify`** (Flask + gunicorn 2 workers, classifier p99 < 100ms sub-budget):
  ```
  req:  { events: BehaviorEventV1[], window_ms: u32 }
  resp: { verdict: enum(benign|ransomware), confidence: f32, evidence: string[],
          model_version: string }
  ```

  **WS message** (server: tokio-tungstenite, replay = 5초 sliding window in separate `VecDeque`, frame = JSON + `\n`):
  ```
  { schema_version: "1.0",
    seq: u64,
    type: enum(node_add|node_update|verdict|alert),
    payload: object }
  ```

  **Evolution policy**:
  - v1.x = additive only (새 optional field만)
  - v2 = breaking change, team sign-off 필요
  - **Escape hatch for wrong-typed v1.0 field**: 같은 의미의 새 필드(예: `volume_id_v2: {id, fs_type}`)를 additive로 추가 + 기존 필드는 slide deck에서만 deprecated 표기 (런타임 호환성 유지). v2 진입 없이 잘못된 타입 회복.

  **`VELXOR_STUB` env flag semantics**:
  | Value | Rust 측 | Python 측 |
  |-------|---------|-----------|
  | `unset` (default) | 실제 IOCTL 어댑터 사용 | 학습된 모델 또는 rule-based fallback |
  | `driver` | `events.jsonl` 폴링 (driver stub) | 변경 없음 |
  | `engine` | 변경 없음 | Week 1 하드코드 verdict `{ransomware, 0.95}` |
  | `both` | `events.jsonl` 폴링 | 하드코드 verdict |

- 1.2 Rust service stub (`Velxor/rust-service/`): `events.jsonl` poll, REST stub call, WS server with separate replay `VecDeque`.
- 1.3 Python engine stub (`Velxor/python-engine/`): Flask + gunicorn 2 workers, 하드코드 verdict.
- 1.4 UI stub (`Velxor/ui/`): Electron + Vite + React Flow, WS client with reconnect.
- 1.5 `scripts/run-all.sh` + `scripts/ws-record.sh` (WS 메시지 캡처용, AC1 검증).
- 1.6 **Mechanical schema acknowledgment**: 팀원1/팀원2가 schema 읽고 "컴파일 가능" 한 줄 응답. 의미 검토는 Week 3.

### Week 2-3 — UI 깊이 + 인터페이스 진화 (~20h + 2-3h review)
- 2.1 ProcessTree (`@xyflow/react`) — **batched dagre**: 새 자식이 기존 부모에 추가될 때만 dagre 재실행, 동일 부모의 후속 자식은 manual incremental positioning. 300 nodes/1s 시 jank 회피.
- 2.2 Threat Timeline (D3 또는 visx) — **Deferral 후보 #2**
- 2.3 Detail Panel (PID, image, AI verdict, evidence)
- 2.4 Block/Allow 버튼 — 사운드는 **Deferral 후보 #1**
- 2.5 WS reconnect 안정화: Rust 측 broadcast channel = live fan-out 전용, **별도 `VecDeque<WsMessage>` lock-protected = 5초 sliding window replay**. UI exponential backoff. Electron+Vite dev 핫리로드 vs preload context isolation **footgun을 `docs/electron-ws-footgun.md`에 기록**.
- **2.6 Week 3 v1.1 async review (~2-3h)**:
  - 본인 → 팀원1/팀원2에게 v1-draft 전달, "이 스키마의 부족하거나 잘못된 점 1개씩 PR comment로" 요청, **48h deadline**.
  - 48h 후: 본인이 받은 노트만 통합해 **additive-only v1.1** 발행. 무응답 팀원의 입력은 다음 review로.

### Week 4-5 — 실데이터 흐름 (~20h)
- 4.1 Rust: tokio sliding window (1s/5s) per PID
- 4.2 Rust: burst detection (FileWrite≥50/1s OR FileRename≥30/1s)
- 4.3 Rust: REST → `/classify` + verdict cache per PID
- 4.4 Rust: **tokio broadcast channel = live fan-out + 별도 `VecDeque` = 5초 replay (lock-protected, >1000 events 가능)**
- **4.5 통합 포인트 (드라이버)** — 팀원1 driver 도착 시 본인 Rust 입력 어댑터 교체. 미도착 시 `VELXOR_STUB=driver` 영속, 진행 차단 없음.
- **4.6 통합 포인트 (모델)** — 팀원2 모델 도착 시 `/classify` 응답 교체. 미도착 시 rule-based fallback (write rate ≥50/1s → ransomware 0.9), 동일 인터페이스 유지.

### Week 6-7 — 합성 PoC + 데이터셋 (~20h)
- 6.1 `poc-samples/ransomware_simulator/v1/`: .docx → .docx.enc rename + 32B prefix write, 300 files/1s
- **6.2 AC5a variants**:
  - `v2/`: .txt → .crypted, 500 files/0.8s
  - `v3/`: .pdf → .locked, 200 files/2s (hardest, **held-out**)
- 6.3 positive 데이터셋 생성기 (v1+v2 학습용, v3 held-out)
- **6.4 AC5b bursty-benign 생성**: `robocopy /MIR src dst`, 7zip 압축해제 → negative 로그
- 6.5 데이터셋 인계 + 팀원2 학습 트리거 (또는 rule-based fallback 영속)
- 6.6 UI 통합 검증 (full pipeline 1회)

### Week 8-9 — 통합 + 차단 + AC5 측정 (~15h)
- **8.1 자동 차단** (Deferral 후보 #3) — Rust → `TerminateProcess(pid)` 또는 UI Block 버튼 → IPC → kill
- 8.2 `docs/DEMO-SCRIPT.md` (1분 흐름)
- 8.3 UI 폴리싱 (애니메이션, 색상, 타이밍)
- **8.4 AC5 측정**: `scripts/eval-ac5.sh` — v1+v2 학습, v3 held-out + robocopy/7z negative로 평가, `docs/AC5-results.md` 산출.
- 8.5 사전 리허설 **3회 (Week 9)**, snapshot rollback 시간 측정 (목표 < 60s/round) → `docs/REHEARSAL-LOG.md`. BSOD 발생 시 즉시 `VELXOR_STUB=driver` 모드로 데모 시나리오 변경.

### Week 10 — 발표 준비 (~10h)
- 10.1 슬라이드 (아키텍처, 데이터 전략, AC5 결과, **AC5c disclaimer**)
- 10.2 백업 시연 영상 — Deferral 후보 #4
- 10.3 발표 리허설 1-2회

## Files Created (planned)
```
Velxor/
├── contracts/
│   └── interface-schema.md
├── rust-service/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── driver_source.rs      # events.jsonl ↔ IOCTL adapter (env flag switch)
│       ├── aggregator.rs         # sliding window per PID
│       ├── classifier_client.rs
│       └── ws_broadcaster.rs     # broadcast + separate VecDeque replay
├── python-engine/
│   ├── app.py
│   ├── gunicorn_conf.py
│   ├── features.py
│   ├── fallback_rules.py         # rule-based fallback (AC8 path)
│   ├── requirements.txt
│   └── model/                    # 팀원2 책임
├── ui/
│   ├── package.json
│   ├── electron/main.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/{ProcessTree,Timeline,DetailPanel,BlockButton}.tsx
│   │   └── ws/client.ts          # exponential backoff + replay-aware
│   └── vite.config.ts
├── poc-samples/ransomware_simulator/{v1,v2,v3}/
├── datasets/{positive,negative}/
├── scripts/
│   ├── run-all.sh
│   ├── ws-record.sh
│   ├── poc-bench.sh
│   ├── eval-ac5.sh
│   └── ac6-verify-block.sh
└── docs/
    ├── ARCHITECTURE.md
    ├── DEMO-SCRIPT.md
    ├── REHEARSAL-LOG.md
    ├── AC5-results.md
    ├── AC3-evidence/             # frame screenshots
    └── electron-ws-footgun.md
```

## Risks & Mitigations (measurable triggers)

| Risk | Likelihood | Impact | Trigger | Mitigation |
|------|-----------|--------|---------|------------|
| 팀원1 driver 지연 | High | Medium | Week 4 종료 시 driver가 `events.jsonl`조차 emit 안함 | Week 0 ETW 스파이크 결과 즉시 가동; `VELXOR_STUB=driver` 영속; driver는 "future work" |
| 팀원2 모델 미완성 | Medium | Medium | Week 7 종료 시 학습 모델 없음 | rule-based fallback 영속 (`fallback_rules.py`), `model_version: "rule-based-v1"` |
| Test signing → driver 로드 실패 | Medium | High | Week 0 AC 0.2 미달성 | ETW 백업 경로 확정; driver 컴포넌트 슬라이드에 "future work" 표기 |
| Driver crash → BSOD | Low | High | 리허설 중 BSOD 1회 이상 | VM snapshot rollback (<60s); 리허설 3회 중 1회 BSOD 시 `VELXOR_STUB=driver` 데모 모드 |
| WS reconnect 불안정 | Medium | Low | 리허설 중 끊김 관측 | Rust 5초 replay (separate VecDeque) + UI exponential backoff + Electron dev 핫리로드 disable |
| 합성 PoC 일반화 의문 | Medium | Low | 발표 Q&A | AC5c slide note + "real-world testing future work" |
| **시간 예산 ≥115% 초과 (>138h)** | **High** | **Medium** | **누적 hours > 138** | **사전 정의 deferral order 자동 적용** (사운드 → Timeline → 자동차단 → 백업영상) |
| Week 0+1 부하 집중 (~21-23h) | High | Medium | 학기 전 주말 + Week 1 | Week 0를 학기 시작 ≥1주 전 완료, schema/stub만 Week 1 |
| Week 3 review 응답 부진 | Medium | Low | 48h 후 teammate 노트 0건 | v1.1 본인 단독 발행 (Principle 4 — 의도된 trade) |
| v1.0 필드 잘못 타입 결정 | Low | Medium | Week 3 review에서 wrong-typed 발견 | additive `*_v2` 필드 추가 + 슬라이드에서만 deprecated (escape hatch) |

## Verification Steps (per AC)

| AC | 검증 artifact |
|----|--------------|
| AC1 | `run-all.sh` exit 0; `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}`; teammate 재현; git tag `walking-skeleton-v1` |
| AC2 | `poc-bench.sh` exit 0 (wall-clock < 1s for 300 ops 출력) |
| AC3 | OBS 영상 + `docs/AC3-evidence/frame-1000ms.png` |
| AC4 | `tracing` JSON 분석 스크립트 출력 (event→ws p99<1000ms, classify p99<100ms) |
| AC5/5a/5b/5c | `docs/AC5-results.md` (held-out v3 표시, robocopy/7z workload 라벨), slides.pdf 페이지 X disclaimer |
| AC6 | `scripts/ac6-verify-block.sh` 자동화 (`tasklist /fi "pid eq <PID>"` 빈 결과 또는 ps exit≠0) |
| AC7 | `docs/DEMO-SCRIPT.md` + `videos/demo.mp4` (≥30s) |
| AC8 | `VELXOR_STUB=both`, `VELXOR_STUB=driver`, `VELXOR_STUB=engine` 3 모드 모두 `run-all.sh` smoke pass |

## ADR

**Decision**: Walking Skeleton + Interface Evolution Gate. 본인 = interface contract owner; Week 0 환경 셋업 (additive) → Week 1 v1-draft + 4계층 stub end-to-end → Week 3 async v1.1 review (48h, 무응답 시 본인 단독) → Week 4+ Stub Retention Gate(env flag `VELXOR_STUB`로 stub code-path 영속) → Week 8-9 통합/측정 → Week 10 발표.

**Drivers**:
1. 시간 제약 (≤120h ceiling, deferral 트리거 138h)
2. 통합 리스크 최소화 (Week 1 skeleton + Week 3 evolution gate)
3. 시연 임팩트 (≤1초 wow 모먼트, AC3/AC4)
4. **팀원 통합 포인트는 명시, 의존성은 격리** (stub 영속 + 무응답 허용)

**Alternatives considered**:
- Module-First (Option B) — invalidate: 통합 폭풍. **Convergence note**: v1.1 review가 Module-First의 인터페이스 진화 본능을 흡수.
- 본인 단독 4계층 (Option C) — invalidate: ≥200h.
- 실제 ransomware 샘플 — invalidate (spec Round 4 Contrarian).
- AI 대신 룰 기반 only — fallback으로만 보존; primary는 학습 모델.

**Why chosen**: 시간/통합/시연/팀원 4 driver를 모두 충족하는 유일한 옵션. v1.1 evolution gate가 pure WS의 "premature freeze" 약점을 완화하면서도 Module-First의 통합 폭풍을 회피. Stub Retention Gate가 팀원 지연을 흡수하면서도 통합 포인트 검증 가능성을 유지.

**Consequences**:
- 긍정: 본인이 system integrator 역할 (학습 큼), 매주 시연 가능, stub fallback이 곧 demo backup, 인터페이스 스키마가 산출물.
- 부정: Week 0+1 부하 집중 (~21-23h); 무응답 팀원의 입력은 자동 누락(Principle 4 의도된 trade); v1.0 wrong-typed 필드는 `*_v2` parallel field로 우회해야 함 (escape hatch).

**Follow-ups**:
- Week 0 종료: tooling install AC (0.1-0.6) + ETW 스파이크 sign-off
- Week 1 종료: walking-skeleton-v1 git tag
- Week 3 종료: v1.1 schema published
- Week 4 종료: 첫 AC4 정량 측정 (event→ws p99, classify p99)
- Week 8 종료: AC5 측정 결과 (`docs/AC5-results.md`)
- Week 9 종료: 3회 리허설 + snapshot rollback timing

## Consensus Audit Trail

### Iteration 1
- **Planner**: v1 draft (`.omc/drafts/velxor-consensus-plan-v1.md`)
- **Architect**: APPROVE-WITH-IMPROVEMENTS — Week 0, v1-draft contract, Stub Deprecation Gate, per-layer fixes (IOCTL seq/dropped/volume_id/schema_version + FltSendMessage, REST gunicorn + p99<100ms, WS replay≥5s + seq + framing, UI batched dagre), AC5a/b/c.
- **Critic**: REVISE — vague risk mitigations, ADR Driver 4 contradiction, AC1/3/6/8 verification, hour ledger, Week 3 async 48h.

### Iteration 2
- **Planner**: v2 draft (`.omc/drafts/velxor-consensus-plan-v2.md`) — applied all 10 above.
- **Architect**: APPROVE-WITH-MINOR-IMPROVEMENTS — 4 polish items (`VELXOR_STUB=driver`/`engine` AC8 verification, FltSendMessage non-blocking note, additive escape hatch, replay separate VecDeque).
- **Critic**: APPROVE-WITH-MINOR-IMPROVEMENTS — 6 quality gates PASS; 3 wording clarifications (`VELXOR_STUB=engine` semantics, "Stub Retention Gate" rename, hour ledger wording).

### Final wording pass (applied to this final plan)
1. AC8: `VELXOR_STUB=driver`, `=engine`, `=both` 3 모드 모두 검증 ✓
2. IOCTL: `FltSendMessage` 비차단 수신 thread 노트 ✓
3. Evolution policy: `*_v2` parallel field escape hatch ✓
4. WS: broadcast = live fan-out, replay = separate `VecDeque` ✓
5. `VELXOR_STUB` semantics 표로 명시 ✓
6. "Stub Deprecation Gate" → "Stub Retention Gate" ✓
7. Hour ledger 트리거 명확화: 트리거 = >138h (120h × 1.15), 124h ≠ 트리거 ✓

## Status

🟡 **PENDING APPROVAL** — 사용자가 별도의 명시적 실행 승인을 하기 전까지 어떤 코드 변경/PR/실행/agent delegation도 일어나지 않습니다.

다음 실행 옵션 (별도 승인 후):
- `Skill("oh-my-claudecode:team")` — 병렬 팀 agent 실행 (이 계획에서는 Walking Skeleton stub 작업이 본인 단독이라 적합도 낮음)
- `Skill("oh-my-claudecode:ralph")` — 지속 루프 실행 with architect verification (반복 큰 Rust/UI 작업에 적합)
- `Skill("oh-my-claudecode:autopilot")` — 자동 종단 실행 (consensus 정제 거친 후엔 자율성 낮춰도 됨)
- `Skill("compact")` 후 ralph — context 정리 후 실행

실행 모드 선택은 사용자의 명시적 다음 메시지가 필요합니다.
