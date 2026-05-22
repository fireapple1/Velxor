# 작업자 A — 처음부터 끝까지 해야 할 일

> **Source of truth**: `role-assignment.md` (Iteration 5, 2026-05-22 재분배)
> **브랜치**: `devA` (모든 PR은 `devA → main`)
> **총 예산**: ~62h | **최대 부하**: Week 1 (16h) · Week 4-5 (21h)

---

## 한 페이지 요약

### A의 총 부하 (~62h) — 주차별 분포

| Week | 예산 | 성격 |
|------|------|------|
| Week 0 | 9h | 사전 흡수 (학기 시작 ≥1주 전) |
| Week 1 | 16h | **최대 부하 #1** — critical path 시작 |
| Week 3 | 3h | 스키마 review collation |
| Week 4-5 | 21h | **최대 부하 #2** — Rust 본구현 정점 |
| Week 8-9 | 10h | 자동 차단 + tracing + 리허설 |
| Week 10 | 3h | 슬라이드 발표 |

### Critical Path 다이어그램 (ASCII)

```
[Week 0] fanotify smoke ──────────────────────────────────────┐
    │                                                          │
    ▼                                                          ▼
[Week 1] Interface Contract v1-draft 발행 ──→ B: UI stub 작성 가능
    │                 └────────────────────→ C: engine stub 작성 가능
    │
    ▼
[Week 3] v1.1 schema collation (B/C 노트 수집 48h → A 단독 발행)
    │
    ▼
[Week 4-5] libfanotify 본구현 ─────────────────────────────────┐
    │       aggregator burst detection                         │
    │       classifier_client (verdict cache)                  │
    │       ws_broadcaster (broadcast/VecDeque 분리 finalize)   │
    │                                                          │
    ├── → B의 Block 버튼 ↔ /block/:pid IPC 결선               │
    └── → C의 /classify real model 통합                       │
                                                               │
[Week 8-9] 자동 차단(SIGTERM→SIGKILL) + tracing JSON emit ←───┘
    │       리허설 3회 collector 안정성 모니터링
    │
    ▼
[Week 10] 슬라이드 Rust 섹션 (libfanotify + broadcast/replay + AC6)
```

> A가 막히면: B는 stub WS로 진행 가능. C는 `/classify` 호출 측 부재로 통합 검증 불가.
> **A 지연 즉시 대응**: `VELXOR_STUB=both` 영속 → B/C 단독 진행, A는 격리 진행.

### 7대 절대 책임

| # | 책임 | 위반 시 결과 |
|---|------|------------|
| 1 | Week 0 AC(fanotify smoke) 실패 시 **즉시** inotify 백업 가동 결정 | Week 4-5 통째 손실 |
| 2 | Interface Contract v1-draft를 **Week 1 안에 발행** (Rust DRI + C/B ack 요청) | B/C 진행 차단 |
| 3 | `BehaviorEventV1` 송신: mutex 보유 / signal handler context **금지** → enqueue 후 worker dispatch | collector hang, 이벤트 손실 |
| 4 | `dropped_since_last` silent drop 금지 — 항상 다음 successful send에 동봉 | 데이터 손실 원인 추적 불가 |
| 5 | WS broadcast(live)와 VecDeque(replay) **분리** — 같은 채널에 넣으면 lock contention + client 메시지 중복 | reconnect 5초 replay 동작 안 함 |
| 6 | Week 3 v1.1 review 48h 데드라인 — 무응답 시 **단독 발행 결단** | 일정 지연 |
| 7 | collector crash 1회 시 **즉시** `VELXOR_STUB=collector` 전환 (망설이지 말 것) | 데모 사망 |

### 비상 시 즉시 조치

```bash
# 1. collector crash → stub 전환
export VELXOR_STUB=collector && (cd rust-service && cargo run --release)

# 2. fanotify_init EPERM → inotify 백업
inotifywait -m -r ~/velxor-work/src &

# 3. WS reconnect 5초 replay 실패 → gap 메시지 강제 emit으로 UI full refresh
# ws_broadcaster.rs에서 {type:"gap", payload:{from:N+1, to:head_seq}} 송신 확인

# 4. classify p99 100ms 초과 → C의 fallback_rules 영속 요청 (A는 timeout 단축 안 함)
# C에게 알림: model_version="rule-based-v1" fallback으로 전환 요청

# 5. A 전체 지연 → 전체 stub 모드
export VELXOR_STUB=both && (cd rust-service && cargo run --release)
```

