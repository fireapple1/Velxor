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

> **⚠️ Role 모델 supersede**: 본 문서의 단일-owner ("본인=Rust+UI+Interface Contract owner") 모델은
> [`role-assignment.md`](./role-assignment.md)의 **3인 균등 분담 (A/B/C)** 으로 대체되었음. 본 문서는 **기술 명세의
> source of truth**로 유지되며, ownership/시간 분배는 role-assignment.md를 기준으로 따른다.

> **⚠️ OS Migration (2026-05-21)**: 원안의 Windows kernel minifilter(C+WDK) layer ①이 **Ubuntu 24.04 + Rust libfanotify userspace collector**로 대체됨. kernel module 미사용, BSOD/test-signing 의존성 제거, identity는 "사용자공간 행위 탐지기"로 약화. `BehaviorEventV1` wire 포맷은 유지(UTF-16LE → UTF-8, MAX_PATH 520 → PATH_MAX 4096만 변경)되어 layer ②/③/④는 입력 측면에서 동일. AC6 차단은 `TerminateProcess` 시퀀스에서 `kill(pid, SIGTERM/SIGKILL)`로 치환. 자세한 영향은 본 문서 곳곳의 *(Migration)* 인라인 노트 참조.

## Requirements Summary (from spec)
- **Ubuntu 24.04 사용자공간 **랜섬웨어 행위 탐지** 데모급 백신 (학교/공모전)
- 4계층: Rust+libfanotify 사용자공간 수집기 / Rust 통합 서비스 / Python+AI 분석 엔진 / React+Electron UI
- **합성 PoC만** (학습/시연 자체생성), 한 학기 ~80-126 user-hours
- 역할 분담은 [`role-assignment.md`](./role-assignment.md) (A/B/C 균등 ~40h)
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
- **Stub Retention Gate** (이전 이름 "Stub Deprecation Gate"에서 수정): 각 계층 실제 구현 도착 시 stub은 **삭제하지 않고** env flag `VELXOR_STUB=collector|engine|both`로 재활성 가능한 code path로 영속.
- Pros: 통합 리스크 0, 매주 시연 가능, 팀원 지연 흡수, 스키마가 구현 학습과 함께 진화.
- Cons: Week 0+Week 1 합산 ~21-23h 전반 부하; teammate review 무응답 시 v1.1 일방적 발행 가능성(Principle 4로 의도된 trade).

**Option B — Module-First (기획서 원안)**: invalidate — Week 5-6 통합 폭풍 위험.
**Option C — 본인 단독 4계층 + 팀 비-의존**: invalidate — ≥200h, 예산 위반.

**Convergence note**: v1.1 review gate는 Module-First의 좋은 본능(구현 학습으로부터의 인터페이스 진화)을 통합 폭풍 없이 흡수합니다. 즉 Walking Skeleton + v1.1 = pure WS와 Module-First 사이의 의도된 hybrid.

## Acceptance Criteria

- **AC1 — Walking Skeleton 시연**: 검증 = (a) `scripts/run-all.sh` exit 0, (b) `scripts/ws-record.sh` 캡처에 `node_add { event_type: "FileWrite" }` 메시지, (c) 각 팀원이 본인 머신에서 `run-all.sh` 재실행 시 동일 결과. 통과 시 git tag `walking-skeleton-v1`.
- **AC2 — PoC 동작**: `scripts/poc-bench.sh` → wall-clock < 1s for 300 file ops (script exit 0).
- **AC3 — 탐지 시연 화면**: PoC 실행 → OBS 영상 + **frame-at-1000ms screenshot**에 빨간 노드 + verdict panel 가시.
- **AC4 — 지연시간**:
  - **AC4-측정**: Rust `tracing` 로그에서 `event_received_ts → ws_sent_ts` **p99 < 1000ms**. **Sub-budget**: classifier `/classify` **p99 < 100ms** (Waitress threads=4). 산출 = `scripts/eval-ac4.sh`.
  - **AC4-체감**: 데모 영상에서 PoC 실행 시작 → UI 빨간 표시 wall-clock **≤ 1초** (사용자 체감, OBS 영상 timestamp로 검증).
