# Re: Worker C → Worker A — from-worker-a-to-c-2026-05-23.md 회신 (2026-05-23)

> **발신**: Worker C
> **수신**: Worker A
> **응답 대상**: [`contracts/from-worker-a-to-c-2026-05-23.md`](./from-worker-a-to-c-2026-05-23.md) §6 3 건
> **본 회신의 evidence**: 본 commit 시점 main = 879d418 (ARCHITECTURE.md 까지 push 완료)

---

## §1. classify_start_ts placement — **현 (a) spawn 안 채택 동의**

A 의 현 구현:
```rust
join_set.spawn(async move {
    let cs = crate::time_ms();   // ← spawn 안, await 직전
    tracing::info!(classify_start_ts = cs, n_arrived, pid, "classify_start");
    ...
});
```

C 입장 — **(a) 그대로 유지 권장**. 근거:

1. `eval-ac4.sh` 가 측정·게이트하는 AC4 sub-budget 정의는
   *"classifier 응답 시간 p99 < 100 ms"* — 즉 호출자(rust-service aggregator)
   입장에서 verdict 받기까지의 latency 가 의미상 맞음. tokio 스케줄링 지연
   + reqwest 큐잉이 빠지면 사용자 경험 측 latency 와 괴리.

2. (b) spawn 직전 측정은 *"burst-detected → verdict UI 도달"* 종단 latency
   에 더 부합하나, 그 측정은 `event_received_ts` ↔ `ws_sent_ts` (verdict
   타입) 매칭으로 별도 산출 가능 — `eval-ac4.py` 의 best-effort 보조 측정
   분기 (event → ws p99 < 1000 ms) 가 그 자리.

3. (a) 의 단점인 "tokio 스케줄링 지연 노출" 은 honest reporting 측면에서
   오히려 **장점** — broadcast lag / executor saturation 이 운영 시그널.

따라서 1 줄 이동 X. A 의 현 코드 그대로 채택.

---

## §2. walking-skeleton-v1 tag push 시점 — **본 회신과 동시 진행 (C owner)**

`role-assignment.md` AC1 책임 매핑 + A 회신 §4 — tag owner = C.

3 인 재현 조건 c 충족 확인:
- A 환경: PASS — `~/velxor-work/ac1-run/ws-capture.jsonl` (A 회신 §4)
- B 환경: 사용자 위임 → A 가 UI 풀스택 통합 (commit cfe7efa) 까지 진행
  → 별도 재현 없이 "통합 완료" 로 covers
- C 환경: PASS — `scripts/run-all.sh` + `setup-venv.sh` self-contained 가드
  5 종 적용 후 fresh-clone 재현 (WEEK1-PROGRESS-C-2026-05-22 §1.3)

**액션**: 본 회신 commit + push 직후
```bash
git tag -a walking-skeleton-v1 -m "AC1 PASS — run-all + ws-record + 3인 재현 (A/B(통합)/C)"
git push origin walking-skeleton-v1
```

본 tag 이후 release 트레일 `schema-v1.1` (A, commit 120613e 시점 발행) 와
linear.

---

## §3. C 후속 PR 4 건 ETA — **완료, 본 회신 commit 직전 main 반영**

A 회신 §1.2 표 4건 모두 v1.1 §2.x 사양대로 반영 + 의미 일관성 보완 2 건
(추론 except 시 `rules-fallback-v1` 구분 + `/health` status enum `degraded`):

| # | 작업 | commit | 검증 |
|---|---|---|---|
| 1 | `MODEL_VERSION` rename `rule-based-v1` → `rules-v1` | ac82200 | `test_model_version_no_legacy_rule_based_v1` |
| 2 | `/classify` request size 가드 (events ≤ 1024 / body ≤ 4 MiB → 413) | ac82200 | `test_classify_oversized_events_returns_413` |
| 3 | 빈 events `{verdict:"benign", confidence:0.0, ...}` 표준화 (모든 모드) | ac82200 | `test_classify_empty_events_returns_benign_zero` + stub 변형 |
| 4 | `tests/test_classify.py` empty events expected 갱신 | ac82200 | (위 동일) |
| +α | 추론 except → `rules-fallback-v1` (영속 룰과 구분) | ac82200 | `fallback_rules.classify_events(model_version=...)` override |
| +β | `/health` status enum (`ok`/`degraded`) — v1.1 §2.4 | ac82200 | `test_health_status_enum` |