---

## Week 0 — 환경 + fanotify smoke + Rust scaffold

> ⏱️ **9h** | 🎯 fanotify smoke 통과 + Rust 의존성 락 + devA 브랜치 push | 📅 학기 시작 ≥1주 전 완료 필수

### 사전 1회 확인 (5분)

- [ ] 🛠️ `git checkout -b devA origin/main || git checkout devA` 실행
- [ ] 🛠️ apt baseline 설치: `build-essential clang pkg-config libssl-dev git curl jq rsync unzip p7zip-full`
- [ ] 🛠️ Rust 1.78.0 설치: `rustup default 1.78.0` + `rustc --version` 확인
- [ ] 🛠️ `cargo install websocat` 실행
- [ ] 🛠️ `uname -r` (6.8.x 확인) + `grep CONFIG_FANOTIFY /boot/config-$(uname -r)` (=y 확인)
- [ ] 🛠️ `cat /proc/sys/kernel/lockdown` → `none` 또는 파일 없음 확인 (confidentiality 모드면 BPF/특권 제한)

### 0.1 [3h] fanotify smoke (Week 0 AC) ⚠️

- [ ] 🦀 `smoke/fanotify_smoke/` 디렉토리 생성 및 `cargo init --bin fanotify_smoke`
- [ ] 🦀 `Cargo.toml`에 `nix = { version = "0.28", features = ["fanotify"] }` 추가
- [ ] 🦀 `fanotify_smoke.rs` 작성 (`FAN_CLASS_NOTIF` init + `FAN_MODIFY|FAN_CLOSE_WRITE` mark + 단일 캡처 출력)
- [ ] 🧪 `cargo build --release` 후 `sudo ./target/release/fanotify_smoke &` + `touch ~/velxor-work/src/foo` → **"FAN_MODIFY captured (N bytes)" 출력 확인**
- [ ] ⚠️ **실패 시 즉시 inotify 백업 결정** (0.2로 이동, 슬라이드 "permission caveats" 기록)

### 0.2 [1h] inotify 백업 spike

- [ ] 🛠️ `sudo apt install -y inotify-tools`
- [ ] 🧪 `inotifywait -m -r ~/velxor-work/src &` + `touch ~/velxor-work/src/bar` → "MODIFY" 이벤트 1줄 확인
- [ ] 📜 슬라이드용 "permission caveats" 1줄 메모 보존 (fanotify 실패 대비 대안 경로)

### 0.3 [4h] Rust 통합 서비스 scaffold

- [ ] 🦀 `cargo new rust-service --bin` 실행
- [ ] 🦀 `Cargo.toml`에 의존성 추가: `tokio(full)`, `tokio-tungstenite(0.21)`, `futures-util(0.3)`, `reqwest(0.12,json)`, `serde(derive)`, `serde_json`, `tracing`, `tracing-subscriber(json,env-filter)`, `nix(0.28,signal+process+fanotify+fs)`, `anyhow`, `thiserror`, `url(2)`
- [ ] 🦀 `cargo build` 실행 → **빈 main 컴파일 통과 + 의존성 락 확인**

### 0.4 [1h] Week 0 커밋

- [ ] 🧪 `websocat --version` 동작 확인
- [ ] 📜 `git add rust-service smoke` + `git commit -m "A: week0 fanotify smoke + cargo scaffold + dependency lock"`
- [ ] 📜 `git push -u origin devA`

---

### 🚦 Week 0 완료 게이트

```
- [ ] fanotify smoke "FAN_MODIFY captured" 출력 확인 (또는 inotify 백업 결정 완료)
- [ ] cargo build 통과 (의존성 락)
- [ ] devA 브랜치 push 완료
- [ ] websocat --version 동작 확인
→ B/C에게 "Week 1 진입 가능" 신호 전달
```

---

## Week 1 — Interface Contract + 4 Rust stubs + AC1 walking skeleton

> ⏱️ **16h** | 🎯 v1-draft 발행 + 4 Rust stub + ws-record.sh + AC1 PASS | 📅 **최대 부하 #1 — critical path 시작**

### 1.1 [Day 1, 4h] Interface Contract v1-draft 발행 ⚠️ 📜

