# Week 4-5 통합 인계 (A → B, C)

> **발신**: Worker A (Rust 단일 owner)
> **발행일**: 2026-05-22
> **대상**: Worker B (UI), Worker C (Python engine)
> **취지**: Week 4-5 §4.1-§4.5 구현이 main에 머지될 시점에 B/C가 코드 변경 없이 통합 가능하도록 인터페이스·런타임·환경변수·운영 시퀀스 정리

---

## 1. 런타임 토폴로지

```
┌──────────────────────┐    fanotify    ┌──────────────────┐
│ kernel (Ubuntu 6.8)  │ ─────────────▶ │ rust-service     │
└──────────────────────┘                │  (single binary) │
                                        │                  │
       POST /classify  ◀────────────────│ aggregator       │
       127.0.0.1:8765                   │  + verdict cache │
                                        │                  │
       WS broadcast   ◀─────────────────│ ws_broadcaster   │
       ws://127.0.0.1:7000              │  + replay 5s     │
                                        │                  │
       HTTP /block/{pid} ◀──────────────│ blocker          │
       http://127.0.0.1:7001            │                  │
                                        └──────────────────┘
                                                ▲
                                  ┌─────────────┴─────────────┐
                                  │                           │
                          ┌───────▼───────┐         ┌─────────▼────────┐
                          │ UI (Electron) │         │ Python /classify │
                          │  WS subscribe │         │ Waitress threads=4│
                          │  Block button │         │                  │
                          └───────────────┘         └──────────────────┘
                              B owner                   C owner
```

---

## 2. 포트 / 엔드포인트 매트릭스

| 포트/경로 | 방향 | DRI | 용도 |
|---|---|---|---|
| `ws://127.0.0.1:7000?last_seq=N` | service → UI | A (서버) / B (클라) | WsMessage broadcast + 5s replay |
| `http://127.0.0.1:7001/block/{pid}` | UI → service | A (서버) / B (클라) | SIGTERM→200ms→SIGKILL block |
| `http://127.0.0.1:8765/classify` | service → engine | A (클라) / C (서버) | POST events → verdict |

**모두 loopback only (127.0.0.1).** 외부 바인딩 금지.

---

## 3. WsMessage 타입 (B 인계)

`WsMessage = { schema_version: "1.0", seq: u64, type: string, payload: object }`

| `type` | `payload` 모양 | 발신 trigger |
|---|---|---|
| `node_add` | BehaviorEventV1 한 건 | collector → 신규 이벤트 |
| `verdict` | `/classify` response 그대로 | aggregator burst → classify 결과 |
| `gap` | `{from: u64, to: u64}` (`seq=0` out-of-band) | replay buffer evict로 N+1 누락 시 |

**B 책임:**
- `seq` 전역 monotonic 단일 시퀀스 (node_add + verdict 동일 seq 공간). dedupe by seq.
- `gap` 수신 시 → **UI full refresh** (그래프 상태 reset).
- 재접속: `?last_seq=N` 쿼리 — 서버가 replay→live 자동 전환, 중복 제거 보장.
- `seq <= last_seq` 무시.

**B에 필요한 TypeScript 타입 힌트:**
```ts
type WsMessage =
  | { schema_version: "1.0"; seq: number; type: "node_add"; payload: BehaviorEventV1 }
  | { schema_version: "1.0"; seq: number; type: "verdict"; payload: ClassifyResponse }
  | { schema_version: "1.0"; seq: 0; type: "gap"; payload: { from: number; to: number } };
```

---

## 4. Block API (B 인계)

```http
POST http://127.0.0.1:7001/block/{pid}
```

응답 JSON:
```json
{ "pid": 1234, "outcome": "killed" }
```

`outcome` enum (snake_case wire):
- `"killed"` — SIGKILL 강제 종료 (SIGTERM 200ms 후 살아있어서 escalate)
- `"terminated"` — SIGTERM 만으로 종료
- `"already_gone"` — kill 시점에 이미 종료됨 (race)
- `"eperm"` — 권한 부족 (서비스가 root/CAP_KILL 부재)
- `"invalid"` — `pid ≤ 1` (init / 프로세스 그룹 broadcast 방어)
- `"error"` — 기타 kill 실패

**B 책임:** UI Block 버튼 클릭 → fetch POST → outcome 표시. `eperm`/`invalid`는 사용자에 명확히 표시 필요.

---

## 5. POST /classify (C 인계)

이미 v1.0 schema 발행분과 동일. 변경 없음.

