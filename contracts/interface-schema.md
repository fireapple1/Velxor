# Velxor Interface Schema v1.1

> **DRI**: A=Rust(이 문서·collector·WS) / C=Python(`/classify` 본문) / B=UI(WS consumer)
> **버전**: **v1.1** (2026-05-22 collation, schema_version "1.0"과 호환 — additive only)
> **이력**: v1.0 (Week 1 draft) → v1.1 (B/C async review 통합)
> **진화 규칙**: v1.x = additive only, v2 = breaking + 3인 합의
> **에스케이프 해치**: 잘못된 타입은 `*_v2` parallel 필드로 우회
> **v1.1 변경 요약**: §9 (변경 요약 + 출처 매핑) 참조. 필드별 변경에는 본문 안에 `[v1.1]` 마커.

---

## 1. Collector → Service: `BehaviorEventV1`

Rust collector(A) → Rust service(A) 송신용 wire 포맷. JSONL 1줄 = 1 메시지.

### 1.1 Payload

```json
{
  "schema_version": "1.0",
  "seq": 42,
  "dropped_since_last": 0,
  "pid": 1234,
  "parent_pid": 1000,
  "image_path": "/usr/bin/python3",
  "event_type": "FileWrite",
  "file_path": "/home/user/doc.docx.enc",
  "volume_id": "ext4:259:2",
  "op_detail": { "file_size": 18421, "entropy_hint": 247 },
  "ts_unix_ms": 1716300000000
}
```

### 1.2 필드 정의

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `schema_version` | string | ✓ | `"1.0"` 또는 `"1.1"` 호환 (v1.x = additive only) |
| `seq` | u64 | ✓ | session monotonic, gap 없음 |
| `dropped_since_last` | u32 | ✓ | overflow drop 카운터, 다음 송신에 동봉. **[v1.1]** u32 포화 시 더 이상 증가 안 함(saturating add); 포화 발생 시 `dropped_saturated: true` 동봉 권장 |
| `dropped_saturated` | bool? | optional | **[v1.1]** `dropped_since_last`가 u32::MAX에 도달했음을 신호. 기본 false |
| `pid` | u32 | ✓ | source PID |
| `parent_pid` | u32 | ✓ | `/proc/<pid>/status` PPid |
| `image_path` | string | ✓ | UTF-8, ≤ 4096 bytes (Linux PATH_MAX), `/proc/<pid>/exe` readlink. **[v1.1]** readlink 실패 시 sentinel `"<unknown:pid=N>"` 형태로 발행 (PID race 등) |
| `image_path_resolved` | bool? | optional | **[v1.1]** `image_path`가 실제 readlink 성공 결과인지 여부. 기본 true. sentinel 시 false |
| `event_type` | enum | ✓ | `FileWrite` \| `FileRename` \| `ProcessCreate`. **[v1.1]** FileRename emit는 deferred — collector v1.x는 FAN_REPORT_DFID_NAME 전환 시점에 활성화. consumer는 enum 유지 |
| `file_path` | string? | optional | UTF-8, ≤ 4096 bytes (`ProcessCreate`는 null 가능) |
| `volume_id` | string? | optional | ext4 dev-major-minor 또는 mount path |
| `op_detail` | object? | optional | variant 별 모양 (아래 §1.2.1) |
| `ts_unix_ms` | u64 | ✓ | 이벤트 발생 시각 (event_received_ts와 별도) |

### 1.2.1 `op_detail` variant (**[v1.1]**)

`event_type` 에 따라 optional shape:

| event_type | `op_detail` 모양 (모두 optional) |
|---|---|
| `FileWrite` | `{file_size: u64, entropy_hint: u32}` (v1.0과 동일) |
| `FileRename` | `{src_path: string, dst_path: string}` (FAN_REPORT_DFID_NAME 활성화 시 emit) |
| `ProcessCreate` | `{argv: string[], cwd: string}` |

### 1.3 Wire

- **인코딩**: JSON UTF-8, JSONL (1줄=1메시지, 줄 안에서 줄바꿈 금지)
- **메시지 크기**: max 4 KiB. 초과 시 `op_detail.path_truncated: true` flag 후 truncate
- **Transport**: UNIX socket `/run/velxor/events.sock` 또는 stdout pipe
- **Send timeout**: `SO_SNDTIMEO = 10ms` (비차단)
- **큐 깊이**: 1024
- **금지**: mutex 보유 중 또는 signal handler context에서 송신 금지. 반드시 enqueue 후 worker dispatch

### 1.4 Drop 정책

