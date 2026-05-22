# Velxor 시연 스크립트 (DEMO-SCRIPT)

> Worker-A 가 Worker-B 의 UI 풀스택을 인수받은 직후 작성한 발표용 시연 절차서.
> 대상: 30초 ~ 90초 라이브 데모. Ubuntu 24.04, Electron UI, sudo cargo 또는 `VELXOR_STUB=both` 환경.

---

## 0. 사전 준비

### 0.1 종속성 점검

```bash
# Rust
cargo --version              # 1.78+
# Python
python3 --version            # 3.12+
test -f python-engine/.venv/bin/activate || python3 -m venv python-engine/.venv
# UI
node --version               # 20+
( cd ui && npm install )
```

### 0.2 작업 디렉토리

- 임시 산출물(events.jsonl, WS 캡처 등)은 **반드시** `~/velxor-work/` 에 둔다 (`/tmp` 금지 — CLAUDE.md 절대 규칙).
- 노드 데이터셋 `datasets/heldout/v3/` 는 학습에 절대 노출 금지.

```bash
mkdir -p ~/velxor-work
```

### 0.3 3-tier 기동 순서 (권장)

발표 5분 전, 별도 터미널 3개를 띄워둔다.

#### Terminal 1 — Python 분류 엔진 (포트 7002 기본)

```bash
cd /home/lsy/htA/Velxor
source python-engine/.venv/bin/activate
python python-engine/waitress_conf.py
# → [waitress] Serving on http://0.0.0.0:7002, threads=4
```

stub 모드로 화면만 확인하려면:

```bash
VELXOR_STUB=engine python python-engine/waitress_conf.py
# → /classify 가 무조건 verdict=ransomware confidence=0.95 반환
```

#### Terminal 2 — Rust 수집기/통합 서비스 (WS:7000, REST:7001)

```bash
cd /home/lsy/htA/Velxor
# 실제 fanotify 캡처 (root 필요)
sudo -E cargo run

# 또는 collector stub (events.jsonl 폴링)
VELXOR_STUB=collector cargo run

# UI 시연만 빠르게 — collector + engine 둘 다 stub
VELXOR_STUB=both cargo run
```

기동 직후 로그 확인:

```
tracing: ws_broadcaster listening on 127.0.0.1:7000
tracing: rest server listening on 127.0.0.1:7001
tracing: aggregator window=1s threshold=FileWrite:50 FileRename:30
```

#### Terminal 3 — UI (Electron + Vite dev)

```bash
cd /home/lsy/htA/Velxor/ui
npm run dev
# Vite 5xxx → Electron 자동 launch
```

또는 빌드된 정적 페이지를 브라우저로:

```bash
cd /home/lsy/htA/Velxor/ui && npm run build && npm run preview
# http://localhost:4173
```

---

## 1. 시연 시나리오 (30 ~ 60초)

### 시작 상태

- UI 화면: 좌측 ProcessTree 빈 캔버스 (검정 `#0a0a0c` + 미세한 청록 도트 그리드).
- 우상단: connection 도트 녹색(`#00ff66`) — `connected`. 알람 strip 비어있음.
- 하단 60px: Timeline x-축만 표시.
- 우측 DetailPanel: 선택된 노드 없으므로 표시 안 됨 (Worker-A 변경 사항: 노드 없을 때 패널 숨김).

### T+0s — 사용자 액션: 가짜 ransomware burst 주입

stub collector 모드에서:

```bash
# 다른 터미널에서
cd /home/lsy/htA/Velxor
bash scripts/inject-burst.sh 60   # events.jsonl 에 60건 FileWrite/Rename 추가
# (스크립트 없으면 manual)
for i in $(seq 1 60); do
  printf '{"schema_version":"1.0","seq":%d,"dropped_since_last":0,"pid":4242,"parent_pid":1,"image_path":"/usr/bin/fake-ransom","event_type":"FileWrite","file_path":"/home/lsy/velxor-work/victim-%d.docx","ts_unix_ms":%d}\n' \
    "$i" "$i" "$(date +%s%3N)"
done >> ~/velxor-work/events.jsonl
```

