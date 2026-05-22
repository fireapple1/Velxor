# 작업자 B — 타임라인 최적화 실행 플랜 (Copy-Paste Runnable, UI 풀스택 + 발표 퀄리티 오너)

> **목적**: 이 문서 하나만 위에서 아래로 따라가면 작업자 B의 ~32h 분량(**React+Electron UI 풀스택 + DEMO-SCRIPT + AC3 evidence + 리허설 코디네이션 + 발표 영상 + 슬라이드 UI 섹션**)이 그대로 진행된다.
> **선행 문서**: [`role-assignment.md`](./role-assignment.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md), [`ENVIRONMENT.md`](./ENVIRONMENT.md), A의 [`contracts/interface-schema.md`](./contracts/interface-schema.md)
> **브랜치**: `devB` (모든 PR은 `devB → main`)
> **OS 가정**: **Ubuntu 24.04 LTS** (bare-metal 또는 KVM/VirtualBox VM).
> **Toolchain**: Node 20 LTS (`nvm install 20` 권장 — apt는 22 들어옴), npm 10.x
> **2026-05-22 재분배**: 종전 "B=Rust integration + UI + Interface Contract + scripts + DEMO"에서 **"B=UI 풀스택 + 발표 퀄리티만"**으로 축소. Rust는 A 단독, scripts/Interface Contract 일부는 C가 흡수. B는 UI 안정성과 발표 임팩트에 집중한다.

---

## B의 새 역할 한 줄

> A가 Rust critical path를 단독 소유함에 따라 **B는 시연을 가시화·라이브화하는 frontend specialist + 발표 퀄리티 게이트 키퍼**. 코드 자체는 작아도 **DEMO-SCRIPT/AC3 evidence/리허설/영상/슬라이드 UI 섹션 4가지가 발표 평가의 70%를 가른다**.

---

## 0. 시작 전 단 한 번만 확인 (5분)

```bash
mkdir -p ~/src && cd ~/src
git clone <REPO_URL> Velxor && cd Velxor
git checkout -b devB origin/main || git checkout devB

# apt baseline (sudo 필요)
sudo apt update && sudo apt install -y git curl jq

# Node 20 LTS via nvm (apt 22 회피)
command -v nvm || { curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash; \
                    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; }
nvm install 20 && nvm use 20
node --version            # v20.x
npm --version             # 10.x

# OBS Studio (AC3 evidence + 발표 영상)
sudo add-apt-repository -y ppa:obsproject/obs-studio
sudo apt install -y obs-studio
obs --version             # 30.x
```

> ⚠️ B의 Week 2-3(18h)이 단일 최대 부하. UI 풀스택 + WS reconnect + footgun 문서를 한 주에 끝내야 함.

---

## 1. Week 0 — UI scaffold (목표: 2h)

### 1.1 Vite + React + TS + Electron + React Flow
```bash
npm create vite@latest ui -- --template react-ts
cd ui
npm install
npm install electron @xyflow/react
npm install -D concurrently wait-on
npm run dev                # http://localhost:5173 200 확인 후 Ctrl-C
cd ..
```

### 1.2 Week 0 검증 게이트
- [ ] `npm run dev` 200 (브라우저 또는 curl로 확인)
- [ ] **A의 Week 0 AC(fanotify smoke) 통과 + C의 `/health` 200 + B의 `npm run dev` 200 = Week 1 진입 자격**

```bash
git add ui/
git commit -m "B: week0 vite + react-ts + electron + xyflow scaffold (ubuntu 24.04)"
git push -u origin devB
```

> **Done when**: `npm run dev` 200, devB push.

---

## 2. Week 1 — UI stub + WS client (목표: 4h)

> **이 주가 B의 첫 번째 부하 구간**. A의 v1-draft schema를 받아 UI consumer ack + reconnect 골격 구현.

### 2.1 [Day 1, 0.5h] A의 v1-draft schema mechanical ack