- silent drop **금지**
- overflow 시 `dropped_since_last` 카운터 증가
- 다음 successful send의 payload에 동봉 후 0 리셋

---

## 2. Service → Engine: `POST /classify`

A의 `classifier_client.rs` → C의 Waitress(threads=4) `:8765/classify`.

### 2.1 Request

```json
{
  "events": [ /* BehaviorEventV1[] */ ],
  "window_ms": 1000
}
```

**[v1.1] Request body 상한**: `events.length ≤ 1024`, total body ≤ 4 MiB.
- 초과 시 `413 Payload Too Large` + body `{error: "events_overflow", max_events: 1024}` 반환.
- 근거: A의 aggregator burst window 최대치(1024) 와 정렬. 1024 × 4 KiB(BehaviorEventV1 §1.3 상한) = 4 MiB.
- 큰 burst는 A 측에서 분할 호출.

### 2.2 Response

```json
{
  "verdict": "ransomware",
  "confidence": 0.91,
  "evidence": ["write_rate=312/s", "rename_rate=89/s", "entropy_hint>240"],
  "model_version": "lr-2026w7"
}
```

| 필드 | 타입 | 제약 |
|---|---|---|
| `verdict` | enum | `benign` \| `ransomware` |
| `confidence` | f32 | `[0.0, 1.0]` |
| `evidence` | string[] | 사람이 읽는 reasoning 라인 (UI 표시) |
| `model_version` | string | **[v1.1]** prefix enum (아래 §2.2.1) |

#### 2.2.1 `model_version` prefix enum (**[v1.1]**)

| prefix | 의미 |
|---|---|
| `lr-<ver>` | 학습 LR/기타 ML 모델 (e.g., `lr-2026w7`) |
| `rules-<ver>` | 룰 기반 (학습 도입 전 영속 또는 룰만 사용 모드, e.g., `rules-v1`) |
| `rules-fallback-<ver>` | 학습 실패 / 예외 시 룰 자동 fallback |
| `stub-<ver>` | 테스트·시연용 하드코드 (VELXOR_STUB=engine 또는 both) |

v1.0의 `"rule-based-v1"` 은 v1.1 발행 직후 `"rules-v1"` 로 C 측 자체 rename (additive 정책과 무관한 자체 코드 변경).

#### 2.2.2 Empty events 처리 (**[v1.1]**, A #3 + C §1.3 dedup)

`events.length == 0` 시 모든 모드(stub/real/fallback) 공통 응답:
```json
{ "verdict": "benign",
  "confidence": 0.0,
  "evidence": ["no events in window"],
  "model_version": <as in §2.2.1> }
```
근거: zero observation → benign by definition. UI(B)는 `confidence=0.0` 으로 "no signal" state 렌더링.

#### 2.2.3 에러 응답 shape (**[v1.1]**, A #3)

비-200 응답 (`/classify` 자체 실패, 모델 timeout 등):
```json
{ "error": "<short_code>",
  "retry_after_ms": <u32?> }
```
- `error` 예: `"events_overflow"` (413), `"model_unavailable"` (503), `"bad_request"` (400)
- `retry_after_ms` 는 optional — fallback rules로 폴백 권장 시 0 또는 미설정, 일시 장애 시 권장 대기 ms.
- A 측 `classifier_client.rs` 는 비-200 시 verdict 미발행 (다음 burst로 이월). C 측 fallback rules는 200 OK + `model_version: "rules-fallback-<ver>"` 로 정상 응답.

### 2.3 SLA

- **p99 budget**: classifier 응답 < 100 ms (AC4 sub-budget; C가 측정·해석)
- **timeout**: A 측 reqwest timeout 200 ms (초과 시 verdict 미발행, 다음 burst로 이월)
- **cache**: A는 PID별 verdict cache TTL 1초 유지 (`classifier_client::VerdictCache`)
- **[v1.1] fallback 분리 원칙**:
  - 외부 enforcement = A 측 reqwest 200 ms timeout (C 내부에서 자체 deadline 측정 X)
  - 내부 분기 = C 측 model inference 예외 → `except` → `rules-fallback-<ver>` (200 OK + 정상 verdict)

---

## 2.4 Service → Engine: `GET /health` (**[v1.1]**, C §1.1)

A의 `scripts/run-all.sh` engine wait + AC1 재현성 검증의 기본 endpoint. v1.0에서 `app.py` 에 이미 구현되어 있던 drift를 schema에 흡수.

### 2.4.1 Request

```
GET http://127.0.0.1:8765/health
(no body)
```

