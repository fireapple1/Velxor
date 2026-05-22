# Worker C (Python Engine) — A로 인계해야 할 산출물

> **발신**: Worker A (Rust DRI)
> **수신**: Worker C (Python — Flask + Waitress + 분류 모델)
> **발행일**: 2026-05-22
> **목적**: A가 Week 4-5까지 발행한 `/classify` 클라이언트(`classifier_client.rs`)와 통합되는 C 측 산출물·검증·문서 정리. 각 항목에 마감·형식·검증 기준 명시.

---

## 🚨 0. 즉시 회신 — v1.1 schema collation (마감 **2026-05-24**, 발행 +2일)

A가 `contracts/v1.1-review-trigger.md` 에 발행한 review 요청. **무응답 시 48h 룰로 A 단독 발행** (Principle 4) → C 의견 반영 불가.

### C 영역 회신 범위
**BehaviorEventV1 / POST /classify** (`contracts/interface-schema.md` §1, §2) — 학습·추론에서 "이게 더 있었으면" 싶었던 필드.

### 제출 양식 (Slack reply 또는 `contracts/interface-schema.md` PR comment)
```
- 필드명:
- 이유 (현재 schema에서 누락이거나 잘못된 이유):
- additive 제안 (새 optional 필드 형태로 추가, 기존 필드 type 변경 금지):
```

**최소 1개**. C가 분류 엔진을 짜며 "이 필드 없으면 학습/추론 어렵다" 싶었던 것 무엇이든.

### 참고 — A 자체 노트 (v1.1-review-trigger.md §A 자체 노트)

A도 4개 이미 정리해둠. C 영역과 겹치는 것:
- `op_detail`의 `FileRename` / `ProcessCreate` variant 추가 (현재 `FileWrite`만 정의)
- `dropped_since_last` 포화 시 `dropped_saturated: bool`
- `/classify` 비-200 응답 shape (`{error, retry_after_ms?}`)
- `image_path: "<unknown:pid=N>"` sentinel + `image_path_resolved: bool`

C 노트와 겹치면 OK — A가 통합 시 dedup.

---

## 1. Week 5 — `run-all.sh` 정리 (마감 Week 5)

현재 `scripts/run-all.sh` 가 walking-skeleton용으로 존재. Week 5 시점에 engine + Rust + UI 전체 기동 시퀀스 정리.

### 1.1 기동 순서 (`handoff-week4-5.md` §7 권장)

```bash
# 1) C: Python engine 먼저
source python-engine/.venv/bin/activate
python python-engine/waitress_conf.py &
sleep 1   # /health up 대기

# 2) A: rust-service (fanotify는 sudo, stub은 unset 가능)
if [[ -z "${VELXOR_STUB:-}" ]]; then
  sudo -E rust-service/target/release/rust-service &
else
  rust-service/target/release/rust-service &
fi
sleep 2

# 3) B: UI
(cd ui && npm run dev) &
```

### 1.2 venv 이슈 — A가 이번 세션에 임시 생성함

A가 `§4.7 sweep` 검증 위해 `python-engine/.venv/` 를 생성 (없어서 안 됐음). **C가 이걸 .gitignore에 추가하거나, 또는 venv 생성 스크립트(`scripts/setup-venv.sh`)를 작성해두면 다른 워커가 setup 수월**. 권장:
```bash
# scripts/setup-venv.sh
python3 -m venv python-engine/.venv
python-engine/.venv/bin/pip install -r python-engine/requirements.txt
```

---

## 2. Week 6-7 — 실 모델 PoC (마감 Week 7 종료)

현재 `python-engine/app.py` 는 **Week 1 하드코드 stub** (항상 `ransomware`, 0.95). 실 모델로 교체 필요.

### 2.1 `/classify` 실 구현

- **입력**: `{events: BehaviorEventV1[], window_ms: 1000}` (배열 길이는 burst window 내 이벤트 수, 보통 50-수백)
- **출력 spec** (`contracts/interface-schema.md` §2.2):
```json
{"verdict": "benign|ransomware",
 "confidence": 0.0~1.0 (f32),
 "evidence": ["사람이 읽는 reasoning 라인", ...],
 "model_version": "lr-2026w7" or "rules-fallback-<ver>"}
```
- **SLA**: p99 < 100ms (AC4). reqwest timeout 200ms 초과 시 verdict 미발행 (다음 burst로 이월) — C가 이 안에 못 들어오면 fallback rules로 빠지는 것을 권장.

### 2.2 fallback rules

200ms 초과 / 예외 발생 시 모델 통과 안 시키고 rule-based로 결정. `model_version: "rules-fallback-<ver>"` 로 식별.

### 2.3 PoC 데이터셋 (`.claude/commands/roles.md` §3)

```
poc-samples/
  v1/    # 초기 신호 후보
  v2/    # 정제 후
  v3/    # 최종 (held-out 분리됨)

datasets/
  positive/   # 학습용 positive
  negative/   # 학습용 negative
  heldout/v3/ # ★ 학습 데이터에 포함 금지 (CLAUDE.md 절대 규칙)
```

---

## 3. Week 8-9 — AC 검증 (마감 Week 9)

### 3.1 AC2 PoC 벤치마크 (`.claude/commands/ac.md` AC2)

| 항목 | 명세 |
|---|---|
| 스크립트 | `scripts/poc-bench.sh` (C 작성) |
| 기준 | 300 ops < 1s (PoC 처리량) |
| 출력 | PASS / FAIL + 평균·p99 |