- [ ] 📜 `contracts/` 디렉토리 생성
- [ ] 📜 `contracts/interface-schema.md` 작성 — 다음 6개 섹션 포함:
  - `BehaviorEventV1` JSONL 스키마 (seq, dropped_since_last, pid, parent_pid, image_path, event_type, file_path, volume_id, op_detail, ts_unix_ms)
  - Wire 규칙: UTF-8 JSONL, max 4 KiB/msg, truncate 시 `op_detail.path_truncated: true`
  - Collector-side 송신 정책: `SO_SNDTIMEO=10ms`, mutex 보유/signal handler context **금지**, silent drop 금지
  - REST `POST /classify` req/resp 스키마 (C DRI 섹션)
  - WS message 스키마 + reconnect 프로토콜 (`?last_seq=N`, gap emit, dedupe)
  - `VELXOR_STUB` semantics 표 (unset/collector/engine/both)
- [ ] 📜 `git add contracts/interface-schema.md && git commit -m "A: week1 interface-schema v1-draft (Rust DRI sections)"` + push
- [ ] 🤝 **B에게 전달**: PR 링크 + "WS message decode compiles-against-ui" **한 줄 mechanical ack 요청** (의미 검토는 Week 3)
- [ ] 🤝 **C에게 전달**: PR 링크 + "/classify req/resp compiles-against-engine" **한 줄 mechanical ack 요청**

### 1.2 [Day 2, 4h] Rust 서비스 4 stub 🦀

- [ ] 🦀 `rust-service/src/main.rs` 작성 (tokio runtime + broadcast::channel(1024) + ws_broadcaster::run + collector_source::run 스폰)
- [ ] 🦀 `rust-service/src/ws_broadcaster.rs` 작성 — `WsMessage` 구조체 + `ReplayBuffer(Arc<Mutex<VecDeque>>)` + `run(tx, replay, port)` 스켈레톤 (broadcast/VecDeque 분리는 Week 4-5 finalize)
- [ ] 🦀 `rust-service/src/collector_source.rs` 작성 — `VELXOR_STUB` 분기 + `poll_events_jsonl` (200ms sleep 명시, events.jsonl offset 추적)
- [ ] 🦀 `rust-service/src/aggregator.rs` 작성 — `pub fn placeholder() {}` 스켈레톤 (Week 4-5 본구현)
- [ ] 🦀 `rust-service/src/classifier_client.rs` 작성 — `reqwest::Client::new().post("http://127.0.0.1:8765/classify")` stub
- [ ] 🦀 `cargo build` 통과 확인
- [ ] 📜 `git add rust-service/ && git commit -m "A: week1 4 rust stubs"` + push

### 1.3 [Day 3, 3h] `scripts/ws-record.sh` 작성 🦀

- [ ] 🦀 `scripts/ws-record.sh` 작성: `timeout 5 websocat -n1 'ws://127.0.0.1:7000?last_seq=0' | tee $OUT` + `grep '"node_add"' && grep '"FileWrite"'` → AC1 PASS/FAIL
- [ ] 🛠️ `chmod +x scripts/ws-record.sh && git update-index --chmod=+x scripts/ws-record.sh`
- [ ] 📜 `git add scripts/ws-record.sh && git commit -m "A: week1 ws-record.sh (AC1 ws capture check)"` + push

### 1.4 [Day 4, 2h] walking skeleton 통합 리허설 🔌

- [ ] 🔌 C의 `run-all.sh` 준비 여부 확인 — 🤝 **C**: run-all.sh 작성 완료 확인 요청 (없으면 수동으로 `VELXOR_STUB=both cargo run --release` 실행)
- [ ] 🔌 `VELXOR_STUB=both` 환경에서 Rust 서비스 기동
- [ ] 🔌 `events.jsonl`에 mock `BehaviorEventV1` 1줄 추가
- [ ] 🧪 `scripts/ws-record.sh /tmp/ws.jsonl` → AC1 PASS 확인

### 1.5 [Day 5, 1h] mechanical ack 수합

- [ ] 🤝 **B의 ack** 수신 확인: "compiles-against-ui" (WS message decode 가능 여부)
- [ ] 🤝 **C의 ack** 수신 확인: "compiles-against-engine" (/classify req/resp 모양)
- [ ] 📜 ack 수신 시 B/C에 알림: "`walking-skeleton-v1` tag는 C(run-all.sh owner)가 push — 준비되면 push 요청"

### 1.6 [Day 5, 2h] 안정화

- [ ] 🦀 `cargo clippy --all-targets -- -D warnings` + `cargo build --release` 통과
- [ ] 🧪 `git tag -l 'walking-skeleton-v1'` 확인 (C push 대기 중이면 fetch 후 재확인)

