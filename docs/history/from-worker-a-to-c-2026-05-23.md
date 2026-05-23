# A → C — v1.1 발행 알림 + §5 close 통지 (2026-05-23)

> **발신**: Worker A (Rust DRI)
> **수신**: Worker C
> **선행 발신**: [`contracts/from-worker-a-to-c-2026-05-22.md`](./from-worker-a-to-c-2026-05-22.md) (어제 회신)
> **목적**: (1) worker-A-timeline §3.3 — v1.1 schema 발행 알림 / (2) Week 8-9 §5 진행 통지 (AC4 tracing + AC6 + AC8 close) / (3) C 후속 PR 4건 진입 가능 신호

---

## §1. v1.1 schema 발행 완료 (worker-A-timeline §3.3)

`contracts/interface-schema.md` v1.1 collation 발행 — **C의 v1.1 review notes 4건 + A 자체 4건 통합**, additive only.

**git tag**: `schema-v1.1`
**commit**: `120613e A: schema v1.1 collation — C 4건 + A 자체 4건 통합 (additive only)`

### 1.1 통합 결과 (§9 출처 매핑)

| 위치 | 변경 | 출처 |
|---|---|---|
| §1.2 `op_detail` + §1.2.1 | variant 별 shape (FileWrite/FileRename/ProcessCreate) | A #1 |
| §1.2 `dropped_since_last` + `dropped_saturated` | u32 saturating + bool 신호 | A #2 |
| §1.2 `image_path` + `image_path_resolved` | sentinel `<unknown:pid=N>` + bool | A #4 |
| §2.1 Request 상한 | events.length ≤ 1024 / body ≤ 4 MiB + 413 | **C §1.2** |
| §2.2 model_version + §2.2.1 | 4-prefix enum (lr- / rules- / rules-fallback- / stub-) | **C §1.4** |
| §2.2.2 Empty events | `{verdict:"benign", confidence:0.0}` 표준화 | A #3 + **C §1.3** (dedup) |
| §2.2.3 에러 응답 shape | `{error, retry_after_ms?}` + status code | A #3 |
| §2.3 fallback 분리 원칙 | 외부 enforcement vs 내부 분기 | **C §2.2 보완** |
| §2.4 `GET /health` (신규) | 200/503, SLA < 50 ms | **C §1.1** |

**모두 additive only** — 기존 v1.0 필드 type 변경 / rename / 삭제 0건. v1.0 client는 v1.1 메시지 그대로 디코드 가능.

### 1.2 C 후속 PR 4건 진입 가능 신호 (v1.1 §9.1 표)

C가 회신서에서 명시한 v1.1 발행 의존 자체 PR 4건 — 지금 진입 가능:

| # | 작업 | 파일 |
|---|---|---|
| 1 | `MODEL_VERSION` rename `"rule-based-v1"` → `"rules-v1"` | `python-engine/app.py`, `python-engine/fallback_rules.py` |
| 2 | `/classify` request size 가드 (events ≤ 1024 / body ≤ 4 MiB → 413) | `python-engine/app.py` |
| 3 | 빈 events `[]` 시 `{verdict:"benign", confidence:0.0, evidence:["no events in window"]}` 분기 | `python-engine/app.py` |
| 4 | `tests/test_classify.py` empty events expected 갱신 | `python-engine/tests/test_classify.py` |

---

## §2. Week 8-9 §5 — 3/4 sub-task 완료

C의 AC4 측정 인프라가 이걸 기다리고 있었음. **AC4 4 필드 emit + AC6 verifier + AC8 wrap 모두 정상**.

### 2.1 §5.2 AC4 tracing instrumentation (commit `adfbe20`)

C의 회신 §3 + worker-C-timeline §7.3 spec 100% 채택:

| 필드 | 위치 | tracing event 이름 |
|---|---|---|
| `event_received_ts` | `collector_source.rs:52` (stub), `fanotify_adapter.rs:173` (real) | `evt_in` |
| `ws_sent_ts` | `ws_broadcaster.rs` (live + backlog 양쪽, `src: "live"` / `"backlog"`) | `ws_out` |
| `classify_start_ts` + `n_arrived` | `aggregator.rs` burst → spawn 안 (await 직전) | `classify_start` |
| `classify_end_ts` + `latency_ms` | `aggregator.rs` 성공/실패 양쪽 (timeout 비율 계산 보너스) | `classify_done` / `classify_failed` |

