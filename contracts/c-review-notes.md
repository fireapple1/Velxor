# Velxor Schema v1.1 — Worker C Review Notes

> **발신**: Worker C (Python DRI — `/classify` 본문)
> **수신**: Worker A (Rust DRI, 본 schema 발행자), Worker B (UI consumer)
> **발행일**: 2026-05-22 (Asia/Seoul)
> **응답 대상**: A의 [`v1.1-review-trigger.md`](./v1.1-review-trigger.md) (데드라인 2026-05-24)
> **검토 기준**: v1-draft @ `873658f` `contracts/interface-schema.md` 본문 + 본인이 구현한 `python-engine/{app.py, fallback_rules.py, waitress_conf.py}`
> **mechanical ack**: **compiles-against-engine: OK with 4 additive 요청** (Week 1 4-key 매핑 통과, 단 4건 보완 시 spec coverage 완성)

---

## 0. 검토 범위·기준

worker-C-timeline §2.3 (재분배 후 Python DRI 추가 책임):

> `/classify` REST 섹션(req/resp schema, p99 SLA, model_version 컨벤션)이 본인이 구현할 Flask 코드와 일치하는지 1차 검토 → 누락된 부분은 A에게 직접 추가 요청. (의미 검토 본안은 Week 3.)

따라서 본 노트는 **Week 1 mechanical ack 수준**의 4건만 제출한다. 의미 검토(예: `evidence[]` 길이 정책 / Waitress threads=4 동시성 가정 / `window_ms` 의미)는 Week 3 v1.1 collation으로 미룬다.

