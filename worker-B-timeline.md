# 작업자 B — 타임라인 최적화 실행 플랜 (Copy-Paste Runnable, Ubuntu+fanotify)

> **목적**: 이 문서 하나만 위에서 아래로 따라가면 작업자 B의 ~45h 분량(Interface Contract + Rust 통합 서비스 + React+Electron UI + 리허설/발표 총괄)이 그대로 진행된다.
> **선행 문서**: [`role-assignment.md`](./role-assignment.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md), [`ENVIRONMENT.md`](./ENVIRONMENT.md)
> **브랜치**: `devB` (모든 PR은 `devB → main`)
> **OS 가정**: **Ubuntu 24.04 LTS** (bare-metal 또는 KVM/VirtualBox VM). 원안의 Windows VM + Git Bash/WSL2는 **2026-05-21 마이그레이션**으로 폐기.
> **Toolchain**: Rust 1.78.0, Node 20 LTS (`nvm install 20` 권장 — apt는 22 들어옴), npm 10.x, Python 3.12.x (24.04 기본)

---

## 0. 시작 전 단 한 번만 확인 (5분)

```bash
# 0-A. 저장소 클론 + devB 브랜치 진입
mkdir -p ~/src && cd ~/src
git clone <REPO_URL> Velxor && cd Velxor
git checkout -b devB origin/main || git checkout devB

# 0-B. apt baseline (sudo 권한 필요)
sudo apt update && sudo apt install -y \
  build-essential clang pkg-config libssl-dev \
  git curl jq rsync unzip p7zip-full \
  python3 python3-venv python3-dev

# 0-C. Rust 1.78.0
command -v rustup || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default 1.78.0
rustc --version           # 1.78.0
cargo --version           # cargo 1.78.x

# 0-D. Node 20 LTS via nvm (apt 22 회피)
command -v nvm || { curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash; \
                    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; }
nvm install 20 && nvm use 20
node --version            # v20.x
npm --version             # 10.x

# 0-E. 기타
git --version             # 2.43+
/usr/bin/bash --version   # 5.2.x (24.04 native)
```

> ⚠️ B는 system integrator 역할. **Interface Contract 발행 + Walking Skeleton 스크립트 + UI 풀스택**까지 한 사람이 한다는 것을 인지하고 Week 0-1 부하(~15h)에 대비.

---

## 1. Week 0 — 환경 셋업 (목표: 3h)

### 1.1 Rust 서비스 골격
```bash
cargo new velxor-rust-service --bin
cd velxor-rust-service
# Cargo.toml 의존성
cat >> Cargo.toml <<'EOF'

[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.21"
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json"] }
nix = { version = "0.28", features = ["signal", "process"] }   # kill(SIGTERM/SIGKILL) for block
anyhow = "1"
EOF
cargo build                # 컴파일만 통과하면 OK
cd ..
```

### 1.2 UI 골격
```bash
npm create vite@latest velxor-ui -- --template react-ts
cd velxor-ui
npm install
npm install electron @xyflow/react
npm install -D concurrently wait-on
npm run dev                # http://localhost:5173 200 확인 후 Ctrl-C
cd ..
```

### 1.3 Week 0 검증 게이트
- [ ] `cargo build` 통과 (rust-service)
- [ ] `npm run dev` 200 (ui)
- [ ] **A의 Week 0 AC(fanotify smoke) 통과 + B의 `cargo build` 캐시 + C의 `/health` 200 = Week 1 진입 자격**

```bash
git add velxor-rust-service velxor-ui
git commit -m "B: week0 cargo new + vite+electron+react-flow scaffold (ubuntu 24.04)"
git push -u origin devB
```

---

## 2. Week 1 — Walking Skeleton + Interface Contract v1-draft (목표: 12h, **최대 부하**)

> **이 주가 B의 전체 일정에서 가장 큰 블록**. v1-draft + 4 stubs + run-all.sh 까지 한 주에 모두 완료해야 AC1 통과.

### 2.1 [Day 1, 3h] Interface Contract v1-draft 발행
`Velxor/contracts/interface-schema.md` 작성. 필수 섹션:

**(1) Collector→Service 메시지 `BehaviorEventV1`** (UNIX socket / stdout pipe JSONL)
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
- **Wire encoding**: JSON UTF-8 payload, **1 line = 1 message (JSONL)**, max 4 KiB/msg, path truncate 시 `op_detail.path_truncated: true`
- **전송**: UNIX domain socket `/run/velxor/events.sock` 또는 stdout pipe (collector를 child process로 spawn). 큐 깊이 1024
- **Collector 송신 정책**: socket write `SO_SNDTIMEO = 10ms` 비차단, mutex 보유 / signal handler context 금지 → worker task dispatch, drop 시 `dropped_since_last++` (silent drop 금지)

