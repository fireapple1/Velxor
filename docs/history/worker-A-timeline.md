# 작업자 A — 타임라인 (Copy-Paste Runnable, Ubuntu+fanotify, **Critical Path 오너**)

> **목적**: 이 문서 하나만 위에서 아래로 따라가면 작업자 A의 ~62h 분량(**모든 Rust** = libfanotify collector + Rust 통합 서비스 + Interface Contract Rust DRI + tracing instrumentation + 자동 차단)이 그대로 진행된다.
> **선행 문서**: [`role-assignment.md`](./role-assignment.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md), [`ENVIRONMENT.md`](./ENVIRONMENT.md)
> **브랜치**: `devA` (모든 PR은 `devA → main`)
> **OS 가정**: **Ubuntu 24.04 LTS** (bare-metal 또는 KVM/VirtualBox VM). 원안의 Windows WDK 미니필터는 **2026-05-21 마이그레이션**으로 폐기.
> **Toolchain**: Rust 1.78.0, root 권한 가능, fanotify 지원 커널 (6.8 = 24.04 기본 OK)
> **2026-05-22 재분배**: 종전 "A=collector + 저수준 Rust"에서 **"A=모든 Rust 단일 소유 (collector + service + integration + tracing) + Interface Contract Rust DRI"**로 확장. **A가 critical path 단일 점**이므로 본 문서는 체크리스트가 아닌 상세 마일스톤 형식으로 운영한다.

---

## ⚠️ A는 critical path 단일 점 — 의존성 다이어그램

```
Week 0  ─ fanotify smoke (필수 게이트) ─┐
                                       │
Week 1  ─ Interface Contract v1-draft ─┼─→ B/C가 자기 stub 작성 가능
        ─ 4 Rust stubs + ws-record.sh ─┘
                                       
Week 3  ─ v1.1 schema collation ────── ← B/C 노트 수집 (48h)
                                       
Week 4-5 ─ libfanotify 본구현 ────────┐
         ─ classifier_client/ws_broad ─┼─→ B의 UI/Block, C의 모델 통합
         ─ aggregator burst detection ─┘
                                       
Week 8-9 ─ 자동 차단(kill SIGTERM/KILL) + tracing JSON emit
                                       
Week 10  ─ 슬라이드 Rust 섹션
```

> A가 막히면 B(UI)는 stub WS로 진행 가능하지만 C(엔진)는 `/classify` 호출 측 부재로 통합 검증 불가. **A 지연 시 즉시 `VELXOR_STUB=both` 영속 → B/C 단독 진행 + A는 격리 진행**.

---

## 0. 시작 전 단 한 번만 확인 (5분)

```bash
mkdir -p ~/src && cd ~/src
git clone <REPO_URL> Velxor && cd Velxor
git checkout -b devA origin/main || git checkout devA

# apt baseline (sudo 권한 필요)
sudo apt update && sudo apt install -y \
  build-essential clang pkg-config libssl-dev \
  git curl jq rsync unzip p7zip-full

# Rust 1.78.0
command -v rustup || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default 1.78.0
rustc --version           # 1.78.0
cargo --version           # cargo 1.78.x

# Kernel & fanotify 가용성
uname -r                                          # 6.8.x 기대
grep CONFIG_FANOTIFY /boot/config-$(uname -r)     # =y 기대
cat /proc/sys/kernel/lockdown 2>/dev/null         # 'none' 또는 파일 없음 — confidentiality 모드면 BPF/특권 제한

# websocat (Week 1 ws-record.sh가 사용)
cargo install websocat
```

> ⚠️ root 권한 또는 `sudo` 가능 환경 필수. `CAP_SYS_ADMIN` 부재 시 fanotify_init 실패. AppArmor가 fanotify를 가로채는 경우 (`aa-status`로 확인) profile 임시 해제 필요.

---

## 1. Week 0 — 환경 + fanotify smoke + Rust 의존성 (목표: 9h)

### 1.1 [3h] fanotify smoke (Week 0 AC) — A의 첫 게이트

`smoke/fanotify_smoke.rs` (또는 C 샘플):
```rust
// 최소 fanotify userspace 캡처: ~/velxor-work/src 안의 touch foo → FAN_MODIFY 1개
use std::os::unix::io::AsRawFd;
use nix::sys::fanotify::{Fanotify, InitFlags, EventFFlags, MarkFlags, MaskFlags};

fn main() -> nix::Result<()> {
    let work = std::env::var("HOME").unwrap() + "/velxor-work/src";
    std::fs::create_dir_all(&work).unwrap();

    let fan = Fanotify::init(InitFlags::FAN_CLASS_NOTIF, EventFFlags::O_RDONLY)?;
    fan.mark(MarkFlags::FAN_MARK_ADD,
             MaskFlags::FAN_MODIFY | MaskFlags::FAN_CLOSE_WRITE,
             None, Some(&work))?;
    println!("fanotify watching {}", work);

    let mut buf = [0u8; 4096];
    let n = nix::unistd::read(fan.as_raw_fd(), &mut buf)?;
    println!("FAN_MODIFY captured ({} bytes)", n);
    Ok(())
}
```

