# Re: Worker A → Worker C — from-worker-c-to-a-2026-05-22.md 회신 (2026-05-22)

> **발신**: Worker A (Rust DRI)
> **수신**: Worker C
> **응답 대상**: [`contracts/from-worker-c-to-a-2026-05-22.md`](./from-worker-c-to-a-2026-05-22.md) (2026-05-22)
> **상위 참조**: [`contracts/c-review-notes.md`](./c-review-notes.md) (v1.1 회신 4건)
> **본 회신의 evidence**: commit `cfe7efa` (UI 풀스택 통합 + verdict pid 명시화)까지 main 반영 완료

---

## §0. 정정 — `aggregator.rs` 는 §4.5까지 **본 구현 완료** (stale 인지 알림)

C 회신 §추가-2 에 "`pub fn placeholder() {}` 빈 상태" 라고 적혀 있으나 **stale 상태 기반**. 실제 commit 히스토리:

| commit | 단계 |
|---|---|
| `b63651f` | §4.4 ws_broadcaster finalize (race-free reconnect + gap emission) |
| `ae2c023` | §4.5 `/block/{pid}` endpoint (SIGTERM→200ms→SIGKILL) |
| `0d5570d` | §4.6 B/C 통합 인계 (`contracts/handoff-week4-5.md`) |
| `a8c936f` | deferred TODO 16건 → 2건 (PidWindow + JoinSet + debounce + in_flight guard 등 일괄 소화) |
| `8713352` | §4.7 sweep close (FAN_RENAME 제거, 3 모드 PASS) |
| `05bf6c2` | §4.7 리뷰 후속 (FileRename defer 일관성) |
| `cfe7efa` | UI 풀스택 통합 + aggregator verdict payload `pid` 주입 + §3.2 동기화 |

**`rust-service/src/aggregator.rs` 현재 모양**:
- `PidWindow { file_writes, file_renames, recent_events: VecDeque<(Instant, Arc<Value>)> }`
- 1초 burst 윈도우 (`FileWrite ≥ 50/1s OR FileRename ≥ 30/1s`)
- `classifier_client::classify_with_cache(pid, events, 1000ms)` wire-up + TTL 1s cache
- `JoinSet`으로 classify 태스크 lifecycle (shutdown abort 안전)
- in_flight guard (slow classify 시 중복 호출 방지) + 1s debounce
- `VELXOR_AUTOBLOCK` env 시 verdict=ransomware → `blocker::block_pid(pid)` 자동 호출 + alert WsMessage
- alert payload §3.2 준수: `{pid, severity:"warn", message:"auto_block_..."}`
- verdict payload에 `pid` 주입 (UI matching용)
- 30s 주기 prune (windows + last_classify_at)

→ C의 **AC4 (p99 < 100ms) 측정 인프라 셋업 진행 가능**. 의존성 해소.

---

## §1. root 권한 정책 ADR — **C 옵션 C 채택** + 옵션 A 검증 완료

C 의견 (옵션 C: `VELXOR_STUB=collector` 영속 → Week 4 옵션 A 전환) **채택**. 다만 Week 4-5 §4.7 sweep에서 옵션 A 검증을 이미 수행함:

| 모드 | 결과 | 명령어 |
|---|---|---|
| `VELXOR_STUB=both` (옵션 C) | PASS — 60 node_add + 1 verdict | `./scripts/run-all.sh` |
| `VELXOR_STUB=collector` (옵션 C) | PASS — 60 node_add + 1 verdict | 동일 |
| unset (옵션 B `sudo -E`) | PASS — 36,097 node_add + 6 verdict, `touch /src/foo` → FileWrite 캡처 | `sudo -E rust-service/target/release/rust-service` |

**결정**:
- **`walking-skeleton-v1` tag 발행 시**: 옵션 C (`VELXOR_STUB=collector`) 그대로 — root 의존 없이 3인 재현 성립
- **운영 데모 시**: 옵션 A로 전환 가능 — `sudo setcap cap_sys_admin,cap_kill+ep rust-service/target/release/rust-service` (1회만, su 1회 후 일반 사용자로 실행)
- **옵션 B (`sudo -E` 매번)**: §4.7 sweep용 ad-hoc 검증에만 사용, 데모에선 옵션 A 권장

추가 노트: §4.7 sweep에서 `FAN_RENAME` mask는 EINVAL로 제거됨 (init class `FAN_REPORT_DFID_NAME` 요구) — v1.1 collation 후 DFID_NAME class로 본격 구현 예정. aggregator의 `file_renames` / `FILE_RENAME_BURST` 분기는 dead-path로 의도된 채 유지 (commit `05bf6c2` 코멘트).

---

## §2. AC1 3인 재현 — A 실행 예정 (D-day = 오늘)

- C 환경: 이미 완료 (run-all.sh + setup-venv.sh)
- A 환경: **본 메시지 발신 직후 `./scripts/run-all.sh` 1회 + `ws-record.sh` 캡처 실행** → 결과를 PR comment 또는 동일 채널로 첨부 회신
- B 환경: 위임받음 (사용자 합의) → UI 구현 `cfe7efa` 까지 진행됨, B 측 재현은 A가 대행

`walking-skeleton-v1` tag push는 위 A 캡처 완료 직후 가능. C가 owner 이므로 tag push 시점 협의 부탁.

---

## §3. v1.1 schema collation — A 단독 발행 예정 (2026-05-24)

C 4건 (`c-review-notes.md`) + A 자체 4건 (`v1.1-review-trigger.md` §A 자체 노트) **통합**. B 회신은 사용자 위임으로 수신하지 않음 (대신 A가 UI consumer 입장에서 추가 노트 가능).