### T+0.1s — UI 반응 (시각)

- ProcessTree 에 **pid 4242** 박스 1개 등장. 박스 스타일:
  - 배경 `#2a2a2a`, 테두리 청록색 `#00ffcc` 2px, 폰트 monospace `#00ffcc`.
  - `pid 4242` + `fake-ransom` (image_path basename) 2줄 표시.
- Timeline 에 회색 `#666666` r=3 dot 60개가 우측 끝으로 흘러 들어감.
- DetailPanel 여전히 숨김 (사용자가 노드 클릭 전).

### T+1.0s — Rust aggregator burst 감지 → Python /classify 호출

Terminal 2 로그:

```
aggregator: burst detected pid=4242 file_write=60 file_rename=0 window=1s
classifier_client: POST http://127.0.0.1:7002/classify -> verdict=ransomware conf=0.95
ws_broadcaster: verdict { pid: 4242, verdict: "ransomware", confidence: 0.95 }
```

### T+1.1s — UI 반응 (시각)

- 노드 pid 4242 스타일이 **즉시** 변경:
  - 배경 `#1a0505`, 테두리 `#ff3333` 2px, 폰트 `#ff3333`.
  - `@keyframes pulse 0.8s infinite` 박동 (rgba(255,51,51,0.7) 그림자 → 24px 12px 산란 → 0).
- Timeline 에 **붉은 dot** r=5 + `drop-shadow(0 0 4px #ff3333)` 1개 추가.
- 사용자가 pid 4242 박스를 **클릭** 하면:
  - 우측에서 DetailPanel 슬라이드인 (`slide-in 0.3s ease-out`).
  - 내용:
    - `PROCESS PID 4242` (18px 청록)
    - `IMAGE /usr/bin/fake-ransom`
    - `PARENT PID 1`
    - `EVENT TYPE FileWrite`
    - `STATE threat` (붉은색)
    - `VERDICT ransomware` (붉은색)
    - `CONFIDENCE 0.95` (24px 두께 700, 붉은색)
    - `EVIDENCE` 목록 — `#ff5555` 텍스트
    - `BLOCK pid 4242` 큰 붉은 버튼 + 청록 `ALLOW` 버튼

### T+2.0s — 사용자 액션: BLOCK 버튼 클릭

- 버튼이 즉시 `disabled`, 라벨 `차단 중...`, 배경 `#660000`.
- UI 가 `POST http://127.0.0.1:7001/block/4242` 호출.
- Rust 측에서 `kill(4242, SIGTERM)` → 200ms 대기 → `SIGKILL` fallback.
- 응답 JSON: `{"outcome":"killed"}` (가짜 프로세스가 실제로 없으면 `not_found` — stub 시연 시 outcome 가짜 주입 가능).

### T+2.2s — UI 반응 (시각)

- 응답 outcome 이 `killed`/`terminated`/`already_dead` 중 하나면:
  - 노드 pid 4242 스타일 전환 (transition 0.3s):
    - 배경 `#444`, 테두리 `#666`, 폰트 `#999`.
    - `animation: none` — pulse 즉시 정지 (**dead state**).
  - DetailPanel `STATE` 값이 `killed` 로 회색 표시.
  - BLOCK / ALLOW 버튼 모두 disabled (opacity 0.5).
- 알람 strip 에 `[info] block(4242) -> killed` 추가 (최근 5개 슬라이딩).

### T+2.5s — 종료 비트

- 발표자 멘트: "1초 내 분류, 다시 1초 내 차단. fanotify → Rust 집계 → Flask 분류 → kill 까지 약 1.2초."
- Timeline 의 붉은 dot 가 30초 윈도우 안에서 좌측으로 흘러가는 모습으로 마무리.