```bash
mkdir -p smoke && cd smoke
cargo init --bin fanotify_smoke
cd fanotify_smoke
# Cargo.toml에 nix = { version = "0.28", features = ["fanotify"] } 추가
cargo build --release
sudo ./target/release/fanotify_smoke &
SMOKE_PID=$!
sleep 0.5
touch ~/velxor-work/src/foo
sleep 0.5
sudo kill $SMOKE_PID 2>/dev/null
# 기대 출력: "FAN_MODIFY captured (N bytes)"
cd ../..
```

> **Week 0 AC**: 위 출력이 나오면 통과. 실패 시 (root·CONFIG_FANOTIFY·AppArmor) **즉시** inotify 백업 가동 결정.

### 1.2 [1h] inotify 백업 spike

```bash
sudo apt install -y inotify-tools
inotifywait -m -r ~/velxor-work/src &
IW_PID=$!
touch ~/velxor-work/src/bar
sleep 0.5
sudo kill $IW_PID
# 기대: "MODIFY" 이벤트 라인 1개
```

> fanotify smoke가 통과해도 inotify 백업 경로는 슬라이드에서 "permission caveats" 대안으로 언급해야 함. 자료 준비.

### 1.3 [4h] Rust 통합 서비스 scaffold (Cargo + 의존성 확정)

```bash
cd ~/src/Velxor
cargo new rust-service --bin
cd rust-service
cat >> Cargo.toml <<'EOF'

[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.21"
futures-util = "0.3"
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
nix = { version = "0.28", features = ["signal", "process", "fanotify", "fs"] }
anyhow = "1"
thiserror = "1"
url = "2"
EOF
cargo build                      # 빈 main만 컴파일 통과 → 의존성 락
cd ..
```

### 1.4 [1h] Week 0 검증 게이트

- [ ] fanotify smoke 통과 (1.1)
- [ ] inotify 백업 1줄 캡처 (1.2)
- [ ] `cargo build` 통과 (1.3)
- [ ] `websocat --version` 동작

```bash
git add rust-service smoke
git commit -m "A: week0 fanotify smoke + cargo scaffold + dependency lock"
git push -u origin devA
```

> **Done when**: fanotify smoke 출력 + cargo build 통과 + devA push. **B/C가 Week 1 진입 가능 신호**.

---

## 2. Week 1 — Interface Contract + 4 Rust stubs + AC1 (목표: 16h, **최대 부하**)

### 2.1 [Day 1, 4h] Interface Contract v1-draft 발행

A 주관 발행, A=Rust DRI / C=Python DRI / B=UI consumer. `Velxor/contracts/interface-schema.md` 작성:

**(1) Collector→Service `BehaviorEventV1`** (UNIX socket / stdout pipe JSONL)
```text
{ schema_version: "1.0",
  seq: u64,                  // monotonic per session
  dropped_since_last: u32,
  pid: u32, parent_pid: u32,
  image_path: string,        // UTF-8, max 4096 bytes (Linux PATH_MAX)
  event_type: enum(FileWrite|FileRename|ProcessCreate),
  file_path: string?,        // UTF-8, max 4096 bytes
  volume_id: string?,        // ext4 dev-major-minor 또는 mount path
  op_detail: object?,        // FileWrite: {file_size: u64, entropy_hint: u32}
  ts_unix_ms: u64 }
```
- **Wire**: JSON UTF-8, 1줄=1메시지 JSONL, max 4 KiB/msg, truncate 시 `op_detail.path_truncated: true`
- **Transport**: UNIX socket `/run/velxor/events.sock` 또는 stdout pipe; `SO_SNDTIMEO=10ms` 비차단; 큐 1024; mutex 보유 / signal handler context **금지**
- **drop policy**: silent drop 금지, `dropped_since_last++` 누적 후 다음 successful send에 동봉

**(2) REST `POST /classify`** (C의 Waitress threads=4 호스팅 — C가 schema DRI)
```text
req:  { events: BehaviorEventV1[], window_ms: u32 }
resp: { verdict: enum(benign|ransomware), confidence: f32,
        evidence: string[], model_version: string }
```
- **SLA**: classifier p99 < 100ms sub-budget (AC4); C 측정·해석

**(3) WS message** (tokio-tungstenite, A=DRI)
```text
{ schema_version: "1.0", seq: u64,
  type: enum(node_add|node_update|verdict|alert|gap),
  payload: object }
```

**(4) Reconnect 프로토콜**
- client(B의 UI) 연결 시 `?last_seq=N` (최초=0)
- server(A): VecDeque 내 seq>N 즉시 push 후 live broadcast
- 5초 초과로 N+1 부재 시 → `{type:"gap", payload:{from:N+1, to:head_seq}}` → UI full refresh
- client dedupe: 동일 seq 중복 무시

**(5) Evolution policy**
- v1.x = additive only
- v2 = breaking, team sign-off
- escape hatch: wrong-typed v1.0 필드는 `*_v2` parallel field

**(6) `VELXOR_STUB` semantics**
| Value | Rust(A) | Python(C) | UI(B) |
|---|---|---|---|
| unset | 실 libfanotify | 학습 모델/fallback | 실 WS |
| collector | events.jsonl poll | 변경 없음 | 변경 없음 |
| engine | 변경 없음 | 하드코드 verdict | 변경 없음 |
| both | events.jsonl poll | 하드코드 verdict | 변경 없음 |

