# Worker B (UI Electron) — A로 인계해야 할 산출물

> **발신**: Worker A (Rust DRI)
> **수신**: Worker B (UI Electron — React + TypeScript)
> **발행일**: 2026-05-22
> **목적**: A가 Week 4-5까지 발행한 인터페이스(WS `:7000`, Block API `:7001`)에 대해 B가 작성·인계해야 할 산출물 전부 정리. 각 항목에 마감·형식·검증 기준 명시.

---

## 🚨 0. 즉시 회신 — v1.1 schema collation (마감 **2026-05-24**, 발행 +2일)

A가 `contracts/v1.1-review-trigger.md` 에 발행한 review 요청. **무응답 시 48h 룰로 A 단독 발행** (Principle 4) → B 의견 반영 불가.

### B 영역 회신 범위
**WsMessage / Reconnect 프로토콜** (`contracts/interface-schema.md` §3, §4) — UI 디코드·렌더링 시 부족하다고 느낀 필드.

### 제출 양식 (Slack reply 또는 `contracts/interface-schema.md` PR comment)
```
- 필드명:
- 이유 (현재 schema에서 누락이거나 잘못된 이유):
- additive 제안 (새 optional 필드 형태로 추가, 기존 필드 type 변경 금지):
```

**최소 1개**. B가 v1-draft를 읽으며 "이게 있었으면 좋았겠다" 싶었던 것 무엇이든.

---

## 1. Week 4 — WS 클라이언트 구현 (마감 Week 4)

A의 서버(`ws://127.0.0.1:7000?last_seq=N`)는 §4.4에서 finalize 완료. B 측 클라이언트 구현 필요.

### 1.1 WsMessage 타입 정의 (TypeScript)

`handoff-week4-5.md` §3 의 hint 그대로 사용 가능:
```ts
type WsMessage =
  | { schema_version: "1.0"; seq: number; type: "node_add"; payload: BehaviorEventV1 }
  | { schema_version: "1.0"; seq: number; type: "verdict"; payload: ClassifyResponse }
  | { schema_version: "1.0"; seq: 0; type: "gap"; payload: { from: number; to: number } };
```

`BehaviorEventV1` / `ClassifyResponse` 정의는 `contracts/interface-schema.md` §1.1 / §2.2.

### 1.2 재접속 로직

| 동작 | 명세 |
|---|---|
| 초기 연결 | `ws://127.0.0.1:7000?last_seq=0` |
| 끊김 후 재접속 | 마지막으로 받은 `seq=N` 으로 `?last_seq=N` 쿼리 |
| 중복 수신 | 동일 `seq` 무시 (서버가 backlog→live 전환 시 race 가능) |
| 전역 monotonic | `node_add` + `verdict` 동일 seq 공간 — 타입 무관하게 dedupe |

### 1.3 `gap` 메시지 처리 (★중요)

```ts
if (msg.type === "gap") {
  // UI full refresh — graph state reset
  resetGraphState();
  // payload.from / payload.to 는 누락된 seq 범위 (informative)
}
```

`gap` 의미: 5초 sliding replay buffer가 evict하기 전에 클라이언트가 재접속 못 함 → 일부 메시지 영구 손실. 부분 복구 시도 금지, **반드시 UI 전체 reset**.

### 1.4 검증 기준 (B 자가확인)

- [ ] 정상 메시지 수신·렌더링
- [ ] WS 끊고 5초 안에 `?last_seq=N` 재접속 → 누락 없음 + 중복 없음
- [ ] WS 끊고 7초 후 재접속 → `gap` 메시지 수신 → 전체 reset
- [ ] `seq=0` 메시지(`gap`)는 dedupe에서 제외

---

## 2. Week 5 — Block 버튼 통합 (마감 Week 5)

A의 §4.5 `POST http://127.0.0.1:7001/block/{pid}` endpoint 완료 (loopback only). UI에서 호출 + outcome 표시 필요.

### 2.1 호출

