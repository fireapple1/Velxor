# Electron + Vite + WS — UI 측 함정 정리

> **저자**: Worker B
> **대상**: 미래의 B 자신 + 인계자
> **연관**: [`contracts/interface-schema.md`](../contracts/interface-schema.md) §4 reconnect 프로토콜, [`contracts/handoff-week4-5.md`](../contracts/handoff-week4-5.md) §3·§4

여기 적힌 5개 함정은 모두 한 번씩 잡아본 것이거나, A의 broadcast/replay 분리 명세를 UI 측에서 잘못 소비할 때 재발하는 항목들이다. 데모 직전에 처음 만나면 시간이 부족하므로 미리 박아둔다.

---

## 1. Vite HMR이 ws-client를 두 번 마운트한다

### 증상
- `npm run dev`로 띄운 상태에서 코드를 저장하면 React StrictMode + Vite HMR이 useEffect를 cleanup 없이 재실행 → 동일 URL로 WebSocket을 두 번 연다.
- 한쪽에서 받은 `seq` 만 `lastSeq`를 갱신하는데 두 번째 connection의 onmessage가 stale closure를 잡으면 dedupe 룰이 깨진다.

### 처방
- ws client는 외부 변수가 아니라 effect 내부의 `alive` flag로 격리한다. cleanup에서 `alive = false` + `ws?.close()`.
- 콜백은 ref(`handlersRef`)로 latest를 잡고, effect dep는 `url`만 둔다. 콜백 식별자 변경마다 reconnect 되면 5초 replay 윈도우를 매번 새로 시작해 사용량이 무의미하게 부풀어진다.
- `vite.config.ts`에서 `server.hmr = false`로 dev HMR 자체를 끈다. UI는 보통 발표 직전 `npm run build && npm run electron:start`로 검증하므로 HMR 비용을 부담할 이유가 없다.

### 자기 점검
- DevTools Network → WS 탭에서 connection 수가 정확히 1.
- `console.log(lastSeq)` 임시로 박아 단조 증가하는지.

---

## 2. Electron preload + contextIsolation 환경에서 dev WS가 prod와 다르게 움직인다

### 증상
- dev (`vite` + electron `loadURL("http://127.0.0.1:5173")`) 에선 WS reconnect 정상.
- `electron-builder`로 패키징한 prod 빌드에선 `onclose`가 가끔 발화 안 함 → 클라이언트 backoff 자체가 시작되지 않음.

### 원인
- Electron의 sandbox + contextIsolation 조합에서 dev/prod 정책 차이.
- prod에선 `loadFile(dist/index.html)`을 쓰는 게 표준 — `file://` origin에서 WS가 의도대로 작동.

### 처방
- `electron/main.cjs`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` 고정.
- `VELXOR_UI_USE_DEV_SERVER=1` 일 때만 `loadURL`, 기본은 `loadFile`.
- 리허설/발표 환경 검증은 반드시 prod 빌드 (`npm run build` → `npm run electron:start`).

---

## 3. `gap` 수신 시 부분 복구를 시도하면 그래프가 영원히 어긋난다

### 증상
- 5초 sliding replay 윈도우(A 측 `ReplayBuffer`)를 넘긴 후 재접속 → 서버가 `{type:"gap", payload:{from, to}}` 발행.
- UI가 "from~to 범위만 빈칸으로 두자"는 식의 부분 복구를 시도하면 PID 순서·verdict cache·edge 토폴로지가 영구 divergent.

### 처방
- `gap` 수신 → **무조건 UI 전체 reset**. `graphReducer`의 reset case가 `{...initialGraphState, status, gapCount+=1}`로 동작.
- `lastSeq = 0` 으로 되돌려 다음 reconnect 때 backlog 전체 받기.
- StatusBar에 `gap` 카운터를 노출해 리허설 시 빈도 모니터링.

### 자기 점검
- `wscat -c 'ws://127.0.0.1:7000?last_seq=99999999'` 으로 강제 gap → UI 그래프 비워지는지.

---

## 4. WsMessage `seq`는 `node_add` 와 `verdict` 가 공유한다

### 증상
- "verdict는 별도 시퀀스겠지" 가정으로 dedupe를 type별로 따로 두면 verdict 메시지가 silently dropped.

### 처방
- `contracts/interface-schema.md` §3 + handoff §3 명세대로 **단일 monotonic seq**.
- dedupe는 type 무관 `msg.seq <= lastSeq ? drop : lastSeq = msg.seq`.
- 예외: `gap` 만 `seq=0` 의 out-of-band 시그널이므로 dedupe 비교 전에 분기.

---

## 5. Block 버튼은 6개 outcome을 모두 표시해야 한다

### 증상
- `killed` 만 빨갛게 처리하고 나머지 outcome (`terminated`/`already_gone`/`eperm`/`invalid`/`error`)은 무시 → 사용자는 "왜 안 죽었지?" 라는 인상.

### 처방
- `api/block.ts`의 `OUTCOME_LABEL` 매핑이 단일 소스. 6개 모두 (text, tone) 정의.
- `pid ≤ 1` 은 fetch 자체를 보내지 않고 클라이언트에서 `invalid` 반환 (서버 round-trip 절약 + init/process-group broadcast 방어 노출 일관성).
- `VELXOR_BLOCK_TOKEN` env가 설정된 경우 `X-Velxor-Token` 헤더 자동 첨부 — 데모는 unset 가정.

### 검증 시나리오
1. `sleep 9999 &` 의 PID로 Block → `terminated` 또는 `killed`.
2. PID `1` 클릭 후 Block → fetch 안 나가고 `invalid`.
3. 이미 죽은 PID → `already_gone`.

---

## 부록 — Node 20 vs Electron 32+ 호환

`package.json`은 Electron 31 LTS (Node 20.x 호환). 최신 Electron 32+/33은 Node ≥22.12를 요구하므로, nvm로 Node 20을 유지하는 한 31 라인을 고정한다. Electron 32로 올리려면 `nvm install 22 && nvm use 22` 동시 적용 필요.