- **AC5 — 분류 정확도**: `scripts/eval-ac5.sh` → markdown 표. 통과: **≥9/10 TP, ≤1/10 FP**.
  - **AC5a**: positive set ≥2 PoC variants (확장자/속도/사이즈 변형); ≥1 (`v3 .pdf → .locked, 200 files/2s`)은 학습 held-out.
  - **AC5b**: negative set에 bursty-but-benign workload 포함 (Ubuntu: `rsync -aH --delete`, `unzip`/`7z`, `git clone`(대형), `npm install`).
  - **AC5c (slide deck)**: 발표 자료에 "evaluated on synthetic PoC, not real-world malware" 명시.
  - **AC5 정책**: held-out v3에서 ≥9/10 미달 시 임계값 완화 X, 결과 그대로 슬라이드에 기록(honest reporting).
- **AC6 — 차단 검증**: 차단 후 `! kill -0 "$PID" 2>/dev/null` 또는 `! test -e /proc/$PID`로 프로세스 부재를 자동 확인하는 스크립트. *(Migration: 원안 `tasklist /fi "pid eq <PID>"`)*
- **AC7 — 발표 자료**: `docs/DEMO-SCRIPT.md` + 30-60초 영상 파일 존재.
- **AC8 — Stub 영속성**: Stub code path가 env flag로 재활성. 검증 = `VELXOR_STUB=both`, `VELXOR_STUB=collector`, `VELXOR_STUB=engine` **3가지 단독 모드 모두** smoke test 통과. *(Migration: `driver` → `collector`)*

## Hour Ledger (≤126h ceiling, 트리거 >145h)

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
| Architect/Critic 추가 작업 (transport doc, Waitress 전환, WS framing/replay separate, stub env flag plumbing) | 8-10 | 해당 주에 흡수 |
| **Total** | **~116-126h** | **ceiling 126h 부합, deferral 트리거 >145h(126×1.15)에 미달 → 자동 절단 불필요.** (3인 균등 분담은 [`role-assignment.md`](./role-assignment.md) 참조) |

### Deferral Order (사전 정의)
누적 hours > planned×1.15 (즉 ≥145h) 시 아래 순서로 자른다:
1. 2.4 사운드 효과 (Web Audio)
2. 2.2 Threat Timeline (D3) → 간단 리스트 뷰로 대체
3. 8.1 자동 차단 → Block 버튼 수동 차단만 유지
4. 10.2 백업 시연 영상

## Implementation Steps

### Week 0 — Tooling Install (학기 전 주말, 6-8h)
- 0.1 Ubuntu 24.04 bare-metal 또는 KVM/VirtualBox VM + (선택) timeshift/LVM snapshot 1
- 0.2 **fanotify smoke**: 최소 Rust/C 샘플로 `~/velxor-work/src`에 `touch foo` 시 `FAN_MODIFY` 1개 캡처 (root 실행) → **Week 0 AC**. *(Migration: 원안 `bcdedit /set testsigning on` + WDK signed driver 로드)*
- 0.3 `cargo new velxor-rust-service` 컴파일 OK (deps: tokio, tokio-tungstenite, reqwest, serde, tracing, fanotify-rs 또는 raw nix)
- 0.4 `npm create vite@latest velxor-ui -- --template react-ts` + electron + `@xyflow/react` dev server (nvm 권장 — apt의 node는 22가 들어옴)
- 0.5 Flask `/health` 200 (venv + Flask + **Waitress** threads=4; cross-platform이라 gunicorn 대신 그대로 유지해 AC4 sub-budget 측정 재현성 확보)
- 0.6 **inotify 백업 스파이크**: `inotifywait -m -r ~/velxor-work`로 file I/O 이벤트 1개 캡처 → fanotify 실패 시 데모 backup 경로 실증. *(Migration: 원안 ETW `Get-WinEvent`/`xperf`)*