```bash
mkdir -p contracts
$EDITOR contracts/interface-schema.md     # 위 내용 작성
git add contracts/interface-schema.md
git commit -m "A: week1 interface-schema v1-draft (Rust DRI sections)"
git push
# B/C에게 PR 링크 + 'compiles-against-{ui,engine}' 한 줄 ack 요청 (mechanical only)
```

### 2.2 [Day 2, 4h] Rust 서비스 4 stub

`rust-service/src/main.rs`:
```rust
mod collector_source;
mod aggregator;
mod classifier_client;
mod ws_broadcaster;

use tokio::sync::broadcast;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().with_env_filter("info").init();

    let (tx, _rx) = broadcast::channel::<ws_broadcaster::WsMessage>(1024);
    let replay = ws_broadcaster::ReplayBuffer::new(std::time::Duration::from_secs(5));

    let ws  = tokio::spawn(ws_broadcaster::run(tx.clone(), replay.clone(), 7000));
    let src = tokio::spawn(collector_source::run(tx.clone(), replay.clone()));

    let _ = tokio::try_join!(ws, src);
    Ok(())
}
```

`rust-service/src/ws_broadcaster.rs` (broadcast/replay 분리 finalize는 Week 4-5; Week 1은 스켈레톤):
```rust
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Mutex};
use futures_util::{StreamExt, SinkExt};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct WsMessage {
    pub schema_version: String,
    pub seq: u64,
    pub r#type: String,
    pub payload: serde_json::Value,
}

#[derive(Clone)]
pub struct ReplayBuffer {
    inner: Arc<Mutex<VecDeque<(Instant, WsMessage)>>>,
    ttl: Duration,
}

impl ReplayBuffer {
    pub fn new(ttl: Duration) -> Self {
        Self { inner: Arc::new(Mutex::new(VecDeque::with_capacity(2048))), ttl }
    }
    pub async fn push(&self, m: WsMessage) {
        let now = Instant::now();
        let mut q = self.inner.lock().await;
        q.push_back((now, m));
        while let Some((t, _)) = q.front() {
            if now.duration_since(*t) > self.ttl { q.pop_front(); } else { break; }
        }
    }
    pub async fn since(&self, last_seq: u64) -> Vec<WsMessage> {
        self.inner.lock().await.iter()
            .filter(|(_, m)| m.seq > last_seq).map(|(_, m)| m.clone()).collect()
    }
    pub async fn head_seq(&self) -> u64 {
        self.inner.lock().await.back().map(|(_, m)| m.seq).unwrap_or(0)
    }
}

pub async fn run(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer, port: u16) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!(port, "ws server listening");
    loop {
        let (stream, _) = listener.accept().await?;
        let tx2 = tx.clone();
        let rep2 = replay.clone();
        tokio::spawn(async move {
            let ws = tokio_tungstenite::accept_hdr_async(stream, |req: &tokio_tungstenite::tungstenite::handshake::server::Request, resp| {
                // parse ?last_seq=N from URI query
                let uri = req.uri().to_string();
                let last_seq: u64 = url::Url::parse(&format!("ws://x{}", uri)).ok()
                    .and_then(|u| u.query_pairs().find(|(k, _)| k == "last_seq").map(|(_, v)| v.to_string()))
                    .and_then(|v| v.parse().ok()).unwrap_or(0);
                tracing::info!(last_seq, "ws client connecting");
                // stash last_seq in connection extension — 또는 단순화 위해 별도 wrap
                Ok(resp)
            }).await;
            // (실제 처리: replay.since(last_seq) → forward broadcast::Receiver. Week 4-5에서 finalize)
            let _ = ws;
            let _ = tx2;
            let _ = rep2;
        });
    }
}
```

`rust-service/src/collector_source.rs` (Week 1 = stub poll, Week 4-5 = libfanotify):
```rust
use std::path::Path;
use std::time::Duration;
use tokio::sync::broadcast;
use crate::ws_broadcaster::{ReplayBuffer, WsMessage};

pub async fn run(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer) -> anyhow::Result<()> {
    let mode = std::env::var("VELXOR_STUB").unwrap_or_default();
    if mode == "collector" || mode == "both" {
        return poll_events_jsonl(tx, replay).await;
    }
    // Week 4-5에서 fanotify 어댑터로 교체
    poll_events_jsonl(tx, replay).await
}

async fn poll_events_jsonl(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer) -> anyhow::Result<()> {
    let path = Path::new("events.jsonl");
    let mut offset: u64 = 0;
    let mut seq: u64 = 1;
    loop {
        if path.exists() {
            let content = tokio::fs::read_to_string(path).await.unwrap_or_default();
            let bytes = content.as_bytes();
            if (bytes.len() as u64) > offset {
                for line in content[offset as usize..].lines() {
                    if line.trim().is_empty() { continue; }
                    if let Ok(ev) = serde_json::from_str::<serde_json::Value>(line) {
                        let msg = WsMessage {
                            schema_version: "1.0".into(),
                            seq,
                            r#type: "node_add".into(),
                            payload: ev,
                        };
                        replay.push(msg.clone()).await;
                        let _ = tx.send(msg);
                        seq += 1;
                    }
                }
                offset = bytes.len() as u64;
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
```