---

### 🚦 Week 1 완료 게이트

```
- [ ] contracts/interface-schema.md v1-draft push 완료
- [ ] 4 Rust stub cargo build --release 통과
- [ ] scripts/ws-record.sh AC1 PASS (node_add + FileWrite 캡처)
- [ ] B의 "compiles-against-ui" ack 수신 (또는 48h 후 단독 진행)
- [ ] C의 "compiles-against-engine" ack 수신 (또는 48h 후 단독 진행)
→ walking-skeleton-v1 tag (C push) fetch 완료
→ B/C에게 "Week 3까지 schema review 노트 준비 요청" 사전 예고
```

---

## Week 3 — Schema v1.1 collation

> ⏱️ **3h** | 🎯 schema-v1.1 tag push + B/C 알림 | 📅 A 주관 async 48h review

### 3.1 [Day 1, 0.5h] B/C에 review trigger 송부 📜

- [ ] 📜 B/C에게 다음 형식으로 review 요청 발송:
  ```
  [Subject] Velxor schema v1.1 review — 48h deadline
  v1-draft: contracts/interface-schema.md @ <commit-sha>
  요청: 본 schema에서 missing/wrong field 1개 (필드명 + 이유 + additive 제안)
  Deadline: <timestamp + 48h>
  무응답 시 그대로 발행 (next review로 이월) — Principle 4
  ```
- [ ] 🤝 **B에게**: WS message / reconnect 핸드셰이크 부분 review input 요청 (UI consumer 관점)
- [ ] 🤝 **C에게**: `/classify` resp 신규 필드 / `op_detail` 정의 관련 Python DRI 노트 요청

### 3.2 [48h 후, 2h] 노트 통합 + v1.1 발행 📜

- [ ] 📜 수신 노트 검토 (무응답이어도 A 단독 발행 강행 — Principle 4)
  - 예: B 노트 → `WsMessage.payload.confidence` 필드 추가
  - 예: C 노트 → `BehaviorEventV1.op_detail.entropy_hint` 정의 보완
  - 예: A 자체 → `dropped_since_last` overflow 정책 명시
- [ ] 📜 `contracts/interface-schema.md` 수정 — **additive only** (기존 필드 type 변경 금지, wrong-typed는 `*_v2` parallel field)
- [ ] 📜 `git tag schema-v1.1` + `git add contracts/interface-schema.md && git commit -m "A: week3 schema v1.1 (additive: <field list>)"` + `git push --tags && git push`

### 3.3 [0.5h] v1.1 발행 알림 🔌

- [ ] 🤝 **B에게 알림**: "schema-v1.1 tag push 완료 — ws/client.ts에 신규 필드 decode 추가 요청"
- [ ] 🤝 **C에게 알림**: "schema-v1.1 tag push 완료 — /classify resp에 신규 필드 emit 요청"
- [ ] 📜 무응답이어도 v1.1 발행은 완료 처리 (Principle 4 — 의도된 trade)

---

### 🚦 Week 3 완료 게이트

```
- [ ] schema-v1.1 tag push 완료
- [ ] B/C에 v1.1 발행 알림 발신 완료
- [ ] additive-only 원칙 준수 확인 (기존 필드 타입 변경 없음)
→ Week 4-5 본구현 진입 가능
```

---

## Week 4-5 — libfanotify 본구현 + Rust service 완성

> ⏱️ **21h** | 🎯 실 libfanotify fanotify FAN_MODIFY/CLOSE_WRITE 캡처 + service 완성 + 통합 결선 | 📅 **최대 부하 #2 — A critical path 정점**

### 4.1 [Day 1-3, 9h] libfanotify 어댑터 본구현 🦀

- [ ] 🦀 `collector_source.rs`에 `run_fanotify()` 구현:
  - `Fanotify::init(FAN_CLASS_NOTIF, O_RDONLY)` + `fanotify_mark(FAN_MARK_ADD|FAN_MARK_MOUNT, FAN_MODIFY|FAN_CLOSE_WRITE|FAN_OPEN_EXEC)`
  - `FAN_RENAME` 지원 (kernel 6.8 기능) 추가
  - `tokio::task::spawn_blocking`으로 blocking read (tokio runtime 점유 금지)