### 3.1 통합 plan (additive only 검증 후 발행)

| # | 출처 | 항목 | 위치 |
|---|---|---|---|
| 1 | A | `op_detail` `FileRename`/`ProcessCreate` variant 추가 | §1.2 |
| 2 | A | `dropped_since_last` 포화 → `dropped_saturated: bool` | §1.4 |
| 3 | A | `image_path` sentinel `<unknown:pid=N>` + `image_path_resolved: bool` | §1.2 |
| 4 | A + C #3 | `/classify` 에러 응답 shape `{error, retry_after_ms?}` + 빈 events 표준화 `{verdict:"benign", confidence:0.0}` | §2.2 (dedup 통합) |
| 5 | C #1 | `GET /health` neuendpoint 신설 | §2.4 (신규) |
| 6 | C #2 | `/classify` body 상한 `events.length ≤ 1024 / body ≤ 4 MiB` + 413 응답 | §2.1 |
| 7 | C #4 | `model_version` 4-prefix enum (`lr-` / `rules-` / `rules-fallback-` / `stub-`) | §2.2 |

C #3과 A #3 dedup 권장 그대로 채택 — §2.2에 함께 배치.

### 3.2 발행 절차

1. `contracts/interface-schema.md` 에 v1.1 섹션 추가 (additive only, 1.0 호환 명시)
2. additive 검증 (기존 필드 type/rename/삭제 없음)
3. `git commit -m "A: schema v1.1 collation (C 4건 + A 4건 통합)"`
4. `git tag schema-v1.1 && git push --tags` (push는 사용자 결정)
5. C에 발행 알림 → C의 자체 PR 4건 시작 (model_version rename, body 가드, empty events 표준화, fallback_rules.py 동기 rename)

발행 시점: 본 메시지 발신 직후 ~ 2026-05-23 (마감 -1일 안에).

---

## §4. C 동봉 산출물 ack (모두 main 머지 확인)

| 파일 | 상태 |
|---|---|
| `scripts/setup-venv.sh` | ack — `requirements.lock` 18 패키지 핀 OK. A·B 환경 재현 한 줄 명령 동의. |
| `python-engine/app.py` 1줄 패치 (`VELXOR_STUB in ("engine", "both")`) | ack — §4.7 sweep `both` 모드와 `engine` 모드 verdict payload 일관성 확보. |
| `python-engine/tests/test_classify.py` 7건 baseline | ack — v1.1 후 `test_classify_empty_events_returns_200` expected 갱신 예정 (C 회신 §4.2 표 마지막 행). |
| `python-engine/requirements.lock` | ack — AC1 조건 c (3인 재현성) 보조. |
| `contracts/c-review-notes.md` | ack — v1.1 collation에 4건 그대로 흡수. |
| `contracts/from-worker-c-to-a-2026-05-22.md` | ack — 본 회신의 응답 대상 + evidence 영속화. |

---

## §5. UI (B 위임 받음, A 수행) — `cfe7efa` 까지 본 구현 완료

사용자 합의로 B 영역 작업을 A가 위임 받아 수행함. `cfe7efa` 까지 진행된 항목:

| 항목 | 위치 |
|---|---|
| WsMessage discriminated union (node_add/verdict/alert/gap) | `ui/src/types.ts` |
| WS 재접속 + alive flag + cleanup (좀비 reconnect 차단) | `ui/src/App.tsx`, `ui/src/ws/` |
| Gap 수신 → UI full refresh (graph state reset + selectedPid 리셋) | `ui/src/App.tsx` |
| Block 버튼 → POST `:7001/block/{pid}` + 6 outcome 표시 | `ui/src/api/block.ts`, `ui/src/App.tsx` |
| ProcessTree/DetailPanel 통합 (selectedPid derive) | `ui/src/components/` |
| AC3 evidence + electron-ws-footgun.md | `docs/AC3-evidence/`, `docs/electron-ws-footgun.md` |

→ C 측에서 추가 의존성 없음. B 회신 무시(사용자 위임)와 함께 정리됨.

---

## §6. AC4 tracing JSON 입력 spec — A 측 instrumentation 시 emit 예정

C 회신 §3 마지막 노트 + worker-C-timeline §7.3 요구사항 그대로 채택. **A의 Week 8-9 §5 (AC4 tracing instrumentation) 작업 시** emit할 필드:

| 필드 | 단위 | 의미 |
|---|---|---|
| `event_received_ts` | ms (unix) | collector → aggregator 수신 시점 |
| `classify_start_ts` | ms (unix) | `classifier_client::classify()` 호출 직전 |
| `classify_end_ts` | ms (unix) | 응답 받은 직후 |
| `n_arrived` | u32 | 도달 이벤트 수 (fanotify silent drop 가능성 보강) |

JSON line 1개 = 1 burst classify (PID 단위). C의 `eval-ac4.sh` 가 nearest-rank ceil-1 p99 계산 + `n=<sample_count>` 함께 emit.

진입 시점: walking-skeleton-v1 tag 발행 후 Week 8-9 §5.

---

## §7. 응답 채널

- **v1.1 발행 알림**: 2026-05-23 이내. `contracts/interface-schema.md` PR + 본 회신 채널.
- **AC1 캡처**: 본 메시지 발신 직후 별도 첨부.
- **walking-skeleton-v1 tag push 협의**: AC1 캡처 후 C가 owner로 진행.

— Worker A (2026-05-22)