**(2) REST `POST /classify`** (Flask + Waitress threads=4, cross-platform WSGI)
```text
req:  { events: BehaviorEventV1[], window_ms: u32 }
resp: { verdict: enum(benign|ransomware), confidence: f32,
        evidence: string[], model_version: string }
```
- **SLA**: classifier p99 < 100ms sub-budget (AC4)

**(3) WS message** (server: tokio-tungstenite)
```text
{ schema_version: "1.0", seq: u64,
  type: enum(node_add|node_update|verdict|alert|gap),
  payload: object }
```

**(4) Reconnect 프로토콜**
- client 연결 시 `?last_seq=N` query param (최초 = 0)
- server: VecDeque 내 seq > N 즉시 push 후 live broadcast로 전환
- 5초 초과로 N+1 부재 시 → `{type:"gap", payload:{from:N+1, to:head_seq}}` 송신 → UI full refresh
- client dedupe: 동일 seq 중복 무시

**(5) Evolution policy**
- v1.x = additive only (새 optional field만)
- v2 = breaking, team sign-off
- **Escape hatch**: wrong-typed v1.0 필드는 `*_v2` parallel field 추가 + 슬라이드에서만 deprecated 표기

**(6) `VELXOR_STUB` semantics 표**
| Value | Rust | Python |
|---|---|---|
| unset | 실 libfanotify collector 어댑터 | 학습 모델 또는 fallback |
| collector | events.jsonl poll | 변경 없음 |
| engine | 변경 없음 | 하드코드 verdict |
| both | events.jsonl poll | 하드코드 verdict |

> *(Migration)* 원안 `VELXOR_STUB=driver`는 `collector`로 rename. 의미·동작 동일.

### 2.2 [Day 2, 3h] Rust 서비스 stub
`velxor-rust-service/src/main.rs`:
```rust
mod collector_source;  // A가 채움
mod aggregator;        // A가 채움
mod classifier_client; // B
mod ws_broadcaster;    // B

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    let (tx, _rx) = tokio::sync::broadcast::channel::<ws_broadcaster::WsMessage>(1024);
    let replay = ws_broadcaster::ReplayBuffer::new(std::time::Duration::from_secs(5));

    let ws_handle  = tokio::spawn(ws_broadcaster::run(tx.clone(), replay.clone(), 7000));
    let src_handle = tokio::spawn(collector_source::run(tx.clone(), replay));

    let _ = tokio::try_join!(ws_handle, src_handle);
    Ok(())
}
```

`ws_broadcaster.rs` 핵심:
```rust
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct WsMessage { pub schema_version: String, pub seq: u64, pub r#type: String, pub payload: serde_json::Value }

#[derive(Clone)]
pub struct ReplayBuffer { inner: Arc<Mutex<VecDeque<WsMessage>>>, ttl: std::time::Duration }

impl ReplayBuffer {
    pub fn new(ttl: std::time::Duration) -> Self {
        Self { inner: Arc::new(Mutex::new(VecDeque::new())), ttl }
    }
    pub async fn push(&self, m: WsMessage) { /* push + evict oldest > ttl */ }
    pub async fn since(&self, last_seq: u64) -> Vec<WsMessage> { /* filter */ vec![] }
}

pub async fn run(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer, port: u16) -> anyhow::Result<()> {
    // tokio-tungstenite accept loop
    // on connect: parse ?last_seq=N → push replay.since(N) → forward broadcast::Receiver
    Ok(())
}
```

`classifier_client.rs`:
```rust
pub async fn classify(events: &[serde_json::Value], window_ms: u32) -> anyhow::Result<serde_json::Value> {
    let body = serde_json::json!({ "events": events, "window_ms": window_ms });
    let resp = reqwest::Client::new()
        .post("http://127.0.0.1:8765/classify")
        .json(&body).send().await?.json::<serde_json::Value>().await?;
    Ok(resp)
}
```