---

## 2. 백업 시나리오

### 2.1 Python 엔진 죽었을 때

증상: Rust 가 `/classify` 호출 → ConnectionRefused. UI 에는 `alert` 메시지가 `[error] classifier unreachable` 형태로 들어옴 (Worker-A 가 헤더 alert strip 으로 표시).

대처:

```bash
# Terminal 1 재기동
source python-engine/.venv/bin/activate
python python-engine/waitress_conf.py
```

Rust 의 classifier_client 는 지수백오프로 재시도하므로, 엔진 부활 후 다음 burst 부터 정상.

### 2.2 Rust 서비스 죽었을 때

증상: UI 헤더 connection 도트가 노란색(`#ffcc00` connecting) → 빨강(`#ff3333` disconnected) 로 전환. ProcessTree 는 마지막 상태 유지.

대처:

```bash
# Terminal 2 재기동 — UI 는 last_seq 를 보내며 자동 재연결
sudo -E cargo run
```

- WS 재연결 backoff: 250ms → 500 → 1s → 2s → 5s (cap).
- 5초 replay 윈도우 안이면 이어 받음. 밖이면 `gap` 메시지 → UI 가 자동 전체 리셋 + 헤더 `[warn] full refresh: gap from X to Y` 알람.

### 2.3 collector stub events.jsonl 손상

증상: JSON parse 에러 로그. burst 감지 정지.

대처:

```bash
# 손상된 라인 위치 찾기
python3 -c "import json,sys
for i,l in enumerate(open('/home/lsy/velxor-work/events.jsonl'),1):
  try: json.loads(l)
  except Exception as e: print(i, e); break"
# 해당 라인 삭제 후 재기동
```

JSONL 규칙: 1줄 = JSON 객체 1개. 줄바꿈 문자 (\n) 외 추가 개행 금지.

### 2.4 sudo 없이 fanotify 시연 강행 시

`Permission denied (os error 13)`. 데모에서는 절대 `sudo` 비밀번호 입력 라이브 시연 금지 — 반드시 `VELXOR_STUB=both` 로 폴백.

---

## 3. 자주 묻는 질문 (FAQ)

### Q1. 왜 ELK/Graylog/Wazuh 같은 SIEM 통합이 없나?

A. 데모급(demo-grade) 범위. 30초 시연이 목적이며, 영속 저장/검색 기능은 §5 deferral 큐. 현재 출력은 WS broadcast + JSONL 로컬 로그 뿐.

### Q2. 왜 "데모급" 인가? 운영에 못 쓰나?

A. 다음 3가지가 미흡:
1. fanotify 는 컨테이너 네임스페이스/오버레이FS 에 한계 (FAN_REPORT_FID 가 namespace mount 에선 EINVAL).
2. 분류기는 룰 기반 + 사전 학습 모델 (datasets/heldout/v3 hold-out, 실 환경 분포 미반영).
3. block 은 SIGTERM/SIGKILL 만 — cgroup freeze / namespace isolation / 파일 quarantine 없음.

### Q3. 어떤 ransomware family 를 못 잡나?

A.
- **Slow & low**: 1초당 50건 미만 (burst threshold 미만) → aggregator 가 burst 로 안 봄. § plan.md week6 에서 sliding 5초 윈도우 고려.
- **In-place encrypt**: file_path 변경 없이 동일 파일 read→encrypt→write → FileRename event 0 + FileWrite N. write 50 임계는 잡지만 entropy 분석은 op_detail.entropy_hint 가 있을 때만.
- **Living-off-the-land** (powershell.exe 직접 호출 같은 LOLbins): image_path 가 합법 바이너리. 분류기가 image_path whitelist 에 걸려서 benign 으로 분류. C 의 향후 모델 갱신 필요.

### Q4. UI 가 Electron 인 이유?

