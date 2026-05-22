# Velxor 아키텍처 (4-layer Ubuntu userspace)

> **작성자**: Worker C (re-assignment 2026-05-22 후 doc owner)
> **버전**: 2026-05-23 (v1.1 schema 기준)
> **목적**: 4계층 데이터 흐름 + Walking Skeleton 진화 + `VELXOR_STUB` sweep 의의를
> 외부 시점(평가자·교수·동료 worker) 에 단일 문서로 풀어 설명. B 의 슬라이드
> UI 섹션에서 본 문서를 인용한다.
> **연관**: [`../contracts/interface-schema.md`](../contracts/interface-schema.md)
> (v1.1 source of truth), [`AC5-results.md`](./AC5-results.md) (분류 정확도).

---

## 0. TL;DR

Linux 사용자공간(Ubuntu 24.04) 에서 **랜섬웨어 류 파일 암호화 행위를 실시간
감시·시각화·차단** 하는 데모급 행위 기반 탐지기. 학습된 LogisticRegression
모델이 1 초 sliding window 통계 6 개를 보고 `benign | ransomware` verdict 를
emit; UI 는 1 초 안에 빨간 노드 + verdict panel 을 띄우고 운영자가 Block
버튼으로 SIGTERM→SIGKILL 시퀀스를 발사한다.

원안은 Windows kernel minifilter(WDK) 였으나 2026-05-21 ubuntu fanotify
userspace collector 로 마이그레이션 — BSOD / test-signing 의존성 제거.

---

## 1. 4계층 다이어그램

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ① 사용자공간 수집기  Rust + libfanotify (root or setcap cap_sys_admin+ep) │
│    ─ FAN_MODIFY / FAN_OPEN_EXEC / FAN_CLOSE_WRITE  마크 + 이벤트 수신      │
│    ─ /proc/<pid>/exe + status PPid  메타 보강                              │
│    ─ image_path readlink 실패 시 "<unknown:pid=N>" sentinel + bool        │
│    ─ silent drop 금지 + dropped_since_last u32 saturating                  │
└────────┬───────────────────────────────────────────────────────────────────┘
         │  BehaviorEventV1 JSONL (schema_version "1.0"/"1.1")
         │   schema §1.1, 1 line = 1 event, ≤ 4 KiB, 큐 1024
         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ ② 사용자공간 통합 서비스  Rust (tokio runtime, single binary)             │
│                                                                            │
│   collector_source ─▶ aggregator ─▶ classifier_client ─▶  (③ 호출)        │
│                       │ PidWindow                ▲                         │
│                       │ 1s sliding              │ POST /classify           │
│                       │ FileWrite ≥ 50/1s      │ verdict cache TTL 1s     │
│                       │   OR Rename ≥ 30/1s    │ reqwest timeout 200ms   │
│                       │ 1s debounce            │                          │
│                       ▼                                                    │
│                  ws_broadcaster                                            │
│                       │ broadcast::channel(1024)  = live fan-out          │
│                       │ ReplayBuffer (VecDeque)   = 5s sliding (replay)   │
│                       │ ?last_seq=N handshake → backlog → live transition │
│                       │ gap evict → {type:"gap", from, to} emit            │
│                       ▼                                                    │
│                  blocker  (별도 :7001 axum)                               │
│                       │ POST /block/{pid} → SIGTERM → 200 ms → SIGKILL   │
│                       │ outcome enum: killed/terminated/already_gone/    │
│                       │              eperm/invalid/error                  │
└────────┬─────────────────────────────────────────────────┬─────────────────┘
         │ WebSocket :7000                                  │ HTTP :7001
         │ schema §3 WsMessage                              │
         ▼                                                  ▼