### 2.3 [Day 3, 3h] UI stub (Electron + Vite + React Flow + WS client)
`velxor-ui/src/App.tsx`:
```tsx
import { ReactFlow, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";

export default function App() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);

  useEffect(() => {
    let lastSeq = 0; let backoff = 250;
    const connect = () => {
      const ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.seq <= lastSeq) return;          // dedupe
        lastSeq = m.seq;
        if (m.type === "node_add")     setNodes((ns) => [...ns, m.payload]);
        if (m.type === "node_update")  setNodes((ns) => ns.map(n => n.id===m.payload.id ? {...n, ...m.payload} : n));
        if (m.type === "gap")          { setNodes([]); setEdges([]); lastSeq = 0; }
        backoff = 250;
      };
      ws.onclose = () => { setTimeout(connect, backoff); backoff = Math.min(backoff*2, 5000); };
    };
    connect();
  }, []);

  return <div style={{height:"100vh"}}><ReactFlow nodes={nodes} edges={edges}><Background/></ReactFlow></div>;
}
```

`velxor-ui/electron/main.ts` (Electron shell, hot-reload **disable** in dev — `docs/electron-ws-footgun.md` 사유):
```ts
import { app, BrowserWindow } from "electron";
app.whenReady().then(() => {
  const win = new BrowserWindow({ width:1280, height:800, webPreferences:{ contextIsolation:true }});
  win.loadURL("http://127.0.0.1:5173");
});
```

### 2.4 [Day 4, 2h] `scripts/run-all.sh` + `scripts/ws-record.sh`
`scripts/run-all.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

# 작업 디렉토리는 ext4 로컬에 두고 /tmp(tmpfs)는 피한다
WORK="${VELXOR_WORK:-$HOME/velxor-work}"
mkdir -p "$WORK"

# Start engine (C 영역)
(cd python-engine && source .venv/bin/activate && VELXOR_STUB=engine python waitress_conf.py) &
ENGINE_PID=$!
trap 'kill $ENGINE_PID $RUST_PID $UI_PID 2>/dev/null || true' EXIT

# Start rust service (B). VELXOR_STUB=both = A/C 둘 다 stub 모드
(cd velxor-rust-service && VELXOR_STUB=both cargo run --release) &
RUST_PID=$!

# Start UI (B)
(cd velxor-ui && npm run dev) &
UI_PID=$!

# Wait for UI ready
until curl -sf http://127.0.0.1:5173 > /dev/null; do sleep 0.5; done
echo "all started — engine=$ENGINE_PID rust=$RUST_PID ui=$UI_PID"

# Smoke: emit 1 mock event via events.jsonl (collector stub)
echo '{"schema_version":"1.0","seq":1,"dropped_since_last":0,"pid":1234,"parent_pid":1,"image_path":"/usr/local/bin/smoke","event_type":"FileWrite","file_path":"'"$WORK"'/a.docx","ts_unix_ms":'"$(date +%s%3N)"'}' >> events.jsonl

sleep 3
echo "run-all.sh OK"
```

`scripts/ws-record.sh`:
```bash
#!/usr/bin/env bash
# AC1 검증: WS 캡처에 node_add{event_type:"FileWrite"} 존재 확인
set -euo pipefail
OUT="${1:-/tmp/ws-capture.jsonl}"
# websocat 사용 (apt: `cargo install websocat` 또는 npm `wscat`)
timeout 5 websocat -n1 'ws://127.0.0.1:7000?last_seq=0' | tee "$OUT" || true
grep -q '"node_add"' "$OUT" && grep -q '"FileWrite"' "$OUT" \
  && { echo "AC1 PASS"; exit 0; } || { echo "AC1 FAIL"; exit 1; }
```

> *(노하우)* ext4는 대소문자 구분이라 `Velxor/`와 `velxor/`는 다른 폴더. 또한 `chmod +x scripts/*.sh` 후 **`git update-index --chmod=+x scripts/*.sh`**로 실행 비트를 커밋에 박아야 다른 작업자가 클론 시 즉시 실행 가능하다.

### 2.5 [Day 5, 1h] Mechanical schema ack 수집
- A/C에게 v1-draft 링크 송부, "컴파일 가능 한 줄 응답" 요청
- 양측 ack 후 walking skeleton 진입

### 2.6 AC1 통과 게이트
```bash
chmod +x scripts/run-all.sh scripts/ws-record.sh
git update-index --chmod=+x scripts/run-all.sh scripts/ws-record.sh
./scripts/run-all.sh &
sleep 5
./scripts/ws-record.sh /tmp/ws.jsonl    # → AC1 PASS
git tag walking-skeleton-v1
git push --tags
```

### 2.7 커밋
```bash
git add contracts/ velxor-rust-service/ velxor-ui/ scripts/{run-all.sh,ws-record.sh}
git commit -m "B: week1 v1-draft schema + 4 stubs + run-all + AC1"
git push
```