`rust-service/src/classifier_client.rs`:
```rust
pub async fn classify(events: &[serde_json::Value], window_ms: u32) -> anyhow::Result<serde_json::Value> {
    let body = serde_json::json!({ "events": events, "window_ms": window_ms });
    let resp = reqwest::Client::new()
        .post("http://127.0.0.1:8765/classify")
        .json(&body).send().await?
        .json::<serde_json::Value>().await?;
    Ok(resp)
}
```

`rust-service/src/aggregator.rs` (Week 1 = 빈 스켈레톤, Week 4-5에 sliding window):
```rust
pub fn placeholder() {}
```

```bash
cd rust-service && cargo build && cd ..
git add rust-service/
git commit -m "A: week1 4 rust stubs (main + ws_broadcaster + collector_source + classifier_client + aggregator)"
git push
```

### 2.3 [Day 3, 3h] `scripts/ws-record.sh` (AC1 검증 보조)

`scripts/ws-record.sh`:
```bash
#!/usr/bin/env bash
# AC1: WS 캡처에 node_add{event_type:"FileWrite"} 존재 확인
set -euo pipefail
OUT="${1:-/tmp/ws-capture.jsonl}"
timeout 5 websocat -n1 'ws://127.0.0.1:7000?last_seq=0' | tee "$OUT" || true
grep -q '"node_add"' "$OUT" && grep -q '"FileWrite"' "$OUT" \
  && { echo "AC1 PASS (ws-record)"; exit 0; } || { echo "AC1 FAIL"; exit 1; }
```

```bash
chmod +x scripts/ws-record.sh
git update-index --chmod=+x scripts/ws-record.sh
git add scripts/ws-record.sh
git commit -m "A: week1 ws-record.sh (AC1 ws capture check)"
git push
```

### 2.4 [Day 4, 2h] B/C와 walking skeleton 통합 reherse

- C가 `scripts/run-all.sh`(자기 owner)를 작성하면 그 안에서 `cargo run --release` (rust-service) 가 호출됨
- `VELXOR_STUB=both` 환경에서 `events.jsonl`에 mock 이벤트 한 줄 추가 시 WS로 fan-out 되는지 확인

```bash
# C의 run-all.sh가 준비되면 (없으면 수동):
(cd rust-service && VELXOR_STUB=both cargo run --release) &
RUST_PID=$!
sleep 2

echo '{"schema_version":"1.0","seq":1,"dropped_since_last":0,"pid":1234,"parent_pid":1,"image_path":"/usr/local/bin/smoke","event_type":"FileWrite","file_path":"'"$HOME"'/velxor-work/src/a.docx","ts_unix_ms":'"$(date +%s%3N)"'}' >> events.jsonl

sleep 1
./scripts/ws-record.sh /tmp/ws.jsonl

kill $RUST_PID 2>/dev/null || true
```

### 2.5 [Day 5, 1h] mechanical ack 수합

- B의 "compiles-against-ui" ack (WS message decode 가능 여부)
- C의 "compiles-against-engine" ack (`/classify` req/resp 모양)
- 양측 ack 후 `walking-skeleton-v1` tag는 C(run-all.sh owner)가 push. A는 fetch만.

### 2.6 [Day 5, 2h] 안정화 & 커밋

```bash
cd rust-service && cargo clippy --all-targets -- -D warnings && cargo build --release && cd ..
git tag -l 'walking-skeleton-v1' || echo "(C가 push 대기 중)"
```

> **Done when**: contracts/interface-schema.md v1-draft 푸시, 4 Rust stub `cargo build` 통과, ws-record.sh AC1 PASS, B/C ack 수합.

---

## 3. Week 3 — v1.1 Schema collation (목표: 3h, **A가 주관**)

> A 주관 async 48h review. B/C에 부족·잘못된 필드 노트 1개씩 요청. **무응답 시 A 단독 발행 (Principle 4)**.

### 3.1 [Day 1, 0.5h] B/C에 review trigger 송부
```text
[Subject] Velxor schema v1.1 review — 48h deadline
v1-draft: contracts/interface-schema.md @ <commit-sha>
요청: 본 schema에서 missing/wrong field 1개 (필드명 + 이유 + additive 제안)
Deadline: <timestamp + 48h>
무응답 시 그대로 발행 (next review로 이월).
```

### 3.2 [48h 후, 2h] 노트 통합 + additive-only v1.1 발행
- B의 UI 측 노트: 예) `WsMessage.payload.confidence` 필드 누락
- C의 Python 측 노트: 예) `BehaviorEventV1.op_detail`에 `entropy_hint` 정의 부재
- A의 Rust 측 자체 노트: 예) `dropped_since_last` overflow 정책 명시 부재
- 모두 **additive only** (새 optional field 추가)로 작성. 기존 필드 type 변경은 `*_v2` parallel field로 escape.

```bash
$EDITOR contracts/interface-schema.md      # v1.0 → v1.1 섹션 추가, 변경점만 diff
git tag schema-v1.1
git add contracts/interface-schema.md && git commit -m "A: week3 schema v1.1 (additive: <field list>)"
git push --tags && git push
```

