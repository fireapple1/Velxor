# Velxor Interface Schema v1-draft

> **DRI**: A=Rust(이 문서·collector·WS) / C=Python(`/classify` 본문) / B=UI(WS consumer)
> **버전**: v1.0 (Week 1 draft) — v1.1 collation은 Week 3 (48h async review)
> **진화 규칙**: v1.x = additive only, v2 = breaking + 3인 합의
> **에스케이프 해치**: 잘못된 타입은 `*_v2` parallel 필드로 우회

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
| `schema_version` | string | ✓ | `"1.0"` 고정 (v1.x 진화 시 `"1.1"`...) |
| `seq` | u64 | ✓ | session monotonic, gap 없음 |
| `dropped_since_last` | u32 | ✓ | overflow drop 카운터, 다음 송신에 동봉 |
| `pid` | u32 | ✓ | source PID |
| `parent_pid` | u32 | ✓ | `/proc/<pid>/status` PPid |
| `image_path` | string | ✓ | UTF-8, ≤ 4096 bytes (Linux PATH_MAX), `/proc/<pid>/exe` readlink |
| `event_type` | enum | ✓ | `FileWrite` \| `FileRename` \| `ProcessCreate` |
| `file_path` | string? | optional | UTF-8, ≤ 4096 bytes (`ProcessCreate`는 null 가능) |
| `volume_id` | string? | optional | ext4 dev-major-minor 또는 mount path |
| `op_detail` | object? | optional | `FileWrite`: `{file_size: u64, entropy_hint: u32}` |
| `ts_unix_ms` | u64 | ✓ | 이벤트 발생 시각 (event_received_ts와 별도) |

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
| `model_version` | string | 학습 모델 식별자, fallback 룰은 `"rules-fallback-<ver>"` |

### 2.3 SLA

- **p99 budget**: classifier 응답 < 100 ms (AC4 sub-budget; C가 측정·해석)
- **timeout**: A 측 reqwest timeout 200 ms (초과 시 verdict 미발행, 다음 burst로 이월)
- **cache**: A는 PID별 verdict cache TTL 1초 유지 (`classifier_client::VerdictCache`)

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
| `verdict` | `/classify` response (§2.2) | aggregator burst → classify 결과 |
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
| v1.1 | 2026-W3 (예정) | B/C 노트 통합, additive only | A |