### Week 1 — Walking Skeleton (~15h)
- **1.1 Interface Contract v1-draft** → `Velxor/contracts/interface-schema.md` (semver: v1 = additive only)

  **Collector→Service 메시지 `BehaviorEventV1` (UNIX socket / stdout pipe JSONL)**:
  ```
  { schema_version: "1.0",
    seq: u64,                  // monotonic per session
    dropped_since_last: u32,   // collector queue pressure signal
    pid: u32, parent_pid: u32,
    image_path: string,        // UTF-8, max 4096 bytes (Linux PATH_MAX)
    event_type: enum(FileWrite|FileRename|ProcessCreate),
    file_path: string?,        // UTF-8, max 4096 bytes
    volume_id: string?,        // disambiguate across mount points, UTF-8 (예: ext4-dev-major-minor)
    op_detail: object?,        // event_type별 typed sub-record (FileWrite: u64 file_size, u32 entropy_hint)
    ts_unix_ms: u64 }
  ```

  **Wire encoding**: JSON UTF-8 payload, **1 line = 1 message (JSONL)**, max 4 KiB per message. `image_path`/`file_path`는 UTF-8 그대로 직렬화 — `/proc/<pid>/exe` readlink 결과는 이미 UTF-8 byte string. 경로 잘림 시 `op_detail.path_truncated: true` 표기. *(Migration: 원안 UTF-16LE NUL-terminated + kernel→user 변환은 더 이상 불필요)*

  **전송 메커니즘**: 일반 **UNIX domain socket**(`/run/velxor/events.sock`) 또는 **stdout pipe** (collector를 child process로 spawn). 둘 다 backpressure는 standard socket buffer로 처리. 큐 깊이(userspace ring buffer in collector) 1024, drop 시 `dropped_since_last` 증가. *(Migration: 원안 `FltSendMessage` kernel-side inverted call은 폐기 — userspace ↔ userspace IPC라 kernel-side stall 위험 없음)*

  **Collector-side 송신 정책** (architectural critical):
  - socket write에 `SO_SNDTIMEO = 10ms` 설정 (bounded, retry 없음)
  - any mutex 보유 중 송신 **금지** (사전 enqueue → worker task dispatch)
  - signal handler context에서 송신 **금지** (async-signal-safe 함수만 사용)
  - timeout 또는 ring buffer full 발생 시 → `dropped_since_last++` 후 다음 successful send에 동봉 (silent drop 금지)

  **REST `POST /classify`** (Flask + **Waitress** threads=4, classifier p99 < 100ms sub-budget; cross-platform이라 Linux에서도 그대로 유지해 측정 재현성 확보. gunicorn은 옵션이나 thread vs fork model 차이로 AC4 수치가 흔들려 채택 보류):
  ```
  req:  { events: BehaviorEventV1[], window_ms: u32 }
  resp: { verdict: enum(benign|ransomware), confidence: f32, evidence: string[],
          model_version: string }
  ```

  **WS message** (server: tokio-tungstenite, replay = 5초 sliding window in separate `VecDeque`, frame = JSON + `\n`):
  ```
  { schema_version: "1.0",
    seq: u64,
    type: enum(node_add|node_update|verdict|alert|gap),
    payload: object }
  ```

  **Reconnect 프로토콜**:
  - Client 연결 시 query param `?last_seq=N` 전달 (최초 연결은 `0` = 전체 replay).
  - Server: `VecDeque` 내 seq > N 메시지를 즉시 push, 이후 live broadcast로 전환.
  - 5초 초과로 N+1이 VecDeque에 없으면 → `{type: "gap", payload: { from: N+1, to: head_seq }}` 송신. UI는 full refresh 모드 진입.
  - Client dedupe: 동일 seq 중복 수신 시 두 번째 무시 (idempotent UI 갱신).

  **Evolution policy**:
  - v1.x = additive only (새 optional field만)
  - v2 = breaking change, team sign-off 필요
  - **Escape hatch for wrong-typed v1.0 field**: 같은 의미의 새 필드(예: `volume_id_v2: {id, fs_type}`)를 additive로 추가 + 기존 필드는 slide deck에서만 deprecated 표기 (런타임 호환성 유지). v2 진입 없이 잘못된 타입 회복.

  **`VELXOR_STUB` env flag semantics**:
  | Value | Rust 측 | Python 측 |
  |-------|---------|-----------|
  | `unset` (default) | 실 libfanotify collector 어댑터 사용 | 학습된 모델 또는 rule-based fallback |
  | `collector` | `events.jsonl` 폴링 (collector stub) | 변경 없음 |
  | `engine` | 변경 없음 | Week 1 하드코드 verdict `{ransomware, 0.95}` |
  | `both` | `events.jsonl` 폴링 | 하드코드 verdict |

  *(Migration)* 원안 `VELXOR_STUB=driver` 값은 `collector`로 rename. 의미·동작은 동일.