```ts
const res = await fetch(`http://127.0.0.1:7001/block/${pid}`, { method: "POST" });
const { pid: returnedPid, outcome } = await res.json();
```

(주의: `VELXOR_BLOCK_TOKEN` 환경변수가 설정되어 있으면 `X-Velxor-Token: <token>` 헤더 필요. 데모는 unset 가정.)

### 2.2 6가지 outcome 모두 UI 표시 (`handoff-week4-5.md` §4)

| outcome | 의미 | UI 표시 권장 |
|---|---|---|
| `killed` | SIGKILL 강제 종료 (SIGTERM 200ms 후 살아있어서 escalate) | 빨강 + "강제 종료" |
| `terminated` | SIGTERM 만으로 종료 (graceful) | 주황 + "종료" |
| `already_gone` | kill 시점에 이미 종료됨 (race) | 회색 + "이미 종료됨" |
| `eperm` | 권한 부족 (서비스가 root/CAP_KILL 부재) | 빨강 + "권한 부족" (사용자에게 명확히) |
| `invalid` | `pid ≤ 1` (init / 프로세스 그룹 broadcast 방어) | 빨강 + "잘못된 PID" |
| `error` | 기타 kill 실패 | 빨강 + "차단 실패" |

### 2.3 검증 기준
- [ ] 임의 pid (e.g., `sleep 9999` 실행 후 그 PID) → `killed` 또는 `terminated` 응답 받음
- [ ] pid=1 (init) → `invalid` 표시
- [ ] 이미 죽은 PID → `already_gone` 표시

---

## 3. AC3 — 1초 내 빨간 노드 렌더링 (Week 2~3, 이미 진행 중)

| 항목 | 명세 |
|---|---|
| 검증 스크립트 | `scripts/ac3-verify-render.sh` (B 작성) |
| 증거 자료 | `docs/AC3-evidence/` 폴더 (OBS 영상 + `frame-1000ms.png`) |
| 마감 | Week 10 (데모 전) |
| 출처 | `.claude/commands/ac.md` AC3 |

---

## 4. Week 9 리허설 자가확인 (마감 Week 9 시작 전)

`handoff-week4-5.md` §9 — B 항목 PASS/FAIL 결과를 A에게 회신.

- [ ] WS 5초 끊김 후 `?last_seq=N` 재접속 → backlog 정합성 확인
- [ ] `gap` 수신 → UI full refresh 동작 확인
- [ ] Block 버튼 → 위 §2.2 6가지 outcome 모두 화면 표시 가능 (테스트 PID 시나리오 준비)

**회신 형식**: 각 항목 PASS / FAIL + 캡처 또는 영상 링크.

---

## 5. Week 10 — 데모용 산출물 (마감 Week 10)

| 파일 | 내용 | 출처 |
|---|---|---|
| `docs/electron-ws-footgun.md` | WS protocol 함정 정리 (dedupe, replay, gap) — B가 구현하며 깨달은 점 | `.claude/commands/roles.md` |
| `docs/AC3-evidence/` | OBS 영상 + `frame-1000ms.png` (1초 내 렌더링 증거) | AC3 |
| `docs/DEMO-SCRIPT.md` (UI 시연 부분) | 시연 시나리오 — 어떤 burst를 일으키고 UI에서 무엇이 보이는지 step-by-step | `.claude/commands/roles.md` |

---

## 6. 인터페이스 spec 참조 (변경 없음, 읽기 전용)

| 문서 | 내용 |
|---|---|
| `contracts/interface-schema.md` | v1.0 schema (필드 정의, evolution rule) |
| `contracts/handoff-week4-5.md` | A → B/C 인계 (포트 매트릭스, ENV, 기동 시퀀스) |
| `contracts/v1.1-review-trigger.md` | 회신 양식 + A 자체 4 노트 (참고용) |

A의 인터페이스는 §4.7 sweep PASS 후 머지됨 (commit `05bf6c2`까지). B 입장에서는 `:7000` WS / `:7001` Block API가 안정. 추가 schema 변경은 v1.1 collation 후 통보.

---

## 7. 응답 채널

- v1.1 회신: **2026-05-24 마감** (위 §0)
- 일반 질문 / 인터페이스 변경 제안: `contracts/handoff-week4-5.md` PR comment 또는 직접 메시지
- 긴급 차단 사유 (Block API 변경 등): 즉시 Slack

A는 Week 8-9 §5 (AC4 tracing + 리허설) 진입 예정. B와의 통합은 Week 9 리허설 시점 또는 그 전 시점에 합의.

— Worker A (2026-05-22)