- A가 `contracts/interface-schema.md` v1-draft를 push하면 B는 PR comment 한 줄:
  ```text
  [B / UI consumer review]
  compiles-against-ui: OK
  Note: WsMessage.payload 모양에 대해 의미 review는 Week 3에 제출.
  ```

### 2.2 [Day 1-3, 3h] UI stub (`ui/src/App.tsx`)

```tsx
import { ReactFlow, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";

type WsMessage = {
  schema_version: string;
  seq: number;
  type: "node_add" | "node_update" | "verdict" | "alert" | "gap";
  payload: any;
};

export default function App() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [verdict, setVerdict] = useState<any>(null);

  useEffect(() => {
    let lastSeq = 0;
    let backoff = 250;

    const connect = () => {
      const ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);

      ws.onopen = () => { backoff = 250; };

      ws.onmessage = (e) => {
        const m: WsMessage = JSON.parse(e.data);
        if (m.seq <= lastSeq) return;          // dedupe
        lastSeq = m.seq;

        if (m.type === "node_add") {
          setNodes((ns) => [...ns, {
            id: String(m.payload.pid ?? Math.random()),
            data: { label: `pid ${m.payload.pid}`, ...m.payload },
            position: { x: Math.random() * 800, y: Math.random() * 600 },
            style: { background: "#888" },
          }]);
        } else if (m.type === "node_update") {
          setNodes((ns) => ns.map(n => n.id === String(m.payload.pid) ? { ...n, data: { ...n.data, ...m.payload } } : n));
        } else if (m.type === "verdict") {
          setVerdict(m.payload);
          if (m.payload?.verdict === "ransomware") {
            setNodes((ns) => ns.map(n => n.id === String(m.payload.pid) ? { ...n, style: { background: "#e53935", animation: "pulse 0.5s infinite" } } : n));
          }
        } else if (m.type === "gap") {
          // 5초 replay 윈도우 외 → full refresh
          setNodes([]); setEdges([]); setVerdict(null); lastSeq = 0;
        }
      };

      ws.onclose = () => {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };
      ws.onerror = () => { ws.close(); };
    };

    connect();
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <div style={{ flex: 3 }}>
        <ReactFlow nodes={nodes} edges={edges}><Background /></ReactFlow>
      </div>
      <div style={{ flex: 1, padding: 16, background: "#222", color: "#fff" }}>
        <h3>Detail Panel</h3>
        {verdict ? (
          <pre>{JSON.stringify(verdict, null, 2)}</pre>
        ) : <p>(no verdict yet)</p>}
      </div>
    </div>
  );
}
```

`ui/electron/main.ts` (Electron shell, **dev hot-reload disable** — `docs/electron-ws-footgun.md` 사유):
```ts
import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL("http://127.0.0.1:5173");
});

app.on("window-all-closed", () => app.quit());
```

### 2.3 [Day 4, 0.5h] AC1 walking skeleton 통합 확인 (C 주관)

- C가 `scripts/run-all.sh`로 engine + A의 rust-service + B의 UI를 일괄 기동
- B는 자기 머신에서 다음을 확인:
  ```bash
  cd ~/src/Velxor
  ./scripts/run-all.sh &
  sleep 5
  # 브라우저(또는 electron)에서 http://127.0.0.1:5173 열기, ProcessTree 회색 노드 + Detail Panel 표시 확인
  ./scripts/ws-record.sh /tmp/ws.jsonl    # A 작성. PASS 확인.
  ```
- B 측 통합 검증 통과 시 mechanical ack 추가

### 2.4 커밋
```bash
git add ui/
git commit -m "B: week1 UI stub (App.tsx WS client + Detail panel) + Electron shell"
git push
```

> **Done when**: WS client 자기 머신에서 stub broadcast 수신 + 빨간 노드 시각화 + `?last_seq=N` reconnect 동작.

---