또한 v1-draft의 §1 `BehaviorEventV1` 영역은 C 책임 영역이 아니라서 본 라운드에서는 비-제출(A 자체 노트 + B 측 응답으로 충분 — A의 자체 노트 #2 `dropped_since_last` 포화·#4 `image_path` readlink fallback 은 이미 `fanotify_adapter.rs:160-164` 에 구현됨을 본인 코드 검토 중 확인).

---

## 1. 응답 4건 (v1.1 review-trigger 양식 준수)

### 1.1 `GET /health` endpoint 누락

```
- 필드명: §2 하위 신규 §2.4 `GET /health`
- 이유:
    scripts/run-all.sh 의 engine health wait (curl http://127.0.0.1:8765/health 폴링)
    가 AC1 재현성 검증의 기본 인터페이스인데 schema에 명시 X.
    python-engine/app.py:9-11 에 이미 구현되어 있어 코드↔스펙 drift 상태.
    schema만 보고 새 engine 구현체를 짜는 사람은 빠뜨릴 수밖에 없음.
- additive 제안:
    §2.4 신설 (v1.x additive only 정책 부합).
      Request: GET /health  (no body)
      Response 200: {
        "status":        "ok" | "degraded",
        "model_version": <as in §2.2>
      }
      Response 503: {
        "status":        "down",
        "model_version": <as in §2.2>
      }
    SLA: < 50 ms (run-all.sh 의 0.5s × 30회 폴링 budget 내).
    fallback rules로 자동 폴백 중인 경우 status="degraded" 정의.
```

**현 코드 evidence**: `python-engine/app.py:9-11`
```python
@app.get("/health")
def health():
    return jsonify(status="ok", model_version=MODEL_VERSION), 200
```

---

### 1.2 `POST /classify` request body 상한 미정

```
- 필드명: §2.1 Request body byte/length 상한
- 이유:
    BehaviorEventV1 1건은 §1.3 에 ≤ 4 KiB 명시되었지만, /classify request의
    `events[]` 배열 길이 상한이 명시 X. 무제한이면 단일 request 가 수 MB 가능.
    C는 AC4 (p99 < 100 ms; classifier 응답 sub-budget) 측정·해석 책임을 지는데,
    입력 크기 분포가 측정 변수로 들어가면 측정 자체가 불안정.
    또한 Waitress threads=4 에서 4 × n MB request 동시 처리 시 OOM 위험.
- additive 제안:
    §2.1 본문 끝에 1줄 추가 (v1.x additive only 부합).
      "Request body 상한: events.length ≤ 1024, request body ≤ 4 MiB.
       초과 시 413 Payload Too Large + {error:"events_overflow",
       max_events:1024} 반환."
    숫자 근거:
      - events.length = 1024:
        A의 aggregator burst window 최대치 (consensus-plan §3.3 — sliding window
        + burst 감지) 와 일치하도록 정렬. 더 큰 burst는 분할 호출.
      - body 4 MiB:
        1024 event × 4 KiB = 4 MiB 상한 = events 최대치와 정합.
```

**현 코드 영향**: `python-engine/app.py:13-22` `/classify` 본문에서 `request.get_json(silent=True) or {}` 호출만 있고 size 가드 X. v1.1 발행 후 C가 가드 추가 PR 제출 예정.

---

### 1.3 빈 events `[]` 처리 정책 미정

```
- 필드명: §2.2 Response — `{events: [], window_ms: <n>}` 입력에 대한 verdict 정의
- 이유:
    빈 입력에 대한 동작이 schema에 정의 X. 현재 본인 코드에서:
      - app.py stub 모드 (VELXOR_STUB=engine): events 무시하고 항상
        verdict="ransomware" 0.95 반환 → 빈 입력에서도 false positive 발생.
      - fallback_rules.py 실제 룰: write_rate = 0/window_s → verdict="benign" 0.6.
    같은 입력에 verdict이 모드별로 분기 → AC8 (3-mode sweep CI) 에서
    행위 분기가 의도된 것인지 버그인지 구분 불가.
- additive 제안:
    §2.2 본문 끝에 1줄 추가 (기존 enum 유지, additive only 부합).
      "Empty events 처리: events.length == 0 시 반드시
        {verdict:"benign", confidence:0.0,
         evidence:["no events in window"],
         model_version:<as in §2.2 컨벤션>}
       반환. 어떤 모드(stub/real/fallback)에서도 동일."
    근거:
      - true positive 정의상 '관찰된 행위가 있어야 ransomware' 이므로
        zero observation → benign 이 자명.
      - confidence=0.0 으로 명시해 UI(B)가 'no signal' state 표현 가능.
```

**현 코드 영향**: `python-engine/app.py` stub 분기 수정 1줄, `fallback_rules.py` 는 이미 자연스럽게 따름.

---

### 1.4 `model_version` stub/rules prefix 컨벤션 부재

```
- 필드명: §2.2 `model_version` 컨벤션
- 이유:
    현 schema 의 `model_version` 컨벤션은 §2.2 표 마지막 줄에서
        "lr-2026w7"             학습 LR 모델
        "rules-fallback-<ver>"  학습 실패 시 룰 자동 fallback
    두 prefix 만 예시. 그러나 본인이 구현한 app.py 의 실제 사용은:
        "stub-v1"        VELXOR_STUB=engine 하드코드 모드
        "rule-based-v1"  fallback_rules.py 기본 룰 (학습 실패 fallback 아님,
                         학습 모델 도입 전 영속 룰)
    두 prefix 모두 schema에 명시 X → AC5 evidence/슬라이드에서
    model_version 문자열을 인용할 때 schema 미정의라 unstable.
- additive 제안:
    §2.2 컨벤션 enum 확장 (additive only 부합 — 새 prefix 추가는 enum 확장이며
    기존 prefix 의미는 그대로 유지).
        "lr-<ver>"              학습 LR/기타 ML 모델
        "rules-<ver>"           룰 기반 (학습 도입 전 영속 또는 룰만 사용 모드)
        "rules-fallback-<ver>"  학습 실패 시 룰 자동 fallback (기존 정의 유지)
        "stub-<ver>"            테스트·시연용 하드코드 (VELXOR_STUB=engine|both)
    C 후속 PR (v1.1 발행 즉시):
        app.py:        "rule-based-v1" → "rules-v1"   rename
        fallback_rules.py: MODEL_VERSION "rule-based-v1" → "rules-v1" rename
        (이건 자체 코드 변경이라 schema additive 정책과 무관)
```

**현 코드 evidence**:
- `python-engine/app.py:6` — `MODEL_VERSION = "stub-v1" if VELXOR_STUB == "engine" else "rule-based-v1"`
- `python-engine/fallback_rules.py:7` — `MODEL_VERSION = "rule-based-v1"`

---

## 2. 비-제출 항목 (의도적 보류)

### 2.1 A의 자체 노트와 중복되어 비-제출

| A의 자체 노트 (v1.1-review-trigger §A 자체 노트) | C 영역 영향 | 비-제출 사유 |
|---|---|---|
| #2 `dropped_since_last` u32 포화 정책 | 적음 (C는 분석만, drop 책임은 A) | A가 이미 인지 + 본인 영역 |
| #3 `/classify` 에러 응답 shape | **C 본인 영역과 직접 중복** | A가 이미 동일한 항목을 제안. C는 비-제출하고 collation 시 A 안에 동의 |
| #4 `image_path` readlink fallback (`<unknown:pid=N>`) | `fanotify_adapter.rs:160-164` 에 이미 구현됨 — A의 자체 인지 + 본인 구현 | 본인 코드 검토 중 확인, A가 인지 |

### 2.2 의미 검토 — Week 3 v1.1 collation 본안으로 미룸

| 보류 항목 | 의미 검토 시점 | 보류 사유 |
|---|---|---|
| `evidence[]` 배열 최대 길이 정책 | Week 3 | B와 UI render 한계 협의 필요 |
| Waitress threads=4 동시성 가정 + sklearn model thread-safety | Week 6+ | 학습 모델 도입 후 |
| `window_ms` 의미 명시 (지난 N ms vs 미래 N ms) | Week 3 | A의 aggregator (현재 `pub fn placeholder()` 빈 상태) 본 구현 후 명확화 |
| `verdict` enum 확장 후보 `indeterminate` | Week 3 | breaking 가능성, 3인 합의 + B의 UI state 정합 협의 필요 |

---

## 3. 본 노트의 의의 (mechanical ack 의미)

worker-C-timeline §2.3 의 "1차 검토" 정의:
- ✅ Python dataclass / pydantic 1:1 매핑 가능 — 가능
- ✅ Byte budget Python에서 강제 가능 — `len(line.encode('utf-8'))` 가드. 단 events[] 총량은 §1.2 제안으로 보완
- ✅ 4-key response contract (`verdict / confidence / evidence / model_version`) — 일치
- ✅ `model_version` 컨벤션 — 정해져 있되 4가지 prefix 보완 제안 (§1.4)

**최종 판정**: `compiles-against-engine: OK with 4 additive 요청`

위 4건이 v1.1 collation 에 모두 반영되면, C는 다음 Week 1 마감 직후에:

1. `app.py` model_version rename `"rule-based-v1"` → `"rules-v1"` (자체 코드 PR)
2. `/classify` request size 가드 추가 (§1.2 의 1024 / 4 MiB)
3. 빈 events 시 `verdict="benign", confidence=0.0` 분기 (§1.3)
4. `fallback_rules.py` model_version 동기 rename

자체 PR 4건은 v1.1 발행 의존이므로, **v1.1 발행 후** 진행한다.

---

## 4. 변경 이력 (본 review notes 자체)

| 버전 | 일시 | 변경 | 발행자 |
|---|---|---|---|
| v1 | 2026-05-22 | 최초 작성, 4건 응답 + 비-제출 사유 + Week 3 미룸 항목 | C |

---

> A가 본 노트를 받고 v1.1 collation 흐름에 흡수해 주기 바람. 무응답 시
> A 단독 v1.1 발행해도 무방 (Principle 4) — 본 노트는 contracts/ 하위 영속이라
> Week 3 본안 collation 또는 git blame 으로 추적 가능.