- [ ] 🦀 `/proc/<pid>/exe` readlink → `image_path` 보강 (PID race 대비: fanotify FD 닫기 전 stat)
- [ ] 🦀 `/proc/<pid>/status` 파싱 → `parent_pid` (PPid: 라인 추출)
- [ ] 🦀 UNIX socket `/run/velxor/events.sock` 또는 stdout pipe 송신 구현:
  - `SO_SNDTIMEO=10ms` 설정
  - mutex 보유 중 송신 **금지** (사전 enqueue → worker task dispatch)
  - signal handler context에서 송신 **금지**
  - timeout/ring buffer full → `dropped_since_last++`, silent drop 금지
- [ ] 🦀 큐 깊이 1024, `dropped_since_last` 누적 후 다음 successful send에 동봉

### 4.2 [Day 4, 3h] `aggregator.rs` 완성 🦀

- [ ] 🦀 `PidWindow` 구조체: `file_writes: Vec<Instant>` + `file_renames: Vec<Instant>`
- [ ] 🦀 `add(event_type, now)` + `prune(cutoff 5s)` 구현
- [ ] 🦀 `burst_1s(now)` 구현: `FileWrite ≥ 50/1s OR FileRename ≥ 30/1s` → `true`
- [ ] 🦀 burst 감지 시 `classifier_client::classify_with_cache(...)` 호출 → verdict → `WsMessage("verdict")` fan-out 연결

### 4.3 [Day 5, 3h] `classifier_client.rs` 완성 🦀

- [ ] 🦀 `VerdictCache` 구조체: `Mutex<HashMap<u32, (Instant, serde_json::Value)>>`, TTL 1s
- [ ] 🦀 `get(pid)` — TTL 초과 시 `None` 반환
- [ ] 🦀 `put(pid, v)` 구현
- [ ] 🦀 `classify_with_cache(cache, pid, events, window_ms)` — cache hit 시 즉시 반환, miss 시 REST POST + cache 갱신
- [ ] 🤝 **C에게 확인**: `/classify` endpoint가 `http://127.0.0.1:8765` 포트 + req/resp 스키마 v1.1 준수 여부 확인

### 4.4 [Day 6, 3h] `ws_broadcaster.rs` 완성 (broadcast/VecDeque 분리 finalize) 🦀

- [ ] 🦀 `broadcast::channel(1024)` = **live fan-out 전용** (신규 Receiver만 receive)
- [ ] 🦀 `ReplayBuffer(Arc<Mutex<VecDeque<(Instant, WsMessage)>>>)` = **5초 sliding window 별도 운영**
- [ ] 🦀 accept 시 `?last_seq=N` query 파싱 (`url::Url::parse(&format!("ws://x{}", uri))`)
- [ ] 🦀 `replay.since(last_seq)` → 즉시 push → broadcast::Receiver forward 구현
- [ ] 🦀 5초 초과로 N+1 evict 감지 시 `{type:"gap", payload:{from:N+1, to:head_seq}}` emit → UI full refresh 트리거
- [ ] 🦀 client dedupe: 동일 seq 중복 수신 시 두 번째 무시
- [ ] ⚠️ **footgun 주의**: replay를 broadcast 채널에 넣지 말 것 — 반드시 분리된 VecDeque 운영

### 4.5 [Day 7, 1h] `/block/:pid` HTTP endpoint hook 준비 🦀

- [ ] 🦀 `main.rs`에 HTTP endpoint `/block/:pid` 추가 (warp 또는 axum, tokio 기반)
- [ ] 🦀 `block_handler(pid)` 구현: `kill(Pid, SIGTERM)` → 200ms 대기 → `kill(None)` 체크 → 살아있으면 `SIGKILL` fallback
- [ ] 🦀 `EPERM` → 로그 + `Err("EPERM")`, `ESRCH` → `Ok("already gone")`
- [ ] 🤝 **B에게 알림**: "/block/:pid HTTP POST endpoint 준비 완료 — UI Block 버튼 IPC 연결 가능" (포트 번호 확정 전달)

### 4.6 [통합 포인트] B/C와 결선 🔌

- [ ] 🔌 🤝 **B와 IPC 시그니처 확정**: `POST /block/:pid` → kill 시퀀스 연결 확인 (단방향: B → A)
- [ ] 🔌 🤝 **C와 `/classify` 실 모델 연결 확인**: C의 Waitress `python-engine/waitress_conf.py` 기동 후 A의 `classifier_client`에서 호출 통과 확인 (양방향: A 호출 → C 응답)
- [ ] 🔌 🤝 **C에게 확인**: `run-all.sh` 내에서 `cargo run --release` (rust-service) 호출 경로 검토 — C가 자기 환경에서 `cargo build` 통과 보장 요청