## 3. Week 2-3 — UI 풀스택 + WS reconnect 안정화 + footgun (목표: 18h, **B 최대 부하**)

### 3.1 [Week 2 Day 1-2, 6h] ProcessTree 컴포넌트 (`@xyflow/react`)

`ui/src/components/ProcessTree.tsx`:
```tsx
import { ReactFlow, Background, Controls } from "@xyflow/react";
import dagre from "dagre";
import { useEffect, useMemo, useState } from "react";

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));
dagreGraph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });

function layoutFull(nodes: any[], edges: any[]) {
  nodes.forEach(n => dagreGraph.setNode(n.id, { width: 120, height: 40 }));
  edges.forEach(e => dagreGraph.setEdge(e.source, e.target));
  dagre.layout(dagreGraph);
  return nodes.map(n => {
    const pos = dagreGraph.node(n.id);
    return { ...n, position: { x: pos.x - 60, y: pos.y - 20 } };
  });
}

function placeIncremental(nodes: any[], parentId: string, childId: string) {
  // 동일 부모의 후속 자식은 manual x+=80 stack (full dagre 비호출)
  const parent = nodes.find(n => n.id === parentId);
  if (!parent) return nodes;
  const siblings = nodes.filter(n => n.data?.parentId === parentId);
  const x = parent.position.x + 80 * siblings.length;
  return nodes.map(n => n.id === childId ? { ...n, position: { x, y: parent.position.y + 100 } } : n);
}

export function ProcessTree({ nodes, edges, onSelect }: any) {
  return (
    <ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, n) => onSelect(n)}>
      <Background /><Controls />
    </ReactFlow>
  );
}
```

**핵심**:
- [ ] batched dagre: 새 부모-자식 추가 시에만 dagre 재실행, 동일 부모의 후속 자식은 manual incremental
- [ ] 300 nodes/1s 시 jank 회피 (RAF throttle: `requestAnimationFrame` 묶음 적용)
- [ ] 빨간 노드 강조 — CSS keyframe `pulse`

`ui/src/index.css`:
```css
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.6); }
  50%      { box-shadow: 0 0 0 12px rgba(229, 57, 53, 0); }
}
```

### 3.2 [Week 2 Day 3, 2h] Detail Panel
`ui/src/components/DetailPanel.tsx`:
```tsx
export function DetailPanel({ node, verdict, onBlock, onAllow }: any) {
  if (!node) return <div style={{ padding: 16 }}>(클릭한 프로세스 없음)</div>;
  return (
    <div style={{ padding: 16, background: "#1a1a1a", color: "#fff", height: "100%" }}>
      <h3>PID {node.data.pid}</h3>
      <p>Image: {node.data.image_path}</p>
      <p>Parent PID: {node.data.parent_pid}</p>
      <p>Verdict: {verdict?.verdict ?? "(pending)"}</p>
      <p>Confidence: {verdict?.confidence?.toFixed(2) ?? "-"}</p>
      <ul>{verdict?.evidence?.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
      <button onClick={() => onBlock(node.data.pid)} style={{ background: "#e53935", color: "#fff", padding: 8, marginRight: 8 }}>Block</button>
      <button onClick={() => onAllow(node.data.pid)} style={{ background: "#4caf50", color: "#fff", padding: 8 }}>Allow</button>
    </div>
  );
}
```

### 3.3 [Week 2 Day 4, 2h] Block/Allow 버튼 → A의 Rust 서비스 IPC

`ui/src/api/block.ts`:
```ts
export async function block(pid: number) {
  const r = await fetch(`http://127.0.0.1:7001/block/${pid}`, { method: "POST" });
  return r.text();
}
export async function allow(pid: number) {
  const r = await fetch(`http://127.0.0.1:7001/allow/${pid}`, { method: "POST" });
  return r.text();
}
```

> A의 rust-service에 `/block/:pid` HTTP endpoint를 노출 (Week 4-5에서 본구현). 사운드 효과는 **Deferral #1** (skip).

### 3.4 [Week 2 Day 5, 2h] Threat Timeline (Deferral #2 후보)
`ui/src/components/Timeline.tsx`:
```tsx
// D3 또는 visx로 time axis + verdict markers
// 시간 부족 시 단순 리스트 뷰로 대체 — Deferral #2
import * as d3 from "d3";
import { useEffect, useRef } from "react";