- 1.2 Rust service stub (`Velxor/rust-service/`): `events.jsonl` poll, REST stub call, WS server with separate replay `VecDeque`.
- 1.3 Python engine stub (`Velxor/python-engine/`): Flask + Waitress threads=4 (cross-platform; gunicorn 대신 그대로 유지해 측정 재현성 확보), 하드코드 verdict.
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
- **4.5 통합 포인트 (collector)** — 팀원1 libfanotify collector 도착 시 본인 Rust 입력 어댑터 교체. 미도착 시 `VELXOR_STUB=collector` 영속, 진행 차단 없음.
- **4.6 통합 포인트 (모델)** — 팀원2 모델 도착 시 `/classify` 응답 교체. 미도착 시 rule-based fallback (write rate ≥50/1s → ransomware 0.9), 동일 인터페이스 유지.

### Week 6-7 — 합성 PoC + 데이터셋 (~20h)
- 6.1 `poc-samples/ransomware_simulator/v1/`: .docx → .docx.enc rename + 32B prefix write, 300 files/1s
- **6.2 AC5a variants**:
  - `v2/`: .txt → .crypted, 500 files/0.8s
  - `v3/`: .pdf → .locked, 200 files/2s (hardest, **held-out**)
- 6.3 positive 데이터셋 생성기 (v1+v2 학습용, v3 held-out)
- **6.4 AC5b bursty-benign 생성 (Ubuntu)**: `rsync -aH --delete src/ dst/`, `unzip`/`7z` 압축해제, `git clone`(대형 저장소), `npm install`(node_modules 폭발) → negative 로그
- 6.5 데이터셋 인계 + 팀원2 학습 트리거 (또는 rule-based fallback 영속)
- 6.6 UI 통합 검증 (full pipeline 1회)