┌────────────────────────────────┐    ┌────────────────────────────────────┐
│ ④ UI  React + Electron        │    │ ③ 분석 엔진  Python + Waitress    │
│                                │    │                                    │
│   ProcessTree (xyflow)         │    │   Flask /classify  /health         │
│   DetailPanel (pid/verdict/    │    │   3-way 분기 (interface §2.2.1):   │
│                evidence)       │    │     stub-v1  (VELXOR_STUB=e|b)    │
│   BlockButton → POST /block    │    │     lr-2026w7 (model.pkl 로드 OK) │
│   ws/client: dedupe by seq +   │    │     rules-v1  (영속 룰)           │
│              gap → full reset  │    │     rules-fallback-v1 (예외 시)   │
│   alert: outcome 6종 표시      │    │   p99 < 100 ms (AC4 sub-budget)    │
└────────────────────────────────┘    └────────────────────────────────────┘
```

---

## 2. 데이터 흐름 — wow moment 1 초

PoC 실행 → 1 초 안에 UI 빨간 노드 + verdict panel:

```
t=0 ms      simulate.py 가 .docx → .docx.enc rename + 32 B write × 300 files
                │
t≈1-2 ms    ① fanotify_init + mark → 커널이 FAN_MODIFY / FAN_CLOSE_WRITE 보고
                │
t≈3-5 ms    ① /proc/<pid>/exe readlink + PPid 보강 → BehaviorEventV1 emit
                │   (UNIX socket / stdout pipe JSONL, send_timeout 10 ms)
                │
t≈5-10 ms   ② collector_source → broadcast::Sender (live fan-out)
                │   ▶ 동시 ReplayBuffer push (별도 락) — schema §4.4 분리
                │
t≈10 ms     ④ UI WS client 수신: {type:"node_add", payload:BehaviorEventV1}
                  ProcessTree 노드 색깔만 갱신
                │
t≈10-20 ms  ② aggregator.PidWindow → FileWrite 60건/1s 측정 → burst trigger
                │
t≈20 ms     ② classifier_client::classify_with_cache(pid, events, 1000)
                  cache miss → POST :8765/classify  (cache TTL 1s × PID)
                │
t≈25-60 ms  ③ Python: to_vector(events) → LR.predict_proba [0.0, 1.0]
                  → {verdict:"ransomware", confidence:1.000, evidence:[...],
                     model_version:"lr-2026w7"}
                │
t≈60-65 ms  ② ws_broadcaster: {type:"verdict", payload:{pid,..}} emit
                  + VELXOR_AUTOBLOCK 시 blocker.block_pid(pid) → alert emit
                │
t≈65 ms     ④ DetailPanel verdict 갱신 (pid match) + 빨간 deep red 글로우
                BlockButton 활성. AC3: frame-1000ms.png 캡처 (B owner).