export function Timeline({ events }: { events: { ts: number; verdict?: string }[] }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !events.length) return;
    const svg = d3.select(ref.current);
    const x = d3.scaleTime().domain(d3.extent(events, e => new Date(e.ts)) as [Date, Date]).range([20, 780]);
    svg.selectAll("circle").data(events).join("circle")
      .attr("cx", e => x(new Date(e.ts))).attr("cy", 30).attr("r", 4)
      .attr("fill", e => e.verdict === "ransomware" ? "#e53935" : "#888");
  }, [events]);
  return <svg ref={ref} width={800} height={60} style={{ background: "#111" }} />;
}
```

### 3.5 [Week 3 Day 1, 3h] WS reconnect 안정화 + footgun 문서

`ui/src/ws/client.ts` (App.tsx에서 추출, 재사용 가능한 hook):
```ts
import { useEffect } from "react";

export function useVelxorWs(onMessage: (m: any) => void) {
  useEffect(() => {
    let lastSeq = 0;
    let backoff = 250;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);
      ws.onopen = () => { backoff = 250; };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.seq <= lastSeq) return;
        lastSeq = m.seq;
        onMessage(m);
      };
      ws.onclose = () => { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000); };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { alive = false; };
  }, [onMessage]);
}
```

`docs/electron-ws-footgun.md` 작성:
```markdown
# Electron + Vite + WS preload context isolation footgun

## 증상
- `npm run dev`에서 WS reconnect 정상, Electron 빌드(`electron-builder`) 후 prod 패키지에서 WS 메시지가 *간헐적으로* 누락.
- 또는 dev hot-reload가 활성인 상태에서 Vite HMR이 ws-client를 두 번 마운트 → 동일 WS connection을 두 번 열어 broadcast 중복 수신 / race로 last_seq 갱신 깨짐.

## 원인
1. **Vite HMR**이 useEffect cleanup을 호출하지 않은 채 ws.onmessage handler를 재등록.
2. **Electron preload + contextIsolation:true**에서 `new WebSocket(...)`이 renderer 컨텍스트에서 동작하지만, dev 모드에서 sandbox 정책 차이로 일부 close 이벤트가 누락.

## 처방
- `electron/main.ts`에서 `webPreferences.contextIsolation: true` 유지 + `nodeIntegration: false`.
- **dev hot-reload 비활성**: `npm run dev`로 Vite는 계속 띄우되 Electron은 prod 빌드(`npm run build && npm run electron:start`)에서만 테스트.
- ws-client는 `useEffect`에서 `alive` flag로 closure 격리.