### 2.4.2 Response

| status | body |
|---|---|
| `200 OK` (정상 또는 fallback 모드) | `{"status": "ok" \| "degraded", "model_version": <as in §2.2.1>}` |
| `503 Service Unavailable` | `{"status": "down", "model_version": <as in §2.2.1>}` |

- `"degraded"`: fallback rules로 자동 폴백 중 (학습 모델 실패 / 미로드 등).
- `"down"`: engine 자체 inference 불가 (예: 모델 로드 실패 + fallback도 비활성).

### 2.4.3 SLA

- **응답 시간**: < 50 ms (`run-all.sh` 가 0.5s × 30회 폴링하므로 budget 내).

---

## 3. Service → UI: WebSocket `WsMessage`

A의 `ws_broadcaster.rs` `tokio::net` `127.0.0.1:7000` → B의 UI.

### 3.1 Payload

```json
{
  "schema_version": "1.0",
  "seq": 42,
  "type": "node_add",
  "payload": { /* type-specific */ }
}
```

### 3.2 Message types

| `type` | `payload` 모양 | 발신 트리거 |
|---|---|---|
| `node_add` | `BehaviorEventV1` 한 건 | collector → 신규 이벤트 |
| `node_update` | `{pid, fields:{...}}` | 동일 PID 상태 변화 |
| `verdict` | `/classify` response (§2.2) + `{pid}` 주입 | aggregator burst → classify 결과 |
| `alert` | `{pid, severity, message}` | block 시도 전후, 운영 알림 |
| `gap` | `{from: u64, to: u64}` | replay buffer evict로 N+1 누락 시 |

### 3.3 Wire

- **포트**: `127.0.0.1:7000` (loopback only)
- **프레임**: tokio-tungstenite 기본 (text frame, UTF-8 JSON)
- **dedupe**: client는 동일 `seq` 중복 무시

---

## 4. WebSocket Reconnect 프로토콜

UI(B)의 끊김·재접속 시 5초 이내 손실 메시지 복원 보장.

### 4.1 Handshake

- client(B): 연결 시 `ws://127.0.0.1:7000?last_seq=N` 쿼리 (최초 = `0`)
- server(A): `accept_hdr_async`에서 URI query parse → `last_seq` 추출

### 4.2 Replay → Live transition

1. server: `ReplayBuffer.since(last_seq)` 호출, `seq > last_seq` 메시지를 client에 즉시 push
2. server: replay 종료 후 `broadcast::Receiver`로 forward (live fan-out)
3. client: 동일 `seq` 중복 수신 시 무시

### 4.3 Gap 처리

- replay buffer = 5초 sliding window VecDeque (lock-protected)
- `last_seq + 1`이 이미 evict됐으면 → `{type: "gap", payload: {from: last_seq+1, to: head_seq}}` emit
- client는 `gap` 수신 시 → **UI full refresh** (graph state reset)

### 4.4 분리 원칙

- **broadcast::channel(1024)** = live fan-out 전용
- **ReplayBuffer (VecDeque)** = 별도 lock-protected 큐, 5초 sliding
- 둘을 같은 채널에 합치면 신규 client가 모든 live 메시지를 중복 수신 → **반드시 분리**

---

## 5. Evolution Policy

### 5.1 v1.x (additive only)

- 새 optional 필드 추가만 허용
- 기존 필드 type 변경 / rename / 삭제 금지
- 발행 절차: 48h async review → 무응답 시 A 단독 발행 (Principle 4)

### 5.2 v2 (breaking)

- A/B/C 3인 합의 필요
- 별도 endpoint·port·schema_version 사용 (`/classify` → `/classify/v2`, ws port 7001 등)

### 5.3 Escape hatch

- v1.0의 잘못된 타입은 **parallel field** `<name>_v2`로 우회
- 예: `confidence` (f32, 0~1) 외에 `confidence_v2` (f64, ms 단위) 추가

---

## 6. `VELXOR_STUB` Semantics

데모 fallback. A/B/C 각자 stub 모드를 독립적으로 영속 가능.

| `VELXOR_STUB` | Rust collector (A) | Python engine (C) | UI (B) |
|---|---|---|---|
| unset | 실 libfanotify | 학습 모델 / fallback 룰 | 실 WS |
| `collector` | `events.jsonl` poll (200ms) | 변경 없음 | 변경 없음 |
| `engine` | 변경 없음 | 하드코드 verdict (`ransomware`, 0.95) | 변경 없음 |
| `both` | `events.jsonl` poll | 하드코드 verdict | 변경 없음 |