> **Done when**: `walking-skeleton-v1` tag push 성공, A/C가 자기 머신에서 `run-all.sh` 재현 가능.

---

## 3. Week 2-3 — UI 깊이 + 인터페이스 진화 (목표: 22h, **두 번째 최대 부하**)

### 3.1 [Week 2, 8h] ProcessTree (`@xyflow/react`)
- [ ] **batched dagre**: 새 부모-자식 추가 시에만 dagre 재실행, 동일 부모의 후속 자식은 manual incremental positioning
- [ ] 300 nodes/1s 시 jank 회피 (RAF throttle)
- [ ] 빨간 노드 강조 (verdict=ransomware 시 CSS animation)

```bash
npm install dagre  # or elk.js — 선택
```

핵심 패턴:
```tsx
function relayout(nodes, edges, parentId?) {
  if (parentId) {
    // incremental: 같은 부모의 후속 자식은 x+=80 stack
    return placeUnderParent(nodes, parentId);
  }
  // full dagre run
  return dagreLayout(nodes, edges);
}
```

### 3.2 [Week 2, 3h] Detail Panel
- [ ] PID, image_path, parent_pid, verdict, confidence, evidence[] 표시
- [ ] 선택된 노드 click → panel 갱신

### 3.3 [Week 2, 2h] Block/Allow 버튼
- [ ] click → IPC (Electron preload) → Rust 서비스로 HTTP POST `/block/:pid`
- [ ] Rust 측은 A의 자동 차단 시퀀스(`kill(SIGTERM)` → 200ms → `kill(SIGKILL)`) 재사용
- [ ] 사운드 효과는 **Deferral 후보 #1** (skip)

### 3.4 [Week 2, 2h] Threat Timeline
- [ ] D3 또는 visx → time axis + verdict markers
- [ ] **Deferral 후보 #2** — 시간 부족 시 단순 리스트 뷰로 대체

### 3.5 [Week 3, 3h] WS reconnect 안정화 + footgun 문서
- [ ] Rust 측: broadcast channel = live fan-out 전용, **별도 `VecDeque<WsMessage>` lock-protected = 5초 sliding window replay**
- [ ] UI: exponential backoff 250ms → 5s
- [ ] `docs/electron-ws-footgun.md` 작성: Electron + Vite dev 핫리로드 vs preload context isolation footgun → **dev 핫리로드 disable** 권장

### 3.6 [Week 3, 2-3h] v1.1 async review 주관
- [ ] A/C에게 v1-draft 리뷰 요청 (48h deadline 명시)
- [ ] **48시간 후**: 받은 노트만 통합해 **additive-only v1.1** 발행
- [ ] 무응답 시 단독 발행 (Principle 4)

### 3.7 [Week 3, 2-3h] 4.3/4.4 Rust 통합
- [ ] `classifier_client.rs`: REST `/classify` 호출 + **verdict cache per PID** (TTL 1s)
- [ ] `ws_broadcaster.rs`: broadcast(live) + VecDeque(replay) **분리 finalize**, gap 검출 로직

### 3.8 커밋 마일스톤
```bash
git tag schema-v1.1
git push --tags
git commit -am "B: week2-3 UI (ProcessTree+Detail+Block) + WS reconnect + v1.1 schema"
git push
```

> **Done when**: ProcessTree 300 nodes 렌더 jank 없음, WS 5초 replay 동작, v1.1 발행.

---

## 4. Week 4-5 — A 통합 주간 (목표: 0h, **휴식 또는 폴리싱**)

- A가 libfanotify 본구현 + UNIX socket 송신을 하는 동안 B는 0h 배정.
- 시간 여유 있으면:
  - [ ] `docs/ARCHITECTURE.md` 4계층 다이어그램 (collector → service → engine → UI)
  - [ ] UI CSS 폴리싱 사전 작업
  - [ ] 통합 포인트 4.5에서 A의 collector 어댑터 교체 **support 대기**

---

## 5. Week 6-7 — C 데이터 주간 (목표: 0h)

- C가 PoC + 데이터셋 + 모델 작업하는 동안 B는 0h 배정.
- 필요 시 C의 `/classify` 응답 변경에 따른 cache 전략 재검토 정도.

---

## 6. Week 8-9 — 통합 + 리허설 + AC4 instrumentation (목표: 5h)