## 자기 점검
- 한 번에 1개 WS connection만 열려있는지: 브라우저 DevTools Network → WS 탭에서 connection 수 확인.
- last_seq가 단조 증가하는지: console.log 임시 추가.
```

### 3.6 [Week 3 Day 2, 2h] v1.1 schema review input

A가 trigger한 v1.1 review에 UI consumer 관점 노트 1건 제출:
```text
[B / UI consumer review]
Issue: WsMessage.type="verdict" payload에 evidence[] 항목이 string인데 UI Detail Panel에서 typed (k, v) 객체가 필요.
Why: 단순 string은 i18n·강조·링크 부착이 어려움.
Proposed (additive only): payload.evidence_v2: { key: string, value: string, severity?: number }[] 새 optional field 추가.
```

> 48h deadline 안에 제출. 무응답 시 A 단독 발행.

### 3.7 [Week 3 Day 3, 3h] 통합 검증 & UI 풀스택 결선
- A의 broadcast/replay 분리 finalize 후 `?last_seq=N` 핸드셰이크 실측
- C의 모델 `/classify` 응답 → verdict WS message → UI 빨간 노드 시각화 e2e

```bash
./scripts/run-all.sh &
sleep 5
# 자기 머신에서 PoC v1을 트리거 (C의 simulator 사용)
( cd python-engine && source .venv/bin/activate && python ../poc-samples/ransomware_simulator/v1/simulate.py ~/velxor-work/dst --count 300 ) &
# 1초 안에 UI에 빨간 노드 + verdict panel 표시되는지 시각 확인
```

### 3.8 커밋 마일스톤
```bash
git add ui/ docs/electron-ws-footgun.md
git commit -m "B: week2-3 UI풀스택 (ProcessTree/Detail/Block/Timeline) + WS reconnect + footgun doc"
git push
```

> **Done when**: ProcessTree 300 nodes 렌더 jank 없음, WS 5초 replay 동작, footgun 문서 1 commit, v1.1 review 노트 제출.

---

## 4. Week 4-5 — A 통합 주간 (목표: 0h, **휴식 또는 폴리싱**)

A가 libfanotify 본구현 + Rust service 완성하는 동안 B는 0h 배정. 시간 여유 있으면:

- [ ] UI CSS 폴리싱 사전 작업 (애니메이션 keyframe 다듬기, 색상 팔레트 확정)
- [ ] A의 Rust service `/block/:pid` 도착 시 B의 Block 버튼이 실제로 kill 시퀀스 트리거하는지 e2e 테스트
- [ ] DEMO-SCRIPT.md 초안 (Week 8-9에 finalize) — 시연 동선 1차 작성

> A가 critical path이므로 **B의 여유는 A를 정신적으로 받쳐주는 시간**. 단톡방에 가용성 알리고 e2e smoke 협력.

---

## 5. Week 6-7 — C 데이터 주간 (목표: 0h)

C가 PoC + 데이터셋 + 모델 작업하는 동안 B는 0h 배정. 시간 여유 있으면:

- [ ] AC3 evidence를 위한 OBS 녹화 환경 사전 점검 (해상도, 프레임률, 마이크 mute 등)
- [ ] 발표 영상 background music / 자막 sketch (Week 10 finalize)
- [ ] C의 `/classify` 응답 신규 필드(v1.1 evidence_v2 등)에 대한 UI 표시 코드 추가

---

## 6. Week 8-9 — UI 폴리싱 + DEMO-SCRIPT + AC3 evidence + 리허설 코디네이션 (목표: 5h)

> **B의 발표 퀄리티 게이트 키퍼 책임**이 본격 가동되는 구간.

### 6.1 [Day 1, 1h] UI 폴리싱
- 빨간 노드 깜빡임 keyframe (3.1 `pulse` 보강)
- verdict panel slide-in (CSS transform + transition)
- timing 시각화: PoC trigger → 빨간 표시까지 wall-clock ≤ 1초 (OBS 영상 timestamp로 검증 가능하도록 한 화면에 시각 표시)

### 6.2 [Day 2, 1h] `docs/DEMO-SCRIPT.md` (1분 발표 흐름)

```markdown
# DEMO-SCRIPT.md — 60초 발표 흐름

## 0:00 ~ 0:05 — Set
- 화면 절반: Electron UI (ProcessTree 비어있음)
- 화면 절반: Terminal (PoC simulator 명령 대기)

## 0:05 ~ 0:08 — Trigger
- Terminal에서 PoC v2 실행:
  `python poc-samples/ransomware_simulator/v2/simulate.py ~/velxor-work/dst --count 500`
- 좌측 ProcessTree에 회색 노드 1개 추가됨