### Week 8-9 — 통합 + 차단 + AC5 측정 (~15h)
- **8.1 자동 차단** (Deferral 후보 #3) — Rust → `nix::sys::signal::kill(Pid::from_raw(pid), Signal::SIGTERM)` → 200ms timeout 대기 → `kill(.., Signal::SIGKILL)` fallback (또는 UI Block 버튼 → IPC → 동일 시퀀스). `EPERM`(권한 부족)·`ESRCH`(이미 종료) 발생 시 fallback 로그. root 또는 동일 uid 필요 — collector가 root로 떠 있어 충족. *(Migration: 원안 `OpenProcess`/`TerminateProcess`/`CloseHandle` 시퀀스)*
- 8.2 `docs/DEMO-SCRIPT.md` (1분 흐름)
- 8.3 UI 폴리싱 (애니메이션, 색상, 타이밍)
- **8.4 AC5 측정**: `scripts/eval-ac5.sh` — v1+v2 학습, v3 held-out + rsync/unzip/git-clone/npm-install negative로 평가, `docs/AC5-results.md` 산출.
- 8.5 사전 리허설 **3회 (Week 9)**, snapshot rollback 시간 측정 (목표 < 60s/round; bare-metal이면 `timeshift` 또는 LVM snapshot) → `docs/REHEARSAL-LOG.md`. collector crash·queue overflow 발생 시 즉시 `VELXOR_STUB=collector` 모드로 데모 시나리오 변경. *(Migration: 원안 BSOD → collector crash로 대체. userspace라 시스템 전체 다운 없음.)*

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
│       ├── collector_source.rs   # events.jsonl ↔ libfanotify adapter (env flag switch)
│       ├── aggregator.rs         # sliding window per PID
│       ├── classifier_client.rs
│       └── ws_broadcaster.rs     # broadcast + separate VecDeque replay
├── python-engine/
│   ├── app.py
│   ├── waitress_conf.py            # Waitress threads=4 (cross-platform WSGI)
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
│   ├── eval-ac4.sh                # tracing JSON → p99 출력 (AC4-측정)
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
| 팀원1 collector 지연 | High | Medium | Week 4 종료 시 collector가 `events.jsonl`조차 emit 안함 | Week 0 fanotify smoke 결과 즉시 가동; `VELXOR_STUB=collector` 영속; collector "future work: LSM/eBPF 강화" 표기 |
| 팀원2 모델 미완성 | Medium | Medium | Week 7 종료 시 학습 모델 없음 | rule-based fallback 영속 (`fallback_rules.py`), `model_version: "rule-based-v1"` |
| fanotify 권한·커널 옵션 실패 | Medium | High | Week 0 AC 0.2 미달성 (root 권한·AppArmor·CONFIG_FANOTIFY) | inotify 백업 경로(0.6) 확정; collector 슬라이드에 "permission caveats" 표기 |
| Collector crash / queue overflow | Low | Medium | 리허설 중 collector 1회 이상 sigsegv 또는 `dropped_since_last` 폭증 | systemd `Restart=on-failure` + drop counter alert; 1회 crash 시 `VELXOR_STUB=collector` 데모 모드. (userspace라 시스템 전체 다운 없음) |
| WS reconnect 불안정 | Medium | Low | 리허설 중 끊김 관측 | Rust 5초 replay (separate VecDeque) + UI exponential backoff + Electron dev 핫리로드 disable |
| 합성 PoC 일반화 의문 | Medium | Low | 발표 Q&A | AC5c slide note + "real-world testing future work" |
| **시간 예산 ≥115% 초과 (>145h)** | **High** | **Medium** | **누적 hours > 145** | **사전 정의 deferral order 자동 적용** (사운드 → Timeline → 자동차단 → 백업영상) |
| Week 0+1 부하 집중 (~21-23h) | High | Medium | 학기 전 주말 + Week 1 | Week 0를 학기 시작 ≥1주 전 완료, schema/stub만 Week 1 |
| Week 3 review 응답 부진 | Medium | Low | 48h 후 teammate 노트 0건 | v1.1 본인 단독 발행 (Principle 4 — 의도된 trade) |
| v1.0 필드 잘못 타입 결정 | Low | Medium | Week 3 review에서 wrong-typed 발견 | additive `*_v2` 필드 추가 + 슬라이드에서만 deprecated (escape hatch) |

## Verification Steps (per AC)

| AC | 검증 artifact |
|----|--------------|
| AC1 | `run-all.sh` exit 0; `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}`; teammate 재현; git tag `walking-skeleton-v1` |
| AC2 | `poc-bench.sh` exit 0 (wall-clock < 1s for 300 ops 출력) |
| AC3 | OBS 영상 + `docs/AC3-evidence/frame-1000ms.png` |
| AC4 | `scripts/eval-ac4.sh` 출력 (event→ws p99<1000ms, classify p99<100ms); 데모 영상 timestamp로 체감 ≤1s 검증 |
| AC5/5a/5b/5c | `docs/AC5-results.md` (held-out v3 표시, rsync/unzip/git-clone/npm-install workload 라벨, "synthetic PoC + Linux/ext4" disclaimer), slides.pdf 페이지 X disclaimer |
| AC6 | `scripts/ac6-verify-block.sh` 자동화 (`! kill -0 "$PID" 2>/dev/null` 또는 `! test -e /proc/$PID`) |
| AC7 | `docs/DEMO-SCRIPT.md` + `videos/demo.mp4` (≥30s) |
| AC8 | `VELXOR_STUB=both`, `VELXOR_STUB=collector`, `VELXOR_STUB=engine` 3 모드 모두 `run-all.sh` smoke pass |

## ADR

**Decision**: Walking Skeleton + Interface Evolution Gate. Interface Contract owner = B ([`role-assignment.md`](./role-assignment.md) 참조); Week 0 환경 셋업 (additive) → Week 1 v1-draft + 4계층 stub end-to-end → Week 3 async v1.1 review (48h, 무응답 시 B 단독) → Week 4+ Stub Retention Gate(env flag `VELXOR_STUB`로 stub code-path 영속) → Week 8-9 통합/측정 → Week 10 발표.

**Drivers**:
1. 시간 제약 (≤126h ceiling 공식 조정, deferral 트리거 145h)
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
- 긍정: B가 system integrator 역할 (학습 큼), 매주 시연 가능, stub fallback이 곧 demo backup, 인터페이스 스키마가 산출물. (A/B/C 분담은 [`role-assignment.md`](./role-assignment.md))
- 부정: Week 0+1 부하 집중 (~21-23h); 무응답 작업자의 입력은 자동 누락(Principle 4 의도된 trade); v1.0 wrong-typed 필드는 `*_v2` parallel field로 우회해야 함 (escape hatch).

**Follow-ups**:
- Week 0 종료: tooling install AC (0.1-0.6) + fanotify smoke sign-off (+ inotify 백업 경로 캡처)
- Week 1 종료: walking-skeleton-v1 git tag
- Week 3 종료: v1.1 schema published
- Week 4 종료: 첫 AC4 정량 측정 (event→ws p99, classify p99)
- Week 8 종료: AC5 측정 결과 (`docs/AC5-results.md`)
- Week 9 종료: 3회 리허설 + snapshot rollback timing

## Consensus Audit Trail

> **Note**: v1, v2 draft 본문은 main 브랜치에 포함되지 않음 (session-local). 필요 시 dev 브랜치 `docs/audit/consensus-plan-v1.md`, `docs/audit/consensus-plan-v2.md` 참조.

### Iteration 1
- **Planner**: v1 draft
- **Architect**: APPROVE-WITH-IMPROVEMENTS — Week 0, v1-draft contract, Stub Deprecation Gate, per-layer fixes (BehaviorEventV1 seq/dropped/volume_id/schema_version + FltMgr comm port, REST workers + p99<100ms, WS replay≥5s + seq + framing, UI batched dagre), AC5a/b/c.
- **Critic**: REVISE — vague risk mitigations, ADR Driver 4 contradiction, AC1/3/6/8 verification, hour ledger, Week 3 async 48h.

### Iteration 2
- **Planner**: v2 draft — applied all 10 above.
- **Architect**: APPROVE-WITH-MINOR-IMPROVEMENTS — 4 polish items (`VELXOR_STUB=driver`/`engine` AC8 verification, FltSendMessage non-blocking note, additive escape hatch, replay separate VecDeque).
- **Critic**: APPROVE-WITH-MINOR-IMPROVEMENTS — 6 quality gates PASS; 3 wording clarifications (`VELXOR_STUB=engine` semantics, "Stub Retention Gate" rename, hour ledger wording).

### Iteration 3 (post-CCG review, 2026-05-20)
- **CCG**: Codex 16건 finding 산출, Gemini 429 실패. 적용 사항: (1) `IOCTL` → FltMgr comm port 용어 통일, (2) gunicorn → Waitress (Windows 호환), (3) `TerminateProcess(pid)` → handle 시퀀스 정정, (4) wire encoding 명세 추가, (5) kernel-side 송신 정책 보강, (6) WS reconnect handshake 추가, (7) hour ledger 120h → 126h 공식 조정, (8) 단일 owner 모델 → [`role-assignment.md`](./role-assignment.md) 3인 균등 분담 supersede.

### Iteration 4 (OS Migration → Ubuntu, 2026-05-21)
- **CCG**: Codex 36건 진단 + Gemini 6건 보충. 결정: layer ①을 **Ubuntu 24.04 + Rust libfanotify userspace collector**로 전환 (사용자 채택). 적용 사항:
  (1) Windows kernel minifilter(C+WDK) → libfanotify userspace, kernel module 미사용
  (2) `FltMgr comm port` / `FltSendMessage` → UNIX socket `/run/velxor/events.sock` 또는 stdout pipe JSONL
  (3) UTF-16LE NUL-terminated MAX_PATH 520 → **UTF-8 PATH_MAX 4096**
  (4) `OpenProcess`+`TerminateProcess`+`CloseHandle` 시퀀스 → `kill(pid, SIGTERM)` → 200ms → `kill(.., SIGKILL)` 시퀀스
  (5) AC6 `tasklist /fi` → `! kill -0 $PID` 또는 `! test -e /proc/$PID`
  (6) AC5b `robocopy /MIR`/7zip → `rsync -aH --delete` / `unzip`·`7z` / `git clone` / `npm install`
  (7) Week 0 `bcdedit testsigning`+WDK signed driver → **fanotify smoke**, ETW `Get-WinEvent`/`xperf` → **inotify 백업 스파이크**
  (8) `VELXOR_STUB=driver` → `VELXOR_STUB=collector` 일괄 rename
  (9) Waitress 명세 "Windows native WSGI" → "cross-platform" (gunicorn 대체 이유는 측정 재현성으로 재정의)
  (10) BSOD/snapshot rollback → collector crash + `Restart=on-failure`로 대체 (userspace라 시스템 전체 다운 위험 없음)
  (11) 호스트/Guest OS = Ubuntu 24.04 LTS, Python 3.11은 pyenv 또는 deadsnakes PPA 격리, `.venv/Scripts/activate` → `.venv/bin/activate`
- **영향**: identity 한 줄(README)이 "Windows 커널 백신" → "Linux 사용자공간 행위 탐지기"로 약화. AC5c disclaimer에 *"Evaluated on Linux/ext4 + fanotify userspace collector; Windows NTFS/minifilter behavior may differ."* 추가. `BehaviorEventV1` JSONL wire 포맷은 보존되어 layer ②/③/④ 코드는 입력 측 어댑터 외 변경 없음.
- **잠재 follow-up (선택)**: LSM/eBPF 강화 → 정체성 회복(현재는 future work)

### Final wording pass (applied to this final plan)
1. AC8: `VELXOR_STUB=driver`, `=engine`, `=both` 3 모드 모두 검증 ✓
2. IOCTL: `FltSendMessage` 비차단 수신 thread 노트 ✓
3. Evolution policy: `*_v2` parallel field escape hatch ✓
4. WS: broadcast = live fan-out, replay = separate `VecDeque` ✓
5. `VELXOR_STUB` semantics 표로 명시 ✓
6. "Stub Deprecation Gate" → "Stub Retention Gate" ✓
7. Hour ledger 트리거 명확화: 트리거 = >145h (126h × 1.15), 124h ≠ 트리거 ✓ *(Iteration 3에서 120h ceiling을 126h로 공식 조정함에 따라 트리거도 138h → 145h로 재계산)*

## Status

🟡 **PENDING APPROVAL** — 사용자가 별도의 명시적 실행 승인을 하기 전까지 어떤 코드 변경/PR/실행도 일어나지 않습니다.

다음 단계 (승인 후):
- 작업자별 dev 브랜치(devA/devB/devC)에서 Week 0 tooling install 시작 (자세한 작업자별 일정은 [`role-assignment.md`](./role-assignment.md) Hour Ledger 참조)
- 실행 자동화 도구 선택은 별도 협의

실행 모드 선택은 사용자의 명시적 다음 메시지가 필요합니다.