### 3.3 [0.5h] B/C에 v1.1 발행 알림
- B는 ws/client.ts에 신규 필드 decode 추가
- C는 `/classify` resp에 신규 필드 emit

> **Done when**: schema-v1.1 tag push + B/C에 알림 발신. 무응답이어도 발행 강행.

---

## 4. Week 4-5 — libfanotify 본구현 + Rust service 완성 (목표: 21h, **두 번째 최대 부하 & A critical path 정점**)

### 4.1 [Day 1-3, 9h] libfanotify 어댑터 본구현

`rust-service/src/collector_source.rs`의 `poll_events_jsonl` 대안 path:
```rust
use nix::sys::fanotify::{Fanotify, InitFlags, EventFFlags, MarkFlags, MaskFlags};

pub async fn run_fanotify(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer) -> anyhow::Result<()> {
    let fan = Fanotify::init(InitFlags::FAN_CLASS_NOTIF, EventFFlags::O_RDONLY)?;
    // 워크 디렉토리는 ext4 로컬 — /tmp(tmpfs) 회피
    let work = std::env::var("VELXOR_WORK").unwrap_or_else(|_| format!("{}/velxor-work", std::env::var("HOME").unwrap()));
    std::fs::create_dir_all(&work)?;
    fan.mark(MarkFlags::FAN_MARK_ADD | MarkFlags::FAN_MARK_MOUNT,
             MaskFlags::FAN_MODIFY | MaskFlags::FAN_CLOSE_WRITE | MaskFlags::FAN_OPEN_EXEC,
             None, Some(&work))?;

    let mut seq: u64 = 1;
    let mut dropped: u32 = 0;

    loop {
        // blocking read in spawn_blocking로 (tokio runtime을 막지 않도록)
        let fan_fd = fan.as_raw_fd();
        let events = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            let n = nix::unistd::read(fan_fd, &mut buf)?;
            // parse fanotify_event_metadata, /proc/<pid>/exe readlink로 image_path 보강
            // ... (실제 구현: nix::sys::fanotify의 read API 사용)
            Ok::<_, nix::Error>(parse_events(&buf[..n]))
        }).await??;

        for ev in events {
            let msg = WsMessage {
                schema_version: "1.0".into(),
                seq,
                r#type: "node_add".into(),
                payload: serde_json::to_value(&ev)?,
            };
            replay.push(msg.clone()).await;
            // backpressure: try_send + drop counter
            match tx.send(msg) {
                Ok(_) => {}
                Err(_) => dropped += 1,
            }
            seq += 1;
        }

        if dropped > 0 {
            tracing::warn!(dropped_since_last = dropped, "broadcast lag — events dropped");
            // 다음 메시지에 dropped_since_last 동봉 (silent drop 금지)
        }
    }
}
```

**핵심 책임**:
- [ ] `fanotify_init` + `fanotify_mark` (FAN_MODIFY, FAN_CLOSE_WRITE, FAN_OPEN_EXEC, kernel 6.8의 FAN_RENAME)
- [ ] `/proc/<pid>/exe` readlink → `image_path` (PID race: fanotify FD 닫기 전 stat)
- [ ] `/proc/<pid>/status` → `parent_pid` (PPid: 라인 파싱)
- [ ] UNIX socket 또는 stdout pipe 송신 (`SO_SNDTIMEO=10ms`, mutex/signal handler context **금지**)
- [ ] 큐 깊이 1024, drop 시 `dropped_since_last++`, silent drop 금지

### 4.2 [Day 4, 3h] `aggregator.rs` — PID별 sliding window + burst detection

```rust
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct PidWindow {
    pub file_writes: Vec<Instant>,
    pub file_renames: Vec<Instant>,
}

impl PidWindow {
    pub fn add(&mut self, event_type: &str, now: Instant) {
        match event_type {
            "FileWrite" => self.file_writes.push(now),
            "FileRename" => self.file_renames.push(now),
            _ => {}
        }
        self.prune(now);
    }
    fn prune(&mut self, now: Instant) {
        let cutoff = now - Duration::from_secs(5);
        self.file_writes.retain(|t| *t >= cutoff);
        self.file_renames.retain(|t| *t >= cutoff);
    }
    pub fn burst_1s(&self, now: Instant) -> bool {
        let c1 = now - Duration::from_secs(1);
        let w = self.file_writes.iter().filter(|t| **t >= c1).count();
        let r = self.file_renames.iter().filter(|t| **t >= c1).count();
        w >= 50 || r >= 30
    }
}

pub type Aggregator = HashMap<u32, PidWindow>;
```

burst 감지 시 `classifier_client::classify(...)` 호출 → verdict → WsMessage("verdict") fan-out.

### 4.3 [Day 5, 3h] `classifier_client.rs` 완성 (verdict cache per PID, TTL 1s)

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct VerdictCache {
    inner: Mutex<HashMap<u32, (Instant, serde_json::Value)>>,
}
impl VerdictCache {
    pub fn new() -> Self { Self { inner: Mutex::new(HashMap::new()) } }
    pub fn get(&self, pid: u32) -> Option<serde_json::Value> {
        let g = self.inner.lock().ok()?;
        let (t, v) = g.get(&pid)?.clone();
        if t.elapsed() < Duration::from_secs(1) { Some(v) } else { None }
    }
    pub fn put(&self, pid: u32, v: serde_json::Value) {
        if let Ok(mut g) = self.inner.lock() {
            g.insert(pid, (Instant::now(), v));
        }
    }
}