## 0:08 ~ 0:10 — Wow moment (1초 내)
- 노드가 빨갛게 깜빡 (CSS pulse animation)
- 우측 Detail Panel slide-in: PID, image, verdict, confidence, evidence[]

## 0:10 ~ 0:20 — Narration
"Process X가 0.8초 동안 .txt 파일 500개를 .crypted로 rename + 32B 덮어쓰기. AI 판정: ransomware, 91%. 행위 윈도우 통계로 분류."

## 0:20 ~ 0:35 — Block
- Detail Panel의 Block 버튼 클릭
- 백엔드: A의 Rust service → kill(SIGTERM) → 200ms → SIGKILL
- UI 노드 회색으로 + verdict panel "blocked" 표시

## 0:35 ~ 0:55 — 데이터 전략 슬라이드 1장
"학습은 v1+v2, held-out은 v3(.pdf→.locked). negative는 rsync/unzip/git-clone/npm-install. AC5: TP 9/10, FP 1/10."

## 0:55 ~ 1:00 — Disclaimer
"Evaluated on synthetic PoC, not real-world malware. Linux/ext4 + fanotify userspace. Future work: LSM/eBPF."
```

### 6.3 [Day 3, 1h] AC3 evidence 캡처

```bash
# OBS Studio 설정: 1920×1080, 60fps, 음원 OFF
obs &
# OBS에서 Recording 시작 (단축키 또는 GUI)
./scripts/run-all.sh &
sleep 5
( cd python-engine && source .venv/bin/activate && python ../poc-samples/ransomware_simulator/v2/simulate.py ~/velxor-work/dst --count 500 )
# 5~10초 후 OBS 중지

# 1000ms 시점 frame 추출
mkdir -p docs/AC3-evidence
ffmpeg -i ~/Videos/<obs-output>.mkv -ss 00:00:01.000 -vframes 1 docs/AC3-evidence/frame-1000ms.png
```

체크:
- [ ] frame-1000ms.png에 빨간 노드 + verdict panel 모두 가시
- [ ] 영상 ≥ 30s
- [ ] OBS 출력 mp4/mkv를 `videos/demo.mp4`로 정리

### 6.4 [Day 4-5, 2h] 리허설 3회 진행 총괄

`docs/REHEARSAL-LOG.md`:
```markdown
# REHEARSAL-LOG.md

## Rehearsal 1 (YYYY-MM-DD)
- 진행자: B
- 참여: A, B, C
- 환경: `VELXOR_STUB=unset` (full real)
- 결과:
  - run-all.sh 기동 시간: <s>
  - PoC trigger → 빨간 노드: <ms>
  - collector crash 발생 여부: NO / YES (조치: ...)
  - WS reconnect 트리거 여부: NO / YES (gap message 횟수: ...)
  - A의 tracing JSON 정상 생성: YES / NO
  - C의 eval-ac4.sh 출력: event→ws p99=<ms>, classify p99=<ms>
- 다음 회차 개선점: ...

## Rehearsal 2 (YYYY-MM-DD)
...