### 4.7 [통합 검증] VELXOR_STUB 3 모드 sweep 🧪

- [ ] 🧪 `VELXOR_STUB=` unset → 실 libfanotify: `touch ~/velxor-work/src/foo` → WS `node_add{event_type:"FileWrite"}` 1건 확인
- [ ] 🧪 `VELXOR_STUB=collector` → `events.jsonl` poll: mock 1줄 추가 → WS 확인
- [ ] 🧪 `VELXOR_STUB=both` → events.jsonl + 하드코드 verdict: 전체 파이프라인 stub 동작 확인
- [ ] 🧪 burst 50+ 이벤트 시 verdict 호출 + WS verdict 메시지 1건 확인
- [ ] 📜 `git add rust-service/ && git commit -m "A: week4-5 libfanotify impl + aggregator + ws_broadcaster finalize"` + push

---

### 🚦 Week 4-5 완료 게이트

```
- [ ] 실 libfanotify가 touch ~/velxor-work/src/foo 시 WS node_add{FileWrite} 1건 emit
- [ ] burst detection: FileWrite ≥50/1s 시 /classify 호출 + WS verdict 메시지 1건
- [ ] ws_broadcaster broadcast/VecDeque 분리 확인 (replay 별도 VecDeque 운영)
- [ ] /block/:pid endpoint 동작 확인
- [ ] VELXOR_STUB 3 모드(unset/collector/both) smoke 통과
- [ ] B의 IPC 시그니처 확정 ack 수신 (또는 48h 내 단독 진행)
- [ ] C의 /classify 연결 확인 ack 수신 (또는 VELXOR_STUB=engine 영속)
→ Week 6-7: C가 PoC + 모델 작업 (A는 대기). Week 8-9 진입 준비.
```

---

## Week 8-9 — 자동 차단 + tracing + 리허설

> ⏱️ **10h** | 🎯 AC6 자동 차단 + AC4 tracing JSON emit + 리허설 3회 collector 안정성 확인

### 5.1 [Day 1, 3h] 자동 차단 본구현 + `ac6-verify-block.sh` 🦀

- [ ] 🦀 `aggregator.rs`에서 burst detect → verdict ransomware 시 `VELXOR_AUTOBLOCK` env 설정되어 있으면 `block_handler(pid)` 자동 호출
- [ ] 🦀 `scripts/ac6-verify-block.sh` 작성:
  ```bash
  PID="${1:?usage: ac6-verify-block.sh <pid>}"
  ! kill -0 "$PID" 2>/dev/null && echo "AC6 PASS" && exit 0
  ! test -e "/proc/$PID" && echo "AC6 PASS (gone from /proc)" && exit 0
  echo "AC6 FAIL — pid=$PID still alive" && exit 1
  ```
- [ ] 🛠️ `chmod +x scripts/ac6-verify-block.sh && git update-index --chmod=+x scripts/ac6-verify-block.sh`
- [ ] 🧪 테스트 PID로 `ac6-verify-block.sh` PASS 확인
- [ ] 📜 `git add scripts/ac6-verify-block.sh rust-service/src/ && git commit -m "A: week8 auto-block (kill SIGTERM→SIGKILL) + ac6-verify-block.sh"` + push
- [ ] ⚠️ **Deferral #3**: 시간 부족 시 자동 차단 비활성 (`VELXOR_AUTOBLOCK` unset), B의 Block 버튼 수동 모드만 유지
- [ ] 🤝 **B에게 알림**: "자동 차단 구현 완료 — Block 버튼(B UI) + 자동 차단(A Rust) 양쪽 동작. deferral 시 Block 버튼만 유효" (양방향: B Block → A kill)

### 5.2 [Day 2, 3h] tracing instrumentation (AC4) 🦀

- [ ] 🦀 `main.rs`에 `tracing_subscriber::fmt().json().with_env_filter("info").init()` 확인
- [ ] 🦀 4개 지점에 timestamp emit:
  - collector event 수신 직후: `tracing::info!(event_received_ts = ts_ms_now(), seq, "evt_in")`
  - ws_broadcaster fan-out 직전: `tracing::info!(ws_sent_ts = ts_ms_now(), seq, "ws_out")`
  - classifier_client 호출 전: `classify_start_ts = ts_ms_now()`
  - classifier_client 응답 후: `classify_end_ts = ts_ms_now()`
