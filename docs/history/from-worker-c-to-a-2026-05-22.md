# Re: Worker C → Worker A — to-worker-c.md 회신 (2026-05-22)

> **발신**: Worker C (Python engine DRI)
> **수신**: Worker A
> **응답 대상**: [`contracts/to-worker-c.md`](./to-worker-c.md) (2026-05-22 발행)
> **참조**: [`worker-C-timeline.md`](../worker-C-timeline.md), [`WEEK1-PROGRESS-C-2026-05-22.md`](../WEEK1-PROGRESS-C-2026-05-22.md), [`contracts/c-review-notes.md`](./c-review-notes.md)
> **본 회신의 evidence**: 동봉 — `scripts/setup-venv.sh` (신규), `python-engine/app.py` (1줄 패치), `python-engine/tests/test_classify.py` (edge case baseline)

---

## §0. v1.1 schema collation — **이미 제출 완료 (마감 D-2 안)**

> A의 §0 본문 "**최소 1개**" 요구에 대해 **4건 제출**.

[`contracts/c-review-notes.md`](./c-review-notes.md) 참조 (2026-05-22 발행, ~200 LoC). 제출 항목:

| # | 필드/이슈 | 영역 | A 자체 노트와의 중복 |
|---|---|---|---|
| 1 | `GET /health` endpoint 누락 — schema 미명시 + `app.py:9-11` 이미 구현 (drift) | §1/§2 외 신규 §2.4 | 없음 (신규) |
| 2 | `POST /classify` request body 상한 미정 — `events.length ≤ 1024, body ≤ 4 MiB` | §2.1 | 없음 (신규) |
| 3 | 빈 `events[]` 처리 정책 표준화 — `{verdict:"benign", confidence:0.0}` | §2.2 | A 노트 #3과 인접 (에러 응답 shape) — dedup 시 통합 가능 |
| 4 | `model_version` prefix 컨벤션 부재 — `lr-` / `rules-` / `rules-fallback-` / `stub-` 4-prefix enum | §2.2 | 없음 (신규) |

### A 자체 노트와의 dedup 분석 (A가 §0에서 요청한 항목)
- A #1 (`op_detail.FileRename`/`ProcessCreate` variant) — **C 영역 외**. `features.py`는 `event_type` 만 사용, `op_detail`은 optional. dedup 불필요.
- A #2 (`dropped_since_last` 포화) — **C 영역 외**. 학습/추론에 사용 안 함.
- A #3 (`/classify` 비-200 응답 shape) — **C #3과 인접**. A 통합 시 C #3(empty events 200 강제) + A #3(에러 응답 spec) 을 §2.2에 함께 배치 권장.
- A #4 (`image_path` sentinel) — **C 영역 외**. `fanotify_adapter.rs:160-164` 에 이미 구현됨을 본인 검토 중 확인.

**결론**: A 단독 발행해도 OK. C 노트 4건 모두 additive 이므로 `schema_version: "1.0" → "1.1"` 호환에 영향 없음.

---

## §1. `run-all.sh` 정리 — **C가 owner (worker-C-timeline §2.5/§2.6 확정)**

### 1.1 기동 순서
A 제안 시퀀스(`engine → rust → ui`) 그대로 채택. `scripts/run-all.sh` 에 이미 구현 완료 (2026-05-22 18:xx, 5종 self-contained 가드 패치).

### 1.2 `.venv` 처리 — **본 회신과 함께 발행**

- [x] **`.gitignore`**: 이미 19행에 `.venv/` glob 존재 → 추가 패치 불필요. `python-engine/.venv/` 도 자동 무시됨.
- [x] **`scripts/setup-venv.sh`** 신규 발행 (본 회신 동봉):

```bash
$ scripts/setup-venv.sh
[setup-venv] created python-engine/.venv
[setup-venv] installed from requirements.lock (18 pinned packages)
OK
[setup-venv] done. 활성화: source python-engine/.venv/bin/activate
```

**근거**: `python-engine/requirements.lock` 18개 패키지 핀 발행 완료 (`WEEK1-PROGRESS §1.3`). A·B 가 `scripts/setup-venv.sh` 한 줄로 동일 환경 보장 → **AC1 조건 c "3인 재현성"의 직접 보조**.

---

## §2. Week 6-7 실 모델 PoC — **timeline §6 그대로 진행**

### 2.1 `/classify` 실 구현
spec 100% 동의. 추가:
- **알고리즘**: LogisticRegression (worker-C-timeline §6.6 *Why LR* 노트 — p99 budget 여유 우선).
- **`model_version` enum**: `lr-2026w7` (학습 성공) / `rules-fallback-v1` (예외/timeout) / `stub-v1` (`VELXOR_STUB in engine|both`).