## Rehearsal 3 (YYYY-MM-DD)
- snapshot rollback 시간: <s> (목표 < 60s)
- 최종 결정: VELXOR_STUB=<mode> 데모 진행 OR full real
```

B는 진행 총괄:
- 시작 5분 전 A/C에게 ready 확인
- 매 회차 후 즉시 회고 5분
- collector crash 1회 발생 시 즉시 `VELXOR_STUB=collector` 데모 모드 전환 결정 (A와 합의)

### 6.5 커밋
```bash
git add docs/DEMO-SCRIPT.md docs/AC3-evidence/ docs/REHEARSAL-LOG.md videos/
git commit -m "B: week8-9 UI 폴리싱 + DEMO-SCRIPT + AC3 evidence + REHEARSAL-LOG"
git push
```

> **Done when**: DEMO-SCRIPT 1 commit, frame-1000ms.png 캡처, REHEARSAL-LOG 3회분, videos/demo.mp4 ≥ 30s.

---

## 7. Week 10 — 발표 (목표: 3h)

### 7.1 [Day 1, 1.5h] 슬라이드 UI 섹션
- 4계층 다이어그램의 UI layer card (C의 ARCHITECTURE.md 인용)
- ProcessTree + Detail Panel 스크린샷 (빨간 노드 깜빡임 → mp4 GIF 1장)
- Walking Skeleton 진화: Week 1 회색 노드 → Week 8 빨간 노드 + verdict
- "B의 결정": dev hot-reload disable, broadcast/replay 분리 의의

### 7.2 [Day 1, 0.5h] 발표 영상 편집
- OBS mkv → mp4 (ffmpeg 또는 OBS export)
- 자막 추가 (DEMO-SCRIPT.md narration 그대로)
- ≥ 30s 컷, 1분 이하

```bash
ffmpeg -i ~/Videos/<obs-output>.mkv -c:v libx264 -crf 23 -c:a aac videos/demo.mp4
```

### 7.3 [Day 2, 1h] 풀 리허설 1-2회 진행
- A의 collector 섹션, B의 UI 섹션, C의 데이터 섹션 시간 배분
- 슬라이드 전환 부드러움, 영상 재생 fallback (라이브 실패 시 mp4 재생)

### 7.4 최종 커밋
```bash
git add docs/slides/b-section.pdf docs/slides/b-section.md videos/demo.mp4
git commit -m "B: week10 UI slides + demo.mp4 final cut"
git push
```

---

## 8. 결정적 책임 5개 (절대 잊지 말 것)

| # | 책임 | 위반 시 결과 |
|---|------|-------------|
| 1 | **Electron dev 핫리로드 + preload context isolation footgun 회피** → dev 핫리로드 disable | UI가 dev에서 정상이지만 prod에서 깨짐 |
| 2 | WS broadcast/replay 분리 (A 측 구현)를 UI 측 `?last_seq=N` 핸드셰이크로 정확히 사용 | reconnect 시 5초 replay 동작 안 함 |
| 3 | DEMO-SCRIPT + AC3 evidence + 리허설 3회 = **발표 평가의 70%** | 시연 안정성·임팩트 붕괴 |
| 4 | `videos/demo.mp4` ≥ 30s 백업 영상 = 라이브 실패 시 즉시 fallback | AC7 위반 + 발표 중 사고 시 무방비 |
| 5 | v1.1 review 48h 데드라인 안에 UI consumer 노트 1건 제출 | A 단독 발행 → UI 요구사항 누락 |

---

## 9. 산출물 체크리스트 (최종 푸시 전)

```
Velxor/
├── ui/                                  ⬅ 전부 B
│   ├── package.json
│   ├── electron/main.ts                 # context isolation true, dev hot-reload off
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ProcessTree.tsx          # batched dagre
│   │   │   ├── DetailPanel.tsx
│   │   │   ├── BlockButton.tsx
│   │   │   └── Timeline.tsx
│   │   ├── ws/client.ts                 # exponential backoff + last_seq
│   │   └── api/block.ts                 # A의 /block/:pid HTTP IPC
│   ├── vite.config.ts
│   └── index.css                        # pulse keyframe
├── docs/
│   ├── DEMO-SCRIPT.md                   ⬅ B
│   ├── AC3-evidence/frame-1000ms.png    ⬅ B
│   ├── REHEARSAL-LOG.md                 ⬅ B 취합
│   ├── electron-ws-footgun.md           ⬅ B
│   └── slides/b-section.*               ⬅ B
└── videos/
    └── demo.mp4                         ⬅ B (≥ 30s)