- A 지연 시 → `VELXOR_STUB=both` 영속, B/C는 자기 영역 단독 진행 가능
- C의 `run-all.sh`가 3 모드 sweep으로 통합 검증 흡수 (AC8)

---

## 7. 결정적 책임 매핑

| 책임 | DRI | 위반 시 |
|---|---|---|
| `BehaviorEventV1` 송신은 mutex / signal handler context 금지 | A | collector hang, 이벤트 손실 |
| `dropped_since_last` silent drop 금지 | A | 데이터 손실 추적 불가 |
| WS broadcast / VecDeque replay 분리 | A | reconnect 5초 replay 실패, 중복 수신 |
| `/classify` p99 < 100ms 측정·해석 | C | AC4 미충족 |
| `gap` 수신 시 UI full refresh | B | 그래프 상태 영구 divergence |
| v1.x additive only 강제 | A (주관) | B/C 코드 일괄 깨짐 |

---

## 8. 변경 이력

| 버전 | 날짜 | 변경 | 발행자 |
|---|---|---|---|
| v1.0-draft | 2026-W1 | 최초 발행 (이 문서) | A |
| **v1.1** | **2026-05-22** | B/C async review 통합 — C 4건(`contracts/c-review-notes.md`) + A 자체 4건, additive only. B 회신은 사용자 위임으로 비-제출 | A |

---

## 9. v1.1 변경 요약 (출처 매핑)

| # | 위치 | 변경 | 출처 |
|---|---|---|---|
| 1 | §1.2 `op_detail` + §1.2.1 | variant 별 shape 정의 (FileWrite/FileRename/ProcessCreate) | A 자체 #1 |
| 2 | §1.2 `dropped_since_last` + `dropped_saturated` | u32 포화 saturating add + bool 신호 | A 자체 #2 |
| 3 | §1.2 `image_path` + `image_path_resolved` | sentinel `<unknown:pid=N>` + bool 신호 | A 자체 #4 |
| 4 | §2.1 Request body 상한 | `events.length ≤ 1024 / body ≤ 4 MiB`, 413 응답 | C §1.2 |
| 5 | §2.2 `model_version` + §2.2.1 | 4-prefix enum (`lr-`/`rules-`/`rules-fallback-`/`stub-`) | C §1.4 |
| 6 | §2.2.2 Empty events | 모든 모드 공통 `{verdict:"benign", confidence:0.0}` | A 자체 #3 + C §1.3 (dedup) |
| 7 | §2.2.3 에러 응답 shape | `{error, retry_after_ms?}` + status code 매핑 | A 자체 #3 |
| 8 | §2.3 fallback 분리 원칙 | 외부 enforcement(reqwest timeout) vs 내부 분기(except → fallback) | C §2.2 보완 |
| 9 | §2.4 `GET /health` (신규) | endpoint 정의 + 503/200 매핑 + SLA < 50ms | C §1.1 |

**모든 변경은 additive only** — 기존 v1.0 필드의 type 변경 / rename / 삭제 없음. v1.0 클라이언트는 v1.1 메시지를 그대로 디코드 가능 (모르는 optional 필드는 무시).

**참고 — v1.0 부터 존재한 type**: §3.2 의 `node_add` / `node_update` / `verdict` / `alert` / `gap` 5종은 모두 v1.0 (Week 1 draft) 부터 정의됨. v1.1 에서는 §3.2 본문에 `verdict` 행에 `+ {pid} 주입` 명시화 1건만 추가 (commit `cfe7efa` aggregator 의 emit 동작 문서화, schema 의미 변경 아님). 신규 type 추가 0건.

### 9.1 v1.1 발행 직후 자체 PR (A 알림 받음, C 수행)

| # | 작업 | 파일 | DRI |
|---|---|---|---|
| 1 | `MODEL_VERSION` rename `"rule-based-v1"` → `"rules-v1"` | `python-engine/app.py`, `python-engine/fallback_rules.py` | C |
| 2 | `/classify` request size 가드 (events ≤ 1024 / body ≤ 4 MiB) | `python-engine/app.py` | C |
| 3 | 빈 events `[]` 시 `{verdict:"benign", confidence:0.0}` 분기 | `python-engine/app.py` | C |
| 4 | `tests/test_classify.py` empty events expected 갱신 | `python-engine/tests/test_classify.py` | C |

A 측은 v1.1 발행 시점에 fanotify_adapter에 `image_path_resolved`/`dropped_saturated` emit 추가 검토 (선택, optional 필드이므로 v1.1 호환에 영향 없음).