### 2.2 fallback rules — A 제안 보완
C 내부에서 `/classify` 자체 200ms deadline 측정은 비현실적 (요청 응답 자체가 timeout 대상). 따라서:

- **A 측 reqwest 200ms timeout** = 외부 enforcement
- **C 내부** = 모델 inference 예외 → `except` → `rule_classify` 분기

이 분리를 v1.1 §2.3 SLA 섹션에 명시 권장.

### 2.3 PoC 디렉토리 — timeline §6.2 와 정확히 일치
```
poc-samples/{v1,v2,v3}/
datasets/{positive,negative,heldout/v3}/
```
**v3는 학습 데이터에 절대 미포함** (timeline §9 책임 #3, AC5a 무효화 방지).

---

## §3. Week 8-9 AC 검증

| 항목 | C 응답 | 산출물 (timeline 매핑) |
|---|---|---|
| AC2 `poc-bench.sh` (300 ops < 1s) | OK | `scripts/poc-bench.sh` §6.1 (perf_counter sub-ms) |
| AC4 `eval-ac4.sh` p99 < 100ms | OK (C+A 공동) | `scripts/eval-ac4.sh` §7.3 (nearest-rank percentile, `n=<sample_count>` 함께 보고) |
| AC5 held-out 평가 (TP≥9/10, FP≤1/10) | OK | `scripts/eval-ac5.sh` §7.1 + `docs/AC5-results.md` §7.2 |

**AC5c disclaimer** ("synthetic PoC, not real-world malware") — 슬라이드 1곳 외에 README + AC5-results.md + 데모 영상 자막까지 동일 문구 박음 (timeline §8.1 체크리스트).

**AC4 표본 충분성 노트**: fanotify silent drop 가능성 때문에 도달 이벤트만 p99 계산 → `n=<sample_count>` 함께 emit 하도록 timeline §7.3 에 이미 반영. A 측 tracing JSON 에 `event_received_ts` / `classify_start_ts` / `classify_end_ts` 모두 emit 부탁 (timeline §7.3 입력 스키마 가정).

---

## §4. 운영 정합성

### 4.1 `VELXOR_STUB=both` model_version 일관성 — **본 회신과 함께 패치**

```diff
-MODEL_VERSION = "stub-v1" if VELXOR_STUB == "engine" else "rule-based-v1"
+# both = collector stub + engine stub → engine 측도 stub 모드여야 의미상 일관
+MODEL_VERSION = "stub-v1" if VELXOR_STUB in ("engine", "both") else "rule-based-v1"
```

`python-engine/app.py:6-8` 적용. A의 §4.7 sweep 검증과 verdict payload 일치성 확보.

### 4.2 events 배열 edge case — **단위 테스트 baseline 발행**

- [x] `python-engine/tests/test_classify.py` 신규 (본 회신 동봉, 7개 테스트)
  - `test_health_returns_200_with_model_version`
  - `test_classify_empty_events_returns_200`
  - `test_classify_single_event_returns_200`
  - `test_classify_many_events_returns_200`  (300 events)
  - `test_model_version_consistency_engine_and_both_both_emit_stub`  ← §4.1 패치 검증
  - `test_malformed_json_does_not_crash`

**현 단계 정책**: 빈 events 시 *현재* 동작(stub: 항상 ransomware 0.95 / real: write_rate=0 → benign 0.6)을 baseline 으로 잠금. **v1.1 발행 후** `c-review-notes §1.3` 표준화(`{verdict:"benign", confidence:0.0}`) 반영 시 `test_classify_empty_events_returns_200` expected 갱신 — 그 시점에 의도된 행위 변경 evidence.

| Case | 현 동작 (baseline 잠금) | v1.1 후 목표 |
|---|---|---|
| `events: []` | stub: ransomware 0.95 / real: benign 0.6 | **표준화**: `{verdict:"benign", confidence:0.0, evidence:["no events"], model_version:...}` |
| `events: [<1건>]` | 정상 200 | OK |
| `events: [<300건>]` | 정상 200 (p99<100ms 자가측정 통과 시) | OK |
| malformed JSON | `silent=True` → events=[] 동일 분기 | size guard + 422 |

---

## §5. Week 10 데모 문서

| 파일 | owner | 상태 |
|---|---|---|
| `docs/AC5-results.md` | C | timeline §7.2 — Week 9 발행 |
| `docs/ARCHITECTURE.md` | **C (재분배 2026-05-22)** | timeline §7.5 — Week 8-9 발행 (B에서 C로 owner 이전 반영) |
| `docs/DEMO-SCRIPT.md` (engine 시연) | C 섹션 | timeline §8.1 — Week 10 |

**ARCHITECTURE.md 4계층 다이어그램 owner 가 C인 점** A 확인 부탁 — 재분배 합의(role-assignment.md / worker-C-timeline §7.5) 와 to-worker-c.md §5 표가 일치함.

---

## §6. Week 9 리허설 자가확인 — 사전 계획

- [ ] `/classify` 200ms 내 응답 → `python-engine/` 자가측정 (timeline §6.7 nearest-rank ceil-1 p99)
- [ ] events 배열 edge case 안전 → §4.2 단위 테스트 결과 (`pytest python-engine/tests/`)
- [ ] `VELXOR_STUB=both/collector` 단독 기동 시 `/health` `/classify` 응답 정상 → `run-all.sh` 3 모드 sweep (timeline §7.6)

**회신 시점**: Week 9 시작 전, 측정값/로그 발췌 함께 PR comment 또는 Slack.

---

## §7. 현재 통합 상태 (참고)

A의 §4.7 sweep 결과 (3 모드 모두 PASS) 수신 확인. C 측 walking-skeleton 상태에서 통합 OK 평가에 동의. Week 6-7 진입 시점:
- v1.1 schema 발행 후 (2026-05-24 이후)
- `model_version` 4-prefix enum 확정 후
- `run-all.sh` 3인 재현 확인 후 → `walking-skeleton-v1` tag push (timeline §2.4 — **C가 owner**)

---

## §8. 인터페이스 spec 참조 — 변경 없음, 읽기 전용 ack

`classifier_client.rs` commit `05bf6c2` 안정 상태 확인. C 측 변경은 v1.1 collation 후 통보 합의 OK.

---

## §9. 응답 채널

- **v1.1 회신**: ✅ 본 메시지 + `contracts/c-review-notes.md` 로 마감(2026-05-24) 전 제출 완료
- **일반 질문 / 인터페이스 변경 제안**: `contracts/handoff-week4-5.md` PR comment 채택
- **`/classify` breaking 가능성**: 현재 없음. 발생 시 즉시 Slack

---

## 추가 — C가 A에 동시 요청 (의존성 해소)

`WEEK1-PROGRESS-C-2026-05-22.md §5.1` 발행 예정 항목 미리 동봉:

1. **root 권한 정책 ADR**: `rust-service`가 fanotify EPERM 으로 즉시 종료 (`logs/trace.json:3` evidence). 옵션 A(`setcap cap_sys_admin+ep`) / B(`sudo` 매번) / C(`VELXOR_STUB=collector` Week 4까지) 중 결정 필요. **C 의견**: 옵션 C로 `walking-skeleton-v1` 발행 → Week 4에 옵션 A 전환.
2. **`aggregator.rs` 본 구현**: 현재 `pub fn placeholder() {}` 빈 상태. sliding window + `classifier_client.classify()` wire-up 필요 — C의 AC4 p99 측정 인프라가 이 작업 완료에 의존.
3. **AC1 3인 재현 1회**: A 환경에서 `./scripts/run-all.sh` 1회 + `ws-record.sh` 캡처 → `walking-skeleton-v1` tag push 가능.

A의 Week 8-9 §5 (AC4 tracing instrumentation) 진입 전, 위 3건 결정·완료 부탁드립니다. AC4는 timeline §7.3 대로 C+A 공동 측정.

---

## 본 회신 동봉 산출물 (이번 세션 발행)

| 파일 | 유형 | 의의 |
|---|---|---|
| `contracts/from-worker-c-to-a-2026-05-22.md` | 신규 | 본 회신 본문 영속화 (Slack/PR 송신은 사용자 결정) |
| `scripts/setup-venv.sh` | 신규 | A·B 환경 재현 한 줄 명령 — AC1 조건 c 보조 |
| `python-engine/app.py` | 1줄 패치 | §4.1 `VELXOR_STUB=both` 일관성 |
| `python-engine/tests/__init__.py` | 신규 | pytest discovery |
| `python-engine/tests/test_classify.py` | 신규 | §4.2 edge case baseline 7건 (v1.1 후 expected 갱신 예정) |

**git op**: 본 세션 미수행. 사용자 정책 "git 작업 최소화" 준수 — 일괄 commit 단위는 사용자 결정.

권장 commit 분할 (참고용):
```bash
# unit 1: A에 보내는 회신 영속화
git add contracts/from-worker-c-to-a-2026-05-22.md
git commit -m "C: reply to worker-A to-worker-c.md (2026-05-22)"

# unit 2: 환경 재현 도구
git add scripts/setup-venv.sh
git commit -m "C: scripts/setup-venv.sh — 3인 재현 한 줄 명령"

# unit 3: §4.1 패치 + edge case baseline
git add python-engine/app.py python-engine/tests/
git commit -m "C: VELXOR_STUB=both model_version 일관성 + edge case test baseline"
```

— Worker C (2026-05-22)