### 3.2 AC4 — `/classify` p99 < 100ms (`.claude/commands/ac.md` AC4)

| 항목 | 명세 |
|---|---|
| 스크립트 | `scripts/eval-ac4.sh` (C + A 공동) |
| C 역할 | classify 응답 시간 측정 + 통계 |
| A 역할 | tracing JSON 출력 (A가 Week 8-9 §5에서 instrumentation 추가 예정) |
| 기준 | p99 < 100ms |

### 3.3 AC5 — held-out 평가 (`.claude/commands/ac.md` AC5)

| 항목 | 명세 |
|---|---|
| 스크립트 | `scripts/eval-ac5.sh` (C 작성) |
| 데이터 | `datasets/heldout/v3/` (학습에 포함 금지) |
| 기준 | TP ≥ 9/10, FP ≤ 1/10 |
| 산출물 | `docs/AC5-results.md` — 결과 + **disclaimer "synthetic PoC, not real-world malware"** 필수 (AC5 정책) |

---

## 4. Week 8-9 — 운영 정합성 (마감 Week 9)

### 4.1 `VELXOR_STUB=engine` / `both` 의 model_version 일관성 (운영 합의)

현재 `python-engine/app.py`:
```python
MODEL_VERSION = "stub-v1" if VELXOR_STUB == "engine" else "rule-based-v1"
```

→ `VELXOR_STUB=both` 일 때도 `else` 경로라 `rule-based-v1`. A의 §4.7 sweep 검증 시 `both` 모드와 `collector` 모드의 verdict payload가 동일하게 나옴.

**권장**: `VELXOR_STUB in ("engine", "both")` 양쪽 모두 `stub-v1` 로 분기. 의미상 둘 다 엔진 stub 모드여야 일관.

### 4.2 events 배열 edge case (리허설 자가확인 항목)

- `events: []` (빈 배열) → ? (현재 동작 확인 필요)
- `events: [<1건>]` → 정상 응답
- `events: [<수십~수백건>]` → 200ms 안에 처리

C가 이 세 경우 모두 안전하게 200 응답 또는 well-formed 에러 응답하는지 단위 테스트 권장.

---

## 5. Week 10 — 데모용 문서 (마감 Week 10)

| 파일 | 내용 | 출처 |
|---|---|---|
| `docs/AC5-results.md` | held-out 평가 결과 + disclaimer | AC5 정책 |
| `docs/ARCHITECTURE.md` | 4-tier 외부 시점 (collector → service → engine → UI) | `.claude/commands/roles.md` §3 |
| `docs/DEMO-SCRIPT.md` (engine 시연 부분) | C 측 시연 — 어떤 입력에 어떤 verdict가 나오는지 step-by-step | `.claude/commands/roles.md` |

---

## 6. Week 9 리허설 자가확인 (마감 Week 9 시작 전)

`handoff-week4-5.md` §9 — C 항목 PASS/FAIL 결과를 A에게 회신.

- [ ] `/classify` 200ms 내 응답 (실패 시 fallback rules 동작 확인)
- [ ] events 배열 edge case 안전 (빈 배열 / 1개 / 수십개)
- [ ] (A가 검증 완료) `VELXOR_STUB=both` / `=collector` 단독 기동 시 AC1/AC8 통과 — C 측에서도 `/health` `/classify` 응답 정상인지 확인

**회신 형식**: 각 항목 PASS / FAIL + 측정값 또는 로그 발췌.

---

## 7. 현재 통합 상태 (참고)

A가 §4.7 sweep에서 검증한 결과 (2026-05-22):

| Mode | 결과 | C 관련 |
|---|---|---|
| `VELXOR_STUB=both` | PASS (60 node_add + 1 verdict) | engine 정상 응답, 0.95 verdict 수신 |
| `VELXOR_STUB=collector` | PASS | engine 정상 응답 |
| unset (실 fanotify) | PASS (36k events / 6s) | engine 정상 — 6초간 6 verdict (cache TTL 1s × multi-PID) |

C 측 Python engine은 walking-skeleton(Week 1 하드코드) 상태에서 통합 OK. Week 6-7부터 실 모델 교체.

---

## 8. 인터페이스 spec 참조 (변경 없음, 읽기 전용)

| 문서 | 내용 |
|---|---|
| `contracts/interface-schema.md` | v1.0 schema (BehaviorEventV1, `/classify` 명세) |
| `contracts/handoff-week4-5.md` | A → B/C 인계 (포트 매트릭스, ENV, A의 클라이언트 동작 — verdict cache TTL 1s, debounce 1s) |
| `contracts/v1.1-review-trigger.md` | 회신 양식 + A 자체 4 노트 (참고용) |

A의 `classifier_client.rs` 호출 측은 §4.7 sweep까지 안정 (commit `05bf6c2`). C 측 변경은 v1.1 collation 후 통보.

---

## 9. 응답 채널

- v1.1 회신: **2026-05-24 마감** (위 §0)
- 일반 질문 / 인터페이스 변경 제안: `contracts/handoff-week4-5.md` PR comment 또는 직접 메시지
- `/classify` 응답 shape 변경 등 breaking 가능성: 즉시 Slack (v1.1 schema review에 반영)

A는 Week 8-9 §5 (AC4 tracing instrumentation + 리허설) 진입 예정. AC4는 C와 공동 측정.

— Worker A (2026-05-22)