- [ ] 🦀 `mkdir -p rust-service/logs` + `cargo run --release 2> logs/trace.json` 형태로 JSON 로그 파일 emit 확인
- [ ] 🤝 **C에게 전달**: "tracing JSON 경로 `rust-service/logs/trace.json`, 필드명 `event_received_ts`/`ws_sent_ts`/`classify_start_ts`/`classify_end_ts` — `eval-ac4.sh` 파싱 준비 요청" (단방향: A → C)
- [ ] ⚠️ **Deferral #5**: 시간 부족 시 4개 timestamp 중 `event_received_ts`/`ws_sent_ts` 2개만 유지. C의 classify p99는 C 자체 측정으로 대체.
- [ ] 📜 `git add rust-service/ && git commit -m "A: week8 tracing instrumentation (AC4 4 timestamps)"` + push

### 5.3 [Day 3-5, 3h] 리허설 3회 — A 측 책임 🎬

- [ ] 🎬 B 주관 리허설 3회 참여 (B가 진행 총괄, `REHEARSAL-LOG.md` 작성)
- [ ] 🧪 A 모니터링 항목:
  - `dropped_since_last` 증가율 관찰 (collector queue 압박 신호)
  - WS gap 메시지 빈도 확인 (reconnect 불안정 신호)
  - `rust-service/logs/trace.json` 누락 여부 확인
- [ ] ⚠️ **collector crash 1회 발생 시 즉시**:
  ```bash
  export VELXOR_STUB=collector
  # events.jsonl에 미리 준비된 시연용 burst 시퀀스 emit
  ```
  → B/C에 즉시 알림 (데모 시나리오 변경 고지)
- [ ] 🤝 **B에게**: 리허설 중 WS reconnect 끊김 관찰 시 즉시 공유 (A가 gap emit 확인, B가 exponential backoff + dev 핫리로드 disable 확인) (양방향)
- [ ] 🤝 **C에게**: 리허설 중 p99 측정 결과 `classify_start_ts`/`classify_end_ts` 파싱 정상 여부 확인 요청 (양방향)

### 5.4 [Day 5, 1h] AC8 stub smoke (A 담당 = collector + both) 🧪

- [ ] 🧪 `VELXOR_STUB=collector ./scripts/run-all.sh` + `ws-record.sh /tmp/ws-collector.jsonl` + `grep 'node_add'` → **AC8(collector) PASS**
- [ ] 🧪 `VELXOR_STUB=both ./scripts/run-all.sh` + `ws-record.sh /tmp/ws-both.jsonl` + `grep 'node_add'` → **AC8(both) PASS**
- [ ] 🤝 **C에게**: `VELXOR_STUB=engine` smoke는 C가 담당 — 결과 공유 요청 (수신)
- [ ] 🤝 **B에게**: "stub 3 모드 (collector/both 통과) — UI가 stub 모드 무관하게 동일 동작하는지 UI 측 ack 요청" (수신)
- [ ] 📜 AC8 결과 `REHEARSAL-LOG.md` 에 A 측 smoke 결과 기여

---

### 🚦 Week 8-9 완료 게이트

```
- [ ] AC6: ac6-verify-block.sh PASS (kill SIGTERM→SIGKILL + /proc/$PID 부재 확인)
- [ ] AC4: rust-service/logs/trace.json에 4개 timestamp 정상 emit 확인
- [ ] AC8(collector): ws-record.sh node_add PASS
- [ ] AC8(both): ws-record.sh node_add PASS
- [ ] 리허설 3회 collector crash 없음 (또는 VELXOR_STUB=collector 전환 완료)
- [ ] C에게 tracing JSON 필드명 전달 완료 (eval-ac4.sh 파싱 가능)
→ Week 10 슬라이드 작성 진입
```

---

## Week 10 — 슬라이드 발표

> ⏱️ **3h** | 🎯 슬라이드 Rust 섹션 완성 + 풀 리허설 참여

### 6.1 [1.5h] 슬라이드 Rust 섹션 작성 🎬

- [ ] 🎬 libfanotify userspace 다이어그램 작성: kernel hook intercept + userspace policy 라인
- [ ] 🎬 root 권한 모델 설명: `CAP_SYS_ADMIN` 필요성, `FAN_OPEN_PERM` 차단 메커니즘 (미구현 시 "future work: LSM/eBPF 강화" 명시)
- [ ] 🎬 broadcast/replay 분리 설명: WS reconnect 5초 보장 메커니즘
- [ ] 🎬 AC6 차단 시퀀스 다이어그램: `kill SIGTERM → 200ms → SIGKILL`