```

---

## 10. 시간 예산 vs 실제 추적

| Week | 예산(h) | 실제(h) | 누적(h) | 산출물 태그 |
|------|---------|---------|---------|------------|
| 0    | 2       |         |         | vite + electron + xyflow scaffold |
| 1    | 4       |         |         | UI stub + WS client |
| 2-3  | 18      |         |         | UI 풀스택 + WS reconnect + footgun |
| 4-5  | 0       |         |         | (A 통합 주간) |
| 6-7  | 0       |         |         | (C 데이터 주간) |
| 8-9  | 5       |         |         | DEMO-SCRIPT + AC3 + REHEARSAL-LOG + 폴리싱 |
| 10   | 3       |         |         | slides + demo.mp4 + 풀 리허설 |
| **합계** | **~32** | | | |

> 누적 hours > 1.15 × 32 = 37h 도달 시 deferral 발동: 사운드(#1) → Timeline(#2) → 백업영상(#4) 순.

---

## 11. 트러블슈팅 빠른 참조

| 증상 | 원인 후보 | 즉시 조치 |
|------|-----------|-----------|
| WS reconnect 시 누락 메시지 | A 측 replay VecDeque에 N+1이 evict됨 | `{type:"gap"}` 수신 시 UI full refresh 트리거 확인 |
| Electron dev에서 UI 정상 but prod 깨짐 | preload context isolation + Vite hot reload | dev 핫리로드 disable, `contextIsolation:true` 유지 |
| ProcessTree 300 nodes jank | dagre full re-run 매 노드마다 | batched dagre + incremental positioning |
| Block 버튼 무반응 | A의 `/block/:pid` endpoint 미구현 | A에 확인. Week 4-5 안에 결선되어야 함. 임시: Block 버튼 disable + "manual" 표기 |
| `?last_seq=N` 무시됨 | A 측 query parsing 누락 | A에게 ws_broadcaster.rs accept 시 URL 파싱 확인 요청 |
| `npm` 명령 없음 / Node 22 들어옴 | apt nodejs 사용 | nvm로 v20 설치·사용 (`nvm install 20 && nvm use 20`) |
| 포트 5173 누수 | trap 미작동 | `ss -ltnp 'sport = :5173'` PID 확인 후 `fuser -k 5173/tcp` |
| OBS 녹화 화질 흐림 | 해상도/비트레이트 설정 | 1920×1080 + 6000 kbps + 60fps, x264 medium preset |
| ffmpeg 자막 안 박힘 | 자막 stream 미선택 | `-c:s mov_text` 또는 `-vf "subtitles=script.srt"` |

---

## 12. 의존성 격리 — B는 UI 단독 가시화 가능해야 함

A의 Rust service가 지연되어도 B의 UI는 **`VELXOR_STUB=both` 모드**에서 events.jsonl 한 줄만 있으면 단독 시연 가능:
```bash
# A 부재 시 임시 시연 — 단, A의 4 Rust stub은 Week 1에 cargo build 통과한 상태여야 함
(cd rust-service && VELXOR_STUB=both cargo run --release) &
echo '{"schema_version":"1.0","seq":1,"dropped_since_last":0,"pid":1234,"parent_pid":1,"image_path":"/usr/bin/demo","event_type":"FileWrite","file_path":"/home/x/a.docx","ts_unix_ms":'"$(date +%s%3N)"'}' >> events.jsonl
( cd ui && npm run dev )
```

C의 engine이 지연되어도 `VELXOR_STUB=engine` 모드의 하드코드 verdict로 빨간 노드 시각화 가능.

> **B의 핵심 가치**: A/C 둘 다 지연되어도 UI는 stub 영속으로 시연 자체를 보장. 발표 영상은 stub 모드여도 disclaimer 한 줄로 정당화 가능.

---

## 끝 — 이 문서대로 위에서 아래로만 진행하면 ~32h 안에 작업자 B의 모든 책임이 완료된다. **B는 코드가 작은 대신 발표 퀄리티 4개(DEMO-SCRIPT/AC3 evidence/리허설/영상)가 발표의 70%를 가른다는 점을 잊지 말 것.**