**C가 알아야 할 클라이언트 동작 (A→C 호출 측):**
- A는 PID별 verdict cache TTL 1초 유지 — 동일 PID 1초 내 재호출 없음
- A는 aggregator 측 1초 debounce도 추가 — 실제 호출률은 burst 시작 시 1회/PID/sec 상한
- reqwest timeout: **200ms**. 초과 시 verdict 미발행 (다음 burst로 이월)
- 200ms 초과는 schema §2.3 SLA p99 < 100ms 위반 → C 측 fallback 룰로 처리 권장

---

## 6. 환경변수

| ENV | 적용 모듈 | 기본값 | 비고 |
|---|---|---|---|
| `VELXOR_STUB` | collector_source | unset | `collector` / `engine` / `both` |
| `VELXOR_EVENTS_PATH` | collector_source (stub) | `./events.jsonl` | stub 모드에서 poll 대상 |
| `VELXOR_WORK` | fanotify_adapter | `$HOME/velxor-work` | fanotify mark 대상 dir (생성됨) |
| `VELXOR_CLASSIFIER_URL` | classifier_client | `http://127.0.0.1:8765/classify` | C가 다른 포트로 옮길 시 |
| `VELXOR_WS_URL` | scripts/ws-record.sh | `ws://127.0.0.1:7000?last_seq=0` | AC1 capture URL |
| `VELXOR_WS_RECORD_SEC` | scripts/ws-record.sh | `5` | 캡처 지속 시간 |

---

## 7. 기동 시퀀스 (C의 run-all.sh 작성용 참고)

```bash
# 1. C: Python engine 먼저 (rust-service의 classify 호출 대상)
source python-engine/.venv/bin/activate
python python-engine/waitress_conf.py &
ENGINE_PID=$!
sleep 1

# 2. A: rust-service (fanotify는 sudo, stub은 그냥)
if [[ -z "${VELXOR_STUB:-}" ]]; then
  sudo -E rust-service/target/release/rust-service &
else
  rust-service/target/release/rust-service &
fi
RUST_PID=$!
sleep 2

# 3. B: UI
(cd ui && npm run dev) &
UI_PID=$!

# (종료) kill $UI_PID $RUST_PID $ENGINE_PID
```

---

## 8. deferred TODO 상태 (2026-05-23 갱신 — Week 8-9 §5 close 후)

### 8.1 ✅ 닫힌 항목 (commit a8c936f / adfbe20 / 543eccb / cfe7efa)

| 위치 | TODO | 닫힌 commit |
|---|---|---|
| `ws_broadcaster.rs` | snapshot 3 lock → `ReplayBuffer::snapshot()` 단일 acquisition | `a8c936f` |
| `ws_broadcaster.rs` | broadcast Lagged 시 synthetic gap emit | `a8c936f` |
| `fanotify_adapter.rs` | AsyncFd + JoinSet + 256 cap + version-mismatch alert | `a8c936f` |
| `aggregator.rs` | HashMap 30s prune + JoinSet abort + 1s debounce + in_flight guard + Arc payload | `a8c936f` |
| `classifier_client.rs` | VerdictCache MAX_ENTRIES + LRU evict + 30s sweep | `a8c936f` |
| `classifier_client.rs` | reqwest Client OnceLock 캐시 + URL 캐시 (hot path 최적화) | `(audit followup)` |
| `aggregator.rs` | VELXOR_AUTOBLOCK env::var OnceLock 캐시 + in_flight single-lock | `(audit followup)` |
| `blocker.rs` | pidfd_open race-free + Pidfd RAII (fallback ENOSYS) | `a8c936f` |
| `blocker.rs` | VELXOR_BLOCK_TOKEN 헤더 + 빈 토큰 거부 | `a8c936f` |
| `blocker.rs` | ConcurrencyLimitLayer 16 (tower) | `a8c936f` |
| `blocker.rs` | `impl Display for BlockResult` (회귀 fix, alert message 직렬화) | `adfbe20` |
| `fanotify_adapter.rs` | FAN_RENAME mask 제거 (EINVAL 회피 — FID class 미요구) | `8713352` |
| AC4 tracing | `event_received_ts` / `ws_sent_ts` / `classify_start_ts` / `classify_end_ts` / `n_arrived` / `latency_ms` emit | `adfbe20` |
| AC6 verifier | `scripts/ac6-verify-block.sh` (POST /block/{pid} → kill -0 ESRCH) | `543eccb` |
| AC8 wrap | `scripts/ac8-stub-smoke.sh` (collector + both 자동화) | `543eccb` |
| §5.3 리허설 | `scripts/rehearsal.sh` 3 iter + `docs/AC-rehearsal-report-2026-05-23.md` | `45c842b` |
| v1.1 emit | `dropped_saturated` + `image_path_resolved` optional 필드 (sentinel 시) | `(audit followup)` |