### 6.1 [Day 1, 2h] tracing instrumentation (AC4 측정용)
- [ ] event 수신 시점 `event_received_ts` tracing field emit
- [ ] WS 송신 시점 `ws_sent_ts` field emit
- [ ] `/classify` 호출 전후 `classify_start_ts`, `classify_end_ts` field emit
- [ ] JSON formatter로 `rust-service/logs/trace.json` 저장

```rust
tracing::info!(event_received_ts = ts_ms_now(), seq = ev.seq, "evt_in");
// ...
tracing::info!(ws_sent_ts = ts_ms_now(), seq = msg.seq, "ws_out");
```

→ C가 `scripts/eval-ac4.sh`에서 이 JSON을 파싱해 p99 산출.

### 6.2 [Day 2, 2h] `docs/DEMO-SCRIPT.md` (1분 발표 흐름)
```text
00:00 PoC v2 실행 (.txt → .crypted, 500 files/0.8s)
00:01 좌측 ProcessTree에 노드 추가 (회색)
00:02 노드가 빨갛게 깜빡 + 우측 Detail Panel 표시
00:02-03 "Process X가 0.8초 동안 파일 500개 쓰기 중! AI 판정: ransomware 91%"
00:04 자동 차단(kill SIGTERM→SIGKILL) 또는 Block 버튼 → 노드 회색으로
```

### 6.3 [Day 2, 1h] UI 폴리싱
- [ ] 빨간 노드 깜빡임 keyframe animation
- [ ] verdict panel slide-in
- [ ] timing: 빨간 표시까지 wall-clock ≤ 1초 시각화 (OBS 영상 timestamp로 검증)

### 6.4 리허설 3회 진행 총괄 (Week 9)
- [ ] `docs/REHEARSAL-LOG.md` 작성 (snapshot rollback 시간, collector crash 여부, AC4 측정값)
- [ ] **collector crash 1회** 시 즉시 `VELXOR_STUB=collector` 데모 모드로 전환 결정 (원안 BSOD 대비 userspace라 시스템 전체 다운 위험 없음 — 회복 시간 < 60s)

### 6.5 AC3 evidence
- [ ] OBS 영상 + `docs/AC3-evidence/frame-1000ms.png` 캡처 (빨간 노드 + verdict panel). Ubuntu에선 OBS Studio 30.x (`sudo add-apt-repository ppa:obsproject/obs-studio && sudo apt install obs-studio`)

### 6.6 AC8 stub smoke (B 담당 = both)
```bash
VELXOR_STUB=both ./scripts/run-all.sh
./scripts/ws-record.sh  # → AC1 패턴 동일하게 통과
```

---

## 7. Week 10 — 발표 총괄 (목표: 3h)

### 7.1 슬라이드 아키텍처 섹션
- [ ] 4계층 다이어그램 (Rust+libfanotify collector → Rust service → Python engine → React+Electron UI)
- [ ] Walking Skeleton + Interface Evolution Gate 진화 과정
- [ ] AC4 결과 (event→ws p99, classify p99) 표
- [ ] OS migration 한 줄 (Windows kernel minifilter → Linux userspace fanotify, identity 약화 disclosure)

### 7.2 발표 리허설 진행 총괄
- [ ] 1-2회 풀 리허설
- [ ] 각자 담당 섹션 슬라이드 통합

### 7.3 영상
- [ ] `videos/demo.mp4` ≥ 30s 확보 (OBS 녹화)

---

## 8. 결정적 책임 5개 (절대 잊지 말 것)

| # | 책임 | 위반 시 결과 |
|---|------|-------------|
| 1 | Interface Contract v1-draft를 **Week 1 안에 발행** (`schema_version`, `seq`, `dropped_since_last`, UTF-8 PATH_MAX 4096, reconnect 프로토콜 포함) | AC1 walking skeleton 불가능 |
| 2 | WS broadcast(live)와 VecDeque(replay) **분리** — 같은 채널에 넣으면 lock contention | reconnect 시 5초 replay 동작 안 함 |
| 3 | Electron dev 핫리로드 + preload context isolation **footgun 회피** → dev 핫리로드 disable | UI가 dev에서 정상이지만 prod에서 깨짐 |
| 4 | Week 3 v1.1 review 48h 데드라인 — 무응답 시 **단독 발행 결단** | 일정 지연 |
| 5 | `VELXOR_STUB=both` smoke pass 유지 — A/C 모두 지연되어도 B의 서비스+UI는 단독 동작 | AC8 위반 |

---

## 9. 산출물 체크리스트 (최종 푸시 전)