pub async fn classify_with_cache(
    cache: &VerdictCache, pid: u32,
    events: &[serde_json::Value], window_ms: u32
) -> anyhow::Result<serde_json::Value> {
    if let Some(v) = cache.get(pid) { return Ok(v); }
    let v = super::classify(events, window_ms).await?;
    cache.put(pid, v.clone());
    Ok(v)
}
```

### 4.4 [Day 6, 3h] `ws_broadcaster.rs` 완성 — broadcast/replay 분리 finalize

핵심:
- broadcast::channel(1024) = **live fan-out 전용**
- ReplayBuffer = **별도 VecDeque, lock-protected**, 5초 sliding window
- accept 시 query parse → `replay.since(last_seq)` push → broadcast::Receiver forward
- 5초 초과로 N+1이 evict됨이 감지되면 `{type:"gap", from, to}` emit → UI full refresh 트리거

> **footgun**: replay를 broadcast 채널에 그대로 넣으면 신규 client 수신 측이 모든 메시지를 다시 받게 됨 (live 메시지와 충돌). 반드시 **분리된 큐**로 운영.

### 4.5 [Day 7, 3h] 자동 차단 시퀀스 (Week 8-9에 본구현하지만 hook은 여기서 준비)

`rust-service/src/main.rs`에 HTTP endpoint `/block/:pid` 추가:
```rust
// (warp 또는 axum 가벼운 server. tokio-tungstenite와 같은 tokio 기반)
async fn block_handler(pid: u32) -> Result<&'static str, &'static str> {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    let p = Pid::from_raw(pid as i32);
    match kill(p, Signal::SIGTERM) {
        Ok(_) => {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            // 살아있으면 SIGKILL
            match kill(p, None) {
                Ok(_) => { let _ = kill(p, Signal::SIGKILL); Ok("killed") }
                Err(_) => Ok("terminated"),
            }
        }
        Err(nix::Error::EPERM) => { tracing::warn!(pid, "EPERM"); Err("EPERM") }
        Err(nix::Error::ESRCH) => Ok("already gone"),
        Err(_) => Err("kill failed"),
    }
}
```

### 4.6 [통합 포인트] B/C와 결선

- B의 UI Block 버튼 → IPC → A의 `/block/:pid` HTTP endpoint → kill 시퀀스
- C의 `/classify`가 실 모델로 응답 → A의 `classifier_client`가 그대로 호출
- C의 `run-all.sh`가 A의 `cargo run --release`를 호출 (cd rust-service 안에서)

### 4.7 [통합 검증] `VELXOR_STUB=` 3 모드 sweep

```bash
# unset (전부 실)
(cd rust-service && cargo run --release) &
# ...

# collector (events.jsonl poll)
(cd rust-service && VELXOR_STUB=collector cargo run --release) &
# ...

# both (collector + engine 모두 stub)
(cd rust-service && VELXOR_STUB=both cargo run --release) &
# ...
```

> **Done when**: 실 libfanotify가 `touch ~/velxor-work/src/foo` 시 WS로 `node_add{event_type:"FileWrite"}` 1건 보냄, burst 50+ 시 verdict 한 번 호출 + WS verdict 메시지 한 건.

---

## 5. Week 8-9 — 자동 차단 + tracing + 리허설 (목표: 10h)

### 5.1 [Day 1, 3h] 자동 차단 본구현 + `scripts/ac6-verify-block.sh`

A 책임. Week 4-5의 `/block/:pid` endpoint를 burst detection 트리거에 연결:
```rust
// aggregator burst detect → verdict ransomware 시
if std::env::var("VELXOR_AUTOBLOCK").is_ok() {
    let _ = block_handler(pid).await;
}
```

`scripts/ac6-verify-block.sh`:
```bash
#!/usr/bin/env bash
# AC6: 차단 후 PID 부재 확인
set -euo pipefail
PID="${1:?usage: ac6-verify-block.sh <pid>}"

if ! kill -0 "$PID" 2>/dev/null; then
    echo "AC6 PASS — pid=$PID blocked"
    exit 0
fi
if ! test -e "/proc/$PID"; then
    echo "AC6 PASS — pid=$PID gone from /proc"
    exit 0
fi
echo "AC6 FAIL — pid=$PID still alive"
exit 1
```

```bash
chmod +x scripts/ac6-verify-block.sh
git update-index --chmod=+x scripts/ac6-verify-block.sh
git add scripts/ac6-verify-block.sh rust-service/src/
git commit -m "A: week8 auto-block (kill SIGTERM→SIGKILL) + ac6-verify-block.sh"
git push
```

> *Deferral #3 후보*: 시간 부족 시 자동 차단 disable, B의 Block 버튼만 유지.

### 5.2 [Day 2, 3h] tracing instrumentation (AC4 측정)

A의 Rust 코드 4개 지점에 timestamp emit:
```rust
fn ts_ms_now() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