### 8.2 ⏳ 잔여 (의도 defer)

| 위치 | TODO | 사유 | 회수 시점 |
|---|---|---|---|
| `blocker.rs:166` | 토큰 비교 timing-safe (`subtle::ConstantTimeEq`) | demo 데모용 가벼움. Loopback only가 1차 방어. | 데모 후 prod hardening |
| `aggregator.rs::run()` Lagged arm | broadcast lag 시 windows 카운터 undercount 측정 | §4.7 stress lag undercount 측정 후 결정 | Week 8-9 후속 stress test |
| `fanotify_adapter.rs` | FileRename 본격 구현 (FAN_REPORT_DFID_NAME class 전환) | event metadata layout 전체 재작성 필요. v1.1 schema 합의 후. | v1.1 collation 후 별도 PR |
| `fanotify_adapter.rs` | FAN_MARK_MOUNT → per-dir filter (스코프 좁히기) | 데모용 시연 mark는 mount 전체 OK (6000 ev/s 노이즈 인지) | 데모 후 또는 stress 측정 시 |

§4.7 sweep 시 FAN_RENAME mask는 init flag로 `FAN_REPORT_FID/DIR_FID/DFID_NAME` 중 하나를 요구함이 확인되어 EINVAL이 발생, mask에서 제거함. event metadata layout 전체 재작성 필요 (no per-event fd, name이 `FAN_EVENT_INFO_TYPE_*`로 전달) — v1.1 schema collation 후 별도 PR로 진행.

---

## 9. 리허설 전 체크리스트 (B, C 각자 확인)

- [ ] B: WS 5초 끊김 후 `?last_seq=N`으로 재접속 → backlog + 정합성
- [ ] B: `gap` 수신 → UI full refresh 검증
- [ ] B: Block 버튼 → outcome 6가지 모두 화면 표시 가능
- [ ] C: `/classify` 200ms 내 응답 (실패 시 fallback rules)
- [ ] C: events 배열 빈 경우 / 1개 / 수십개 모두 안전 처리
- [ ] A: `VELXOR_STUB=both`/`collector` 단독 기동 → AC1/AC8 통과 (이미 Week 1 검증)
- [ ] A: 실 fanotify (sudo) → `touch ~/velxor-work/src/foo` 시 WS로 node_add 1건 (§4.7 일부)

---

## 10. 응답 채널 / 질문

이 문서에 관한 질문 / 인터페이스 변경 제안:
- 본 문서 PR comment, 또는 `contracts/v1.1-review-trigger.md` 동일 채널
- v1.1 schema collation (2026-05-24 마감)과 별개로 운영 합의는 즉시 반영 가능

---

## 11. §4.7 sweep 검증 결과 (2026-05-22)

세 모드 모두 PASS — `~/velxor-work/sweep-{both,collector,real}/` 에 아티팩트.

| Mode | 트리거 | node_add | verdict | 결과 |
|---|---|---|---|---|
| `VELXOR_STUB=both` | events.jsonl 60건 FileWrite burst | 60 | 1 (0.95) | **PASS** |
| `VELXOR_STUB=collector` | 동일 | 60 | 1 (0.95) | **PASS** |
| unset (실 fanotify, sudo) | `touch + echo > ~/velxor-work/src/foo` | 36,097 (6초) | 6 | **PASS** |

**관찰 사항**:
- FAN_MARK_MOUNT가 `/home` mount 전체를 마크 → 시스템 전반 파일 활동 유입 (6000 ev/s). 데모 범위에선 무관하지만, Week 8-9 §5 stress 시 per-dir mark 또는 path filter 검토 필요.
- 단명 PID 시 `image_path:"<unknown:pid=N>"` sentinel 정상 동작 (Worker-A v1.1 note #4).
- verdict cache TTL 1s × multi-PID burst → 6초간 6 verdict (PID당 1초 1회 상한).

재현:
```bash
# stub 2 모드
bash ~/velxor-work/sweep-mode.sh both both
bash ~/velxor-work/sweep-mode.sh collector collector
# 실 fanotify (sudo)
bash ~/velxor-work/sweep-fanotify.sh
```
(스크립트는 워크 dir 외부 인프라 — 리포지토리 미포함. C의 `run-all.sh` 와는 별개.)