pytest 23/23 PASS (test_classify 10 + test_features 13).

---

## §4. C 측 진행 보고 (Week 6-7 / Week 8-9 §7.1/7.3/7.5)

본 회신 시점까지 main 반영 완료 (commit 흐름 b68efdd → 879d418):

| commit | 단계 | 내용 |
|---|---|---|
| b68efdd | week6 §6.1-6.2 | PoC simulator v1/v2/v3 + scripts/gen-{positive,negative}.py |
| d8b1156 | week6 §6.3-6.4 | 합성 데이터셋 (positive 20 + negative 10 + heldout/v3 10) |
| 0d04fb2 | week6 §6.5-6.6 | features.py 6 피처 + model/train.py + model.pkl + test_features |
| 865a45a | week6 §6.7 | app.py 3-way 분기 + scripts/poc-bench.sh + p99-bench.py |
| ac82200 | v1.1 후속 | C 약속 4건 + 의미 일관성 2건 (위 §3) |
| 629d9d1 | week8-9 §7.1-7.2 | AC5 평가 — held-out v3 **10/10 TP, negative 0/10 FP (PASS)** |
| f3835f5 | week8-9 §7.3 | scripts/eval-ac4.{sh,py} — A tracing JSON parser |
| 879d418 | week8-9 §7.5 | docs/ARCHITECTURE.md — 4계층 외부 시점 + Walking Skeleton 진화 |

### 4.1 AC4 — A 측 실 trace 캡처 대기

`scripts/eval-ac4.py` 가 spec 기반 parser 완성, mock stdin 으로 동작 검증
(p99=55ms PASS, event→ws p99=8ms PASS, failed_ratio=0.200) — 단 **C 환경
에 cargo 미설치** → 실 rust-service 빌드/실행 불가. A 환경에서:

```bash
./scripts/run-all.sh 2>rust-service/logs/trace.json
bash scripts/eval-ac4.sh
```

캡처 후 결과 첨부 부탁. AC4 PASS/FAIL 확정 후 `docs/AC4-results.md` 발행
검토 (현재는 도구만, 결과 문서 미발행).

### 4.2 AC5 — PASS evidence

`docs/AC5-results.md` 참조. proba 분포 1.000 / 0.000 양극단 + 한계 4 건
명시 (§4.1-4.4). 가장 큰 한계는 §4.1 — 학습 데이터의 write_rate 분포가
negative > positive 라 LR 음수 coef. A 의 실 collector trace 로 재학습 시
coef 부호 반전 가능 (future work).

---

## §5. A 에 추가 요청 — 없음

A 의 from-worker-a-to-c-2026-05-23.md 가 묻는 3건 모두 본 회신에서 처리.
미해결 의존성:
- AC4 실 측정 (위 §4.1) — A 환경 trace 캡처
- AC7 1 시간 sustained run — A 영역, 발표 직전 측정

본 회신 이후 C 는 Week 10 발표 슬라이드 (데이터 섹션 + AC5 결과) 작성으로
진입. ARCHITECTURE.md 가 이미 outline 역할.

---

## §6. 응답 채널

- 본 회신 영속화: `contracts/from-worker-c-to-a-2026-05-23.md` (이 파일)
- AC4 실 측정 결과 첨부: 본 파일 PR comment 또는 별도 `docs/AC4-results.md`
- 발표 데이터 섹션 슬라이드: `docs/DEMO-SCRIPT.md` (B owner) 의 engine
  섹션에 C 가 PR 형태로 기여

---

— Worker C (2026-05-23)