// 1. collector에서 event 수신 직후
tracing::info!(event_received_ts = ts_ms_now(), seq = ev.seq, "evt_in");

// 2. ws_broadcaster fan-out 직전
tracing::info!(ws_sent_ts = ts_ms_now(), seq = msg.seq, "ws_out");

// 3-4. classifier_client 호출 전후
let cs = ts_ms_now();
let resp = classify(events, window_ms).await?;
let ce = ts_ms_now();
tracing::info!(classify_start_ts = cs, classify_end_ts = ce, pid, "classify_done");
```

`rust-service`를 다음과 같이 띄우면 JSON 라인이 stdout (또는 파일)로 흘러나옴:
```bash
mkdir -p rust-service/logs
(cd rust-service && cargo run --release 2> logs/trace.json) &
```

C가 `scripts/eval-ac4.sh`로 이 JSON 파싱 → event→ws p99 + classify p99 산출.

### 5.3 [Day 3-5, 3h] 리허설 3회 — A 측 책임

B 주관, A는 다음을 모니터링:
- collector 안정성 (`dropped_since_last` 증가율)
- WS reconnect 성공률 (gap 메시지 빈도)
- tracing JSON 누락 여부

**collector crash 1회 발생 시 즉시**:
```bash
# 데모 시나리오 변경
export VELXOR_STUB=collector       # events.jsonl poll로 영속
# events.jsonl에 미리 준비된 시연용 burst 시퀀스 emit
```

> 원안 Windows BSOD 대비 userspace이므로 시스템 전체 다운은 없음. 회복 시간 < 60s.

### 5.4 [Day 5, 1h] AC8 stub smoke (A 담당 = collector + both)

```bash
# A: VELXOR_STUB=collector 단독
VELXOR_STUB=collector ./scripts/run-all.sh    # C의 스크립트
./scripts/ws-record.sh /tmp/ws-collector.jsonl
grep -q 'node_add' /tmp/ws-collector.jsonl && echo "AC8(collector) PASS"

# A: VELXOR_STUB=both 단독
VELXOR_STUB=both ./scripts/run-all.sh
./scripts/ws-record.sh /tmp/ws-both.jsonl
grep -q 'node_add' /tmp/ws-both.jsonl && echo "AC8(both) PASS"
```

---

## 6. Week 10 — 발표 (목표: 3h)

### 6.1 슬라이드 Rust 섹션 (collector + service)
- libfanotify userspace 다이어그램 (kernel hook intercept + userspace policy 라인)
- root 권한 모델, `CAP_SYS_ADMIN`, FAN_OPEN_PERM 차단 메커니즘 (미구현 시 future work)
- broadcast/replay 분리 = WS reconnect의 5초 보장
- AC6 차단 시퀀스 (`kill SIGTERM` → 200ms → `SIGKILL`)

### 6.2 슬라이드 보조 자료
- v1.1 schema diff (additive 필드 목록)
- AC4 tracing timestamp 4개 위치 다이어그램
- "원안 Windows WDK minifilter → Linux fanotify" identity 약화 1줄 disclosure

### 6.3 미완 시 future work 라인
- LSM/eBPF 강화 (bpf_lsm_file_open으로 kernel-side enforcement)
- FAN_OPEN_PERM 기반 inline block
- systemd unit + `Restart=on-failure` 자동화

---

## 7. 결정적 책임 7개 (절대 잊지 말 것)

| # | 책임 | 위반 시 결과 |
|---|------|-------------|
| 1 | Week 0 AC(fanotify smoke) 실패 시 **즉시** inotify 백업 가동 결정 | Week 4-5 통째 손실 |
| 2 | Interface Contract v1-draft를 **Week 1 안에 발행** (Rust DRI 섹션 + C/B에 ack 요청) | B/C 모두 진행 차단 |
| 3 | `BehaviorEventV1` 송신: mutex 보유 / signal handler context **금지** → enqueue 후 worker dispatch | collector hang, 이벤트 손실 |
| 4 | `dropped_since_last` silent drop 금지 — 항상 다음 successful send에 동봉 | 데이터 손실 원인 추적 불가 |
| 5 | WS broadcast(live)와 VecDeque(replay) **분리** — 같은 채널에 넣으면 lock contention + 신규 client 메시지 중복 | reconnect 5초 replay 동작 안 함 |
| 6 | Week 3 v1.1 review 48h 데드라인 — 무응답 시 **단독 발행 결단** | 일정 지연 |
| 7 | collector crash 1회 시 **즉시** `VELXOR_STUB=collector` 전환 (망설이지 말 것) | 데모 사망 |

---

## 8. 리스크 & 즉시 대응

| Risk | Trigger | 대응 |
|------|---------|------|
| fanotify 권한·커널 옵션 실패 | Week 0 AC 미달성 | inotify 백업 가동, 슬라이드 "permission caveats" |
| Collector 본구현 지연 | Week 4 종료 시 fanotify 어댑터 미완 | `VELXOR_STUB=collector` 영속, B/C 진행 차단 X |
| Collector crash / queue overflow | 리허설 중 sigsegv 또는 `dropped_since_last` 폭증 | systemd `Restart=on-failure` + `VELXOR_STUB=collector` 데모 모드 |
| Interface Contract drift | B/C가 v1.1 review에 부족한 노트 제출 | A 단독 발행 후 v1.2/v1.3 round 추가 (additive only) |
| WS reconnect 5초 replay 실패 | broadcast/replay 분리 미완 | gap 메시지 강제 emit으로 UI full refresh fallback |
| kill 실패 (EPERM/ESRCH) | 차단 시도 시 | fallback 로그 + B의 Block 버튼 수동 |
| tracing JSON 미생성 | Week 8-9 측정 단계에서 | `tracing-subscriber::fmt().json().init()` 호출 확인, `RUST_LOG=info` env |
| **A 단독 critical path 병목** | Week 4 종료 시 Rust 본구현 미완 | C의 `run-all.sh`가 stub 3 모드 sweep으로 통합 검증 흡수; B/C는 각자 영역 stub 영속 |

---

## 9. 생성/소유 파일

```
Velxor/
├── contracts/
│   └── interface-schema.md                  # A 주관 발행 + A=Rust DRI 섹션
├── rust-service/                            # ⬅ 전부 A
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── collector_source.rs              # libfanotify ↔ events.jsonl 어댑터
│       ├── aggregator.rs                    # sliding window + burst detection
│       ├── classifier_client.rs             # REST + verdict cache
│       └── ws_broadcaster.rs                # broadcast + VecDeque 분리
├── smoke/fanotify_smoke/                    # Week 0 산출물
└── scripts/
    ├── ws-record.sh                         # A
    └── ac6-verify-block.sh                  # A