```

전체 p99 wall-clock ≤ 1 초 (consensus-plan §AC3 + §AC4 — A 의 tracing
4-field + C 의 `eval-ac4.sh` 로 측정).

---

## 3. Walking Skeleton 진화 (Week 0 → Week 8-9)

Velxor 의 4 계층은 처음부터 모두 실 구현이 아니다. 인터페이스 contract
(v1.0/v1.1) 를 먼저 발행한 뒤, 각 계층이 stub → 실 구현으로 **독립 진화**
한다. 다른 계층이 깨져도 자기 계층 단독 검증이 항상 가능한 게 핵심.

### 3.1 Walking Skeleton v1 (Week 1, AC1)

`scripts/run-all.sh exit 0` + `scripts/ws-record.sh` 캡처에
`node_add{event_type:"FileWrite"}` 가 잡혀야 통과. 4 계층 모두 stub OK.

| 계층 | Week 1 stub |
|---|---|
| ① collector | `VELXOR_STUB=collector` → `events.jsonl` 폴링 (200 ms) |
| ② service | broadcast/replay/aggregator 골격 (실 fanotify 미동작) |
| ③ engine | `VELXOR_STUB=engine` → hardcoded `{ransomware, 0.95}` |
| ④ UI | Vite + React + WS client + ProcessTree 기초 |

`git tag walking-skeleton-v1` (C 가 owner — A·B 환경 재현 확인 후 push).

### 3.2 Week 4-5 (A 본 구현)

A 가 실 libfanotify adapter + `/block/{pid}` + ws_broadcaster finalize
(race-free reconnect + gap emit) 완료. `§4.7 sweep` 3 모드 모두 PASS:
- `VELXOR_STUB=both` — 60 node_add + 1 verdict
- `VELXOR_STUB=collector` — 60 node_add + 1 verdict
- unset (sudo, 실 fanotify) — 36,097 events / 6 s, 6 verdict

### 3.3 Week 6-7 (C 본 구현, 본 commit 시점)

C 가 실 모델로 stub 교체:
- PoC simulator v1/v2/v3 + dataset 생성기 (`scripts/gen-{positive,negative}.py`)
- `features.py` 6 피처 + `model/train.py` (LR, class_weight=balanced)
- `app.py` 3-way 분기 (`stub-v1` / `lr-2026w7` / `rules-v1`)
- AC5 평가: held-out v3 10/10 TP, negative 0/10 FP ([AC5-results.md](./AC5-results.md))

### 3.4 Week 8-9 (A + C 통합 측정)

- A: AC6 verifier (`scripts/ac6-verify-block.sh`) + AC8 wrap
       (`scripts/ac8-stub-smoke.sh`) + AC4 tracing instrumentation
- C: `scripts/eval-ac4.sh` (A 의 tracing JSON 파싱 → classify p99 < 100 ms)
- A: 리허설 3 회 (`docs/AC-rehearsal-report-2026-05-23.md`) — collector
       안정성 + WS reconnect dedupe 검증

---

## 4. `VELXOR_STUB` Semantics 와 의의

interface-schema §6 정의:

| `VELXOR_STUB` | collector (A) | engine (C) | UI (B) |
|---|---|---|---|
| unset | 실 libfanotify (root) | 학습 모델 / 룰 fallback | 실 WS |
| `collector` | `events.jsonl` 폴링 | 변경 없음 | 변경 없음 |
| `engine` | 변경 없음 | 하드코드 `{ransomware, 0.95}` | 변경 없음 |
| `both` | `events.jsonl` 폴링 | 하드코드 verdict | 변경 없음 |

**의의** — *어느 한 계층이 지연되어도 다른 두 계층은 진행 가능*. 본 프로젝트
는 1 팀 / 1 main 브랜치라 정책상 자연스러운 격리 매커니즘이 필요. A의
fanotify 가 root 권한 / kernel 빌드 옵션으로 막혀도 `=collector` 로 영속,
C의 학습 모델이 안 떨어져도 `=engine` 으로 시연 가능, 둘 다 안 되면 `=both`
로 데이터 흐름 자체는 항상 살아 있음.

CI 게이트: `scripts/ac8-stub-smoke.sh` 가 `collector` + `both` 두 모드 모두
PASS 해야 AC8 통과. `unset` 모드는 root 의존이라 데모 머신에서만 검증.

---

## 5. Interface Contract 진화 — additive only

`contracts/interface-schema.md` v1.0 (Week 1) → v1.1 (2026-05-22 collation,
commit 120613e) 진화 시 **기존 필드 type 변경 / rename / 삭제 0건**. v1.0
client 는 v1.1 메시지를 그대로 디코드 가능 (additive only 정책, §5.1).

v1.1 에 통합된 8 건 (출처 매핑은 schema §9):

| 영역 | 변경 | 출처 |
|---|---|---|
| §1.2 op_detail variant | FileWrite/FileRename/ProcessCreate 별 shape | A #1 |
| §1.2 dropped_saturated | u32 포화 시 bool 신호 | A #2 |
| §1.2 image_path_resolved | readlink 실패 sentinel + bool | A #4 |
| §2.1 body 상한 | events ≤ 1024 / body ≤ 4 MiB → 413 | C §1.2 |
| §2.2.1 model_version | 4-prefix enum (lr-/rules-/rules-fallback-/stub-) | C §1.4 |
| §2.2.2 empty events | `{verdict:"benign", confidence:0.0, ...}` | A #3 + C §1.3 |
| §2.2.3 에러 응답 shape | `{error, retry_after_ms?}` | A #3 |
| §2.4 `GET /health` | 200/503, status enum (ok/degraded/down) | C §1.1 |

**중요**: 합성 데이터셋 (`datasets/`) 은 v1.0 schema 호환 — v1.1 의
optional 필드 (image_path_resolved 등) 없이도 학습/평가에 무관.

---

## 6. 데이터 전략

| 종류 | 위치 | 발생 |
|---|---|---|
| positive 학습 | `datasets/positive/v[12]_*.jsonl` (20) | `gen-positive.py` × simulate v1/v2 |
| positive held-out | `datasets/heldout/v3/*.jsonl` (10) | simulate v3 (.pdf → .locked) — 학습 절대 미포함 |
| negative 학습 | `datasets/negative/*.jsonl` (10) | rsync / unzip / git clone / npm install (bursty-benign) |

**합성 한계** — `gen-negative.py` 가 결과 디렉토리를 walk 한 후 모든 events
를 단일 1 초 window 에 합성. 실 collector trace 와 분포가 다름. AC5
honest reporting 의 가장 큰 한계 (AC5-results.md §4.1).

→ **future work**: A 의 실 fanotify collector 로 동일 워크로드 재캡처 후
   재학습.

---

## 7. 차단 시퀀스 (AC6)

A 의 `blocker.rs` (axum :7001) `POST /block/{pid}`:

```
1. validate (pid > 1, !=0) → invalid 시 즉시 응답
2. nix::sys::signal::kill(Pid::from_raw(pid), SIGTERM)
3. async sleep 200 ms
4. /proc/<pid> 존재 여부 polling (kill -0 equivalent)
   ├─ 죽었으면 → outcome="terminated"
   └─ 살아있으면 → SIGKILL → outcome="killed"
5. EPERM → outcome="eperm" (root 부재 안내)
6. ESRCH → outcome="already_gone"
```

`scripts/ac6-verify-block.sh` 가 `sleep 9999` 희생 PID spawn 후 위 시퀀스
호출 → `kill -0` ESRCH 확인 → killed/terminated 만 PASS.

---

## 8. Acceptance Criteria summary

| AC | 정의 | 상태 (2026-05-23) | 산출물 |
|---|---|---|---|
| AC1 | walking skeleton — run-all + ws-record PASS, 3인 재현, `walking-skeleton-v1` tag | A·C 환경 PASS, **tag push 대기** | scripts/run-all.sh, ws-record.sh |
| AC2 | 300 ops wall-clock < 1 s (PoC throughput) | PASS (perf_counter, simulate AC2_MEASURED_MS) | scripts/poc-bench.sh |
| AC3 | UI 첫 frame ≤ 1 s + OBS evidence | B 영역, A 가 위임 받아 진행 | ui/, docs/AC3-evidence/ |
| AC4 | classify p99 < 100 ms | **A 의 실 trace 캡처 후 측정 대기** | scripts/eval-ac4.{sh,py} |
| AC5 | held-out TP ≥ 9/10, FP ≤ 1/10 | **PASS (10/10, 0/10)** | scripts/eval-ac5.{sh,py}, AC5-results.md |
| AC5c | "synthetic PoC" disclaimer | PASS (AC5-results §0, ARCHITECTURE §6) | — |
| AC6 | SIGTERM → 200 ms → SIGKILL 검증 | A 환경 PASS (pid 311061 terminated) | scripts/ac6-verify-block.sh |
| AC7 | 1 시간 sustained run, leak 없음 | A 영역, 발표 직전 측정 | — |
| AC8 | 3-mode stub sweep | PASS (collector + both) | scripts/ac8-stub-smoke.sh |

---

## 9. 한계 / Future Work

- 평가는 합성 PoC 기준 — 실 ransomware family 일반화는 future work
  (AC5c disclaimer, AC5-results §4)
- collector 는 mount 단위 mark — 디렉토리 단위 필터 미적용 (Week 8-9 stress 시 검토)
- FileRename emit deferred — `FAN_REPORT_DFID_NAME` class 전환 합의 후
  활성화 (v1.1 collation 후 별도 round)
- UI Electron 패키징 미테스트 — Node 22.12+ 전환 결정 시까지 dev 모드만
- 학습 데이터 30 + 10 — k-fold 미실시, statistical power 작음

본 한계는 모두 문서화 + 슬라이드 disclaimer + 발표 Q&A 대응 사전 준비.

---

## 변경 이력

| 버전 | 일시 | 변경 | 발행자 |
|---|---|---|---|
| v1 | 2026-05-23 | 최초 작성. 4계층 다이어그램 + Walking Skeleton 진화 + VELXOR_STUB sweep + v1.1 schema 통합 후 상태 | C |