### 6.2 [1h] 슬라이드 보조 자료 🎬

- [ ] 🎬 v1.1 schema diff (additive 필드 목록)
- [ ] 🎬 AC4 tracing timestamp 4개 위치 다이어그램 (event→ws, classify start→end)
- [ ] 🎬 "원안 Windows WDK minifilter → Linux fanotify userspace" identity 약화 1줄 disclosure (AC5c와 연계)

### 6.3 [0.5h] 미완 future work + 풀 리허설 참여 🎬

- [ ] 🎬 미완 시 future work 슬라이드에 명시:
  - LSM/eBPF 강화 (`bpf_lsm_file_open`으로 kernel-side enforcement)
  - `FAN_OPEN_PERM` 기반 inline block
  - systemd unit + `Restart=on-failure` 자동화
- [ ] 🎬 B 주관 풀 리허설 1-2회 참여 (collector/service 안정성 최종 확인)
- [ ] 🤝 **B에게**: 슬라이드 Rust 섹션 최종본 공유 (B가 4계층 다이어그램 UI 섹션에서 인용 가능하도록) (단방향: A → B)
- [ ] 🤝 **C에게**: C의 `docs/ARCHITECTURE.md` 4계층 다이어그램 슬라이드 인용 확인 (수신: C → A)

---

### 🚦 Week 10 완료 게이트 (최종)

```
- [ ] 슬라이드 Rust 섹션 완성 (libfanotify + AC6 + broadcast/replay)
- [ ] AC5c disclaimer 연계 확인 (C 담당이지만 A의 "Linux/fanotify" 맥락 제공)
- [ ] 풀 리허설 참여 + 마지막 collector 안정성 확인
→ 발표 준비 완료
```

---

## 체크포인트 진행률

| Week | 산출물 태그 | 예산 | 실제 | 상태 |
|------|------------|------|------|------|
| Week 0 | `fanotify-smoke` + cargo scaffold | 9h | | ⬜ TODO |
| Week 1 | `walking-skeleton-v1` (C push) + v1-draft schema | 16h | | ⬜ TODO |
| Week 3 | `schema-v1.1` | 3h | | ⬜ TODO |
| Week 4-5 | libfanotify 본구현 + Rust service 완성 | 21h | | ⬜ TODO |
| Week 8-9 | 자동 차단 + tracing + AC8 collector/both | 10h | | ⬜ TODO |
| Week 10 | 슬라이드 Rust 섹션 | 3h | | ⬜ TODO |
| **합계** | | **~62h** | | |

> **Deferral 트리거**: 누적 hours > 71h (62h × 1.15) → 자동 차단(#3) → AC4 tracing 단순화(#5) 순으로 deferral.

---

## 트러블슈팅 빠른 참조

| 증상 | 원인 후보 | 즉시 조치 |
|------|-----------|-----------|
| `fanotify_init EPERM` | root 권한 부재 | `sudo` 또는 `setcap cap_sys_admin+ep` |
| `fanotify_mark ENODEV` | mount-point fanotify 미지원 | `FAN_MARK_FILESYSTEM` 대신 `FAN_MARK_MOUNT` |
| `events.jsonl` 100% CPU 루프 | `tokio::time::sleep` 누락 | 200ms sleep 명시 |
| broadcast lag / Receiver Lagged | channel 1024 초과 | `dropped_since_last++` + capacity 2048 검토 |
| WS reconnect 누락 메시지 | VecDeque에서 N+1 evict | `{type:"gap"}` emit → UI full refresh |
| `?last_seq=N` 무시 | URI 파싱 누락 | `req.uri()` query 파싱 확인 (url crate) |
| `classify p99 > 100ms` | C 측 모델 무거움 | A는 timeout 단축 안 함 — C에게 `fallback_rules` 영속 요청 |
| `kill EPERM` | rust-service non-root | `AmbientCapabilities=CAP_KILL` 또는 sudo |
| tracing JSON 빈 파일 | `RUST_LOG` 미설정 | `RUST_LOG=info cargo run` 또는 `with_env_filter` 디폴트 |

---

> **참조 파일**: 상세 Copy-Paste Runnable 코드 → [`worker-A-timeline.md`](./worker-A-timeline.md) | 기술 명세 → [`velxor-consensus-plan.md`](./velxor-consensus-plan.md) | 역할 분담 → [`role-assignment.md`](./role-assignment.md)