```

---

## 10. 시간 예산 vs 실제 추적

| Week | 예산(h) | 실제(h) | 누적(h) | 산출물 태그 |
|------|---------|---------|---------|------------|
| 0    | 9       |         |         | fanotify smoke + cargo scaffold |
| 1    | 16      |         |         | `walking-skeleton-v1` (C push) + v1-draft schema |
| 3    | 3       |         |         | `schema-v1.1` |
| 4-5  | 21      |         |         | libfanotify 본구현 + Rust service 완성 |
| 8-9  | 10      |         |         | 자동 차단 + tracing + AC8 collector/both |
| 10   | 3       |         |         | 슬라이드 Rust 섹션 |
| **합계** | **~62** | | | |

> 누적 hours > 1.15 × 62 = 71h 도달 시 deferral 발동: 자동 차단(#3) → AC4 tracing 단순화(#5) → broadcast/replay 단일 채널 회귀 (마지막 수단).

---

## 11. 트러블슈팅 빠른 참조

| 증상 | 원인 후보 | 즉시 조치 |
|------|-----------|-----------|
| fanotify_init EPERM | root 권한 부재 | `sudo` 실행 또는 `setcap cap_sys_admin+ep` |
| fanotify_mark ENODEV | mount-point가 fanotify mark 지원 안 함 | `FAN_MARK_FILESYSTEM` 대신 `FAN_MARK_MOUNT` |
| events.jsonl poll 무한 루프 with 100% CPU | `tokio::time::sleep` 누락 | 200ms sleep 명시 |
| broadcast lag — Receiver Lagged | broadcast channel 1024 초과 | `dropped_since_last++` 카운트, capacity 2048로 증가 검토 |
| WS reconnect 시 누락 메시지 | replay VecDeque에 N+1이 evict됨 | `{type:"gap"}` 송신 → UI full refresh |
| `?last_seq=N` 무시됨 | accept_hdr_async에서 URI 파싱 누락 | `req.uri()` query 파싱 명시 (url crate) |
| classify p99 100ms 초과 | C 측 모델 무거움 | A는 timeout 단축 안 함 (C가 fallback_rules 영속으로 해결) |
| kill EPERM | rust-service가 non-root | systemd unit `AmbientCapabilities=CAP_KILL` 또는 sudo |
| tracing JSON 빈 파일 | `RUST_LOG` env 미설정 | `RUST_LOG=info cargo run` 또는 `with_env_filter` 디폴트 |

---

## 12. 의존성 격리 — A critical path 단일 점 risk mitigation

- A 지연 → C의 `run-all.sh`가 `VELXOR_STUB=both` 모드로 항상 동작해야 함 (events.jsonl poll + 하드코드 verdict + B의 UI가 WS 연결 가능)
- A의 v1.1 schema 발행 지연 → B/C는 v1-draft 그대로 계속 진행 (v1.x additive only 원칙)
- A의 자동 차단 미완 → Deferral #3 발동, B의 Block 버튼 수동 모드만 유지
- A의 tracing 미완 → Deferral #5, C가 측정 가능한 최소 timestamp 2개(event→ws)만 사용

> A는 critical path지만 **B/C가 자기 영역에서 stub 영속만 유지하면 시연 자체는 항상 가능**. 그게 walking skeleton + interface evolution gate의 핵심.

---

## 끝 — 이 문서대로 위에서 아래로만 진행하면 ~62h 안에 작업자 A의 모든 책임이 완료된다. **A는 critical path임을 인지하고 Week 0~1의 25h 부하를 학기 시작 ≥1주 전에 흡수할 것.**