```
Velxor/
├── contracts/
│   └── interface-schema.md                     ✅ (v1.0 + v1.1, UTF-8 PATH_MAX 4096)
├── velxor-rust-service/
│   ├── Cargo.toml                              ✅ (tokio, tokio-tungstenite, reqwest, serde, tracing, nix)
│   └── src/
│       ├── main.rs                             ✅
│       ├── classifier_client.rs                ✅
│       └── ws_broadcaster.rs                   ✅ (broadcast + VecDeque)
├── velxor-ui/
│   ├── package.json                            ✅
│   ├── electron/main.ts                        ✅
│   ├── src/
│   │   ├── App.tsx                             ✅
│   │   ├── components/{ProcessTree,Timeline,DetailPanel,BlockButton}.tsx  ✅
│   │   └── ws/client.ts                        ✅ (exponential backoff + last_seq)
│   └── vite.config.ts                          ✅
├── scripts/
│   ├── run-all.sh                              ✅ (AC1)
│   └── ws-record.sh                            ✅ (AC1)
└── docs/
    ├── ARCHITECTURE.md                         ✅
    ├── DEMO-SCRIPT.md                          ✅
    ├── REHEARSAL-LOG.md                        ✅ (전원 기여)
    ├── AC3-evidence/frame-1000ms.png           ✅
    └── electron-ws-footgun.md                  ✅
```

---

## 10. 시간 예산 vs 실제 추적

| Week | 예산(h) | 실제(h) | 누적(h) | 산출물 태그 |
|------|---------|---------|---------|------------|
| 0    | 3       |         |         | cargo build + npm run dev |
| 1    | 12      |         |         | `walking-skeleton-v1` |
| 2-3  | 22      |         |         | `schema-v1.1` |
| 4-5  | 0       |         |         | (A 통합 주간) |
| 6-7  | 0       |         |         | (C 데이터 주간) |
| 8-9  | 5       |         |         | tracing + DEMO-SCRIPT |
| 10   | 3       |         |         | slides + rehearsal |
| **합계** | **~45** | | | |

> 누적 hours > 1.15 × 45 = 52h 도달 시 deferral 발동: 사운드(#1) → Timeline(#2) → 자동차단(#3) → 백업영상(#4) 순.

---

## 11. 트러블슈팅 빠른 참조

| 증상 | 원인 후보 | 즉시 조치 |
|------|-----------|-----------|
| WS reconnect 시 누락 메시지 | broadcast lag — replay VecDeque에 N+1이 evict됨 | `{type:"gap"}` 송신 → UI full refresh 트리거 확인 |
| Electron dev에서 UI 정상 but prod 깨짐 | preload context isolation + Vite hot reload | dev 핫리로드 disable, `webPreferences.contextIsolation:true` 유지 |
| ProcessTree 300 nodes jank | dagre full re-run 매 노드마다 | batched dagre + incremental positioning |
| `run-all.sh` exit ≠ 0 | engine/rust/ui 중 1개 실패 | 각 컴포넌트 단독 실행 후 로그 확인 |
| AC4 p99 측정값 없음 | tracing JSON 미생성 | `tracing-subscriber::fmt().json().init()` 호출 확인 |
| `?last_seq=N` 무시됨 | server query parsing 누락 | tokio-tungstenite accept 시 URL 파싱 명시 |
| `npm` 명령 없음 / Node 22 들어옴 | apt nodejs 사용 | nvm로 v20 설치·사용 (`nvm install 20 && nvm use 20`) |
| 포트 5173/7000/8765 누수 | trap 미작동 | `ss -ltnp 'sport = :7000'`로 PID 확인 후 `fuser -k 7000/tcp` |
| `chmod +x` 후에도 다른 작업자에서 실행 안 됨 | git에 권한 비트 비커밋 | `git update-index --chmod=+x scripts/foo.sh` 후 재커밋 |

---

## 12. 의존성 격리 원칙 (B의 핵심 가치)

A 또는 C가 지연되어도 B의 통합 서비스 + UI는 **단독으로 walking skeleton 데모를 유지**해야 한다.
- A 지연 → `VELXOR_STUB=collector` (events.jsonl poll)
- C 지연 → `VELXOR_STUB=engine` (하드코드 verdict)
- 둘 다 지연 → `VELXOR_STUB=both`

이 격리가 깨지면 발표 자체가 위험해진다. **Week 1 v1-draft + run-all.sh가 이 보험의 핵심**.

---

## 끝 — 이 문서대로 위에서 아래로만 진행하면 ~45h 안에 작업자 B의 모든 책임이 완료된다.