A. 발표 자리에서 데스크탑 윈도우로 띄우는 게 임팩트가 큼. 코드는 그대로 브라우저(Chrome 113+) 에서도 동작. 만약 GPU acceleration 없는 환경(Wayland nested, 가상머신) 이면 pulse 애니메이션이 끊길 수 있음 — §5 알려진 한계 참고.

### Q5. 왜 Python 엔진은 Flask + Waitress 인가?

A. 30초 시연에서 동시 요청 4건 이내. Waitress threads=4 면 충분. uvicorn/fastapi 는 비동기 일관성을 줄 수 있지만 도입 비용 대비 효용 낮음.

---

## 4. 시연 전 1분 자가점검 체크리스트

발표 시작 직전 순서대로 확인.

- [ ] Terminal 1 Python 엔진 기동 — `curl -s http://127.0.0.1:7002/healthz` → `ok`
- [ ] Terminal 2 Rust 서비스 기동 — `ss -tnlp | grep -E '7000|7001'` 두 줄 보임
- [ ] Terminal 3 UI 기동 — Electron 윈도우 떠 있음 + 헤더 connection 도트 녹색
- [ ] ProcessTree 캔버스 비어있음 (gap reset 또는 신규 세션)
- [ ] Timeline 빈 축만 표시
- [ ] DetailPanel 숨김 (선택된 노드 없음)
- [ ] `~/velxor-work/` 경로 존재 & 쓰기 가능
- [ ] inject-burst 스크립트 또는 manual loop 클립보드 준비
- [ ] 발표 자료 옆 모니터에 본 문서 §1 시나리오 표시
- [ ] 노트북 잠금/슬립 비활성 (시연 중 화면 꺼짐 방지)
- [ ] 백업 슬라이드(스크린샷)도 준비 — 모든 게 실패해도 발표 가능하도록

---

## 5. 알려진 한계 (Limitations)

1. **pulse 0.8s 애니메이션 GPU 의존**: Electron 41 + Linux Wayland nested 환경에서 `box-shadow` blur 가 software fallback 으로 떨어지면 framerate < 20fps. 백업으로 Background 색만 strobe 하는 폴백 CSS 준비 권장 (`@media (prefers-reduced-motion: reduce)` 분기).
2. **WS replay 5초 윈도우 한계**: rust-service 가 5초 넘게 죽으면 UI 가 `gap` 으로 인식 후 전체 리셋. 시연 중 의도치 않은 리셋 가능 — 발표 전 반드시 안정성 확인.
3. **xyflow 12 노드 100개 이상**: dagre layout 이 한꺼번에 다시 계산되므로 burst 1000건 같은 시나리오에서는 layout 깜빡임. 데모급에선 burst 60건만 사용.
4. **연결 상태 신뢰성**: connection 도트는 ws.onopen/onclose 기반. WS 가 half-open 상태(TCP 살아있지만 메시지 정체) 면 false-positive 녹색 표시 가능. heartbeat 미구현 — week6 deferred.
5. **block outcome 가짜 PID 처리**: stub 모드에서 가짜 pid 4242 에 대해 `kill(4242,..)` 호출하면 `not_found` 반환. 시연용으로는 발표자가 `block-stub` 환경변수로 outcome=killed 강제 가능 (별도 PR 필요).

---

## 6. 다음 단계

- 시연 후 즉시 `docs/DEMO-runbook-YYYY-MM-DD.md` 에 실제 진행 결과(타임라인, 이슈, Q&A 발언) 기록.
- 백엔드 변경 시 본 문서 §1 시나리오의 색상/타이밍/응답 형식 부분과 `contracts/interface-schema.md` 를 **동시에** 갱신 (A 가 DRI).
- B 역할 인수에 따른 UI 회귀: 시연 끝나면 `oh-my-claudecode:code-reviewer` 로 ws/client.ts, App.tsx 의 race condition 재점검.

---

(작성: Worker-A, 인수일: 2026-05-23, 컨텍스트: B → A UI 풀스택 이관)