**helper**: `main.rs::time_ms()` — `SystemTime::now()` unix-millis, 모든 emit 공용 시점.

**출력**: tracing_subscriber JSON → stdout. `scripts/run-all.sh` 가 `2> rust-service/logs/trace.json` 으로 캡처 (기존 `mkdir -p rust-service/logs` 라인 존재).

### 2.2 §5.1 scripts/ac6-verify-block.sh (commit `543eccb`)

```bash
VELXOR_RUST_AUTOSTART=1 bash scripts/ac6-verify-block.sh
```

- `sleep 9999` 희생 PID spawn → `POST /block/{pid}` → `kill -0 ESRCH` 확인
- outcome 검증: `killed | terminated` 만 PASS
- 본인 환경 검증: pid 311061 → `terminated` (SIGTERM 200ms 안에 종료) → PASS

### 2.3 §5.4 scripts/ac8-stub-smoke.sh (commit `543eccb`)

```bash
bash scripts/ac8-stub-smoke.sh                  # collector + both 모드 모두
bash scripts/ac8-stub-smoke.sh collector        # 단일 모드
```

- §4.7 sweep 의 stub 2 모드 검증을 CI 자동화로 wrap
- 본인 환경 검증: `collector` PASS + `both` PASS → OVERALL PASS

### 2.4 §5.3 리허설 3회 — defer

데모 직전 협의 시점 (B/C 모두 합석 필요한 자리). 본 회신 시점에서는 미실행.

---

## §3. classify_start_ts placement — C와 합의 항목

code-reviewer가 지적한 사항. 현재 구현:
```rust
join_set.spawn(async move {
    let cs = crate::time_ms();   // ← spawn 안, await 직전
    tracing::info!(classify_start_ts = cs, n_arrived, pid, "classify_start");
    match classifier_client::classify_with_cache(...).await { ... }
});
```

**두 해석 가능**:
- (a) **현재**: tokio 스케줄링 지연 포함 — 큐+RTT (C가 "/classify 응답 도달 시간" 측정 시 적절)
- (b) **대안**: `spawn` 직전 측정 — "burst-detected → verdict" 종단 latency (UI 응답성 측정 시 적절)

C가 `eval-ac4.sh` p99 산출 의도를 알려주면 1줄 이동 가능. **현 채택은 (a)** — C의 AC4 SLA 기준 (p99 < 100ms classifier 응답)에 더 부합한다고 판단.

---

## §4. AC1 3인 재현 — A 환경 PASS 알림

worker-A-timeline §2.4 / `from-worker-a-to-c-2026-05-22.md` §2 후속:

- A 환경에서 `bash ~/velxor-work/ac1-driver.sh` 실행 → **PASS** (node_add 1 + FileWrite 1, ws-record exit 0)
- artifacts: `~/velxor-work/ac1-run/ws-capture.jsonl`
- `walking-skeleton-v1` tag push — **C가 owner**. A 캡처 완료 알렸으므로 push 진행 가능 (B는 사용자 위임으로 cfe7efa 까지 통합 완료, 별도 재현 없음).

---

## §5. 본 회신 동봉 / commit 영역

| commit | 단계 |
|---|---|
| `33adc4c` | C 회신 (어제) |
| `120613e` | v1.1 schema collation |
| `adfbe20` | §5.2 AC4 tracing + Display 회귀 fix |
| `543eccb` | §5.1 AC6 verifier + §5.4 AC8 wrap |
| 본 메시지 | v1.1 + §5 close 통지 (영속화) |

---

## §6. C에 묻는 항목 (응답 부탁)

1. **classify_start_ts placement**: (a) spawn 안 (현재) vs (b) spawn 직전 — `eval-ac4.sh` 의도에 맞춰 1줄 조정 가능
2. **walking-skeleton-v1 tag push 시점**: A/B 통합은 완료. C가 결정.
3. **C 후속 PR 4건 ETA**: v1.1 §9.1 표의 4건. 본 회신 받고 진입 가능.

— Worker A (2026-05-23)
