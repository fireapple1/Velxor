# Worker C — Week 1 진척 보고서 (2026-05-22)

> **작성자**: Worker C
> **세션**: 2026-05-22 (Asia/Seoul)
> **트리**: `/home/lsy/src/Velxor` (HEAD: `main` @ 8f2ed61)
> **상위 문서**: [`STATUS-2026-05-22.md`](./STATUS-2026-05-22.md) — devC 트리 전수 검토 결과
> **준수 규칙**: 본 세션은 (a) 다른 팀원 의존성 없는 작업만 수행, (b) timeline 충돌 없음, (c) git 작업 최소화의 3개 조건 하에 진행.

---

## 0. 한 줄 요약

worker-C-timeline.md **§2.3 (Python DRI 섹션 검토)** + **§2.4 (Week 1 검증 게이트 사전준비)** 매핑 작업 4건을 완료. A·B 의존 작업은 모두 보류 후 명시적 요청 목록으로 정리. git 작업은 단일-파일 unstaged restore 1건만 수행 (강하게 권장 사항).

---

## 1. 완료한 작업 (worker-C-timeline 매핑)

### 1.1 좀비/포트 사전 점검 — (운영 사항)

**timeline 매핑**: §2.5 patch note (`pkill -u $USER -f 'waitress_conf|vite'` 운영 명령 가이드) + STATUS §2.5

**산출**: 진단 결과
```
ss -tlnp grep :(8765|7000|5173) → empty
ps -u $USER waitress_conf|vite  → empty
```

**판정**: 좀비/잔류 0건. AC1 자동 검증을 위한 clean slate 상태.

**git op**: 없음.

---

### 1.2 `ui/package-lock.json` 의도않은 변경 원복 — (운영 사항)

**timeline 매핑**: §2.5 patch (run-all.sh 의 `npm install fallback` 부산물 정리)

**문제**: 직전 `npm install` 실행 시 Node 20.20.2 환경에서 `libc:["glibc"|"musl"]` optional 필드 30 라인이 lockfile 에서 제거된 채 working tree 에 남음. 의도된 변경 아님.

**조치**: `git checkout -- ui/package-lock.json` (단일 파일 restore, destructive 한 unstaged 변경 폐기지만 비-의도 변경 청소라 무해)

**산출**: `git status ui/package-lock.json` → 깨끗 (변경 없음)

**git op**: `git checkout -- <file>` 1건 (사용자 정책 "필수적이거나 강하게 권장되는 사항만" 의 강하게 권장 케이스).

---

### 1.3 `python-engine/requirements.lock` 발행 — §2.4 환경 lock

**timeline 매핑**:
- §1 환경 설정 (Week 0)에서 venv 설정한 결과의 영속 산출물
- §2.4 Week 1 검증 게이트의 "3인 재현성" 조건 c 보장
- ENVIRONMENT.md §3 Python 패키지 핀 표의 실 lock 보조

**산출**: `python-engine/requirements.lock` (18 lines, 모든 의존성 정확한 버전 lock)

```
blinker==1.9.0 / certifi==2026.5.20 / charset-normalizer==3.4.7
click==8.4.0 / Flask==3.0.3 / idna==3.15 / itsdangerous==2.2.0
Jinja2==3.1.6 / joblib==1.5.3 / MarkupSafe==3.0.3
numpy==1.26.4 / requests==2.34.2 / scikit-learn==1.4.2 / scipy==1.17.1
threadpoolctl==3.6.0 / urllib3==2.7.0 / waitress==3.0.2 / Werkzeug==3.1.8
```

**의의**: A·B 가 자기 머신에서 venv 재현 시 `pip install -r requirements.lock` 한 줄로 동일 환경 보장. AC1 walking skeleton "3인 동일 결과" 조건 c 의 직접 보조.

**git op**: 없음 (파일 생성만). 추후 staging·commit 은 사용자 결정.

---

### 1.4 `contracts/c-review-notes.md` 작성 — **§2.3 매핑 본 작업**

**timeline 매핑**: worker-C-timeline.md §2.3 (재분배 후 C가 Python DRI 추가 책임)

> 추가 (재분배 후 C가 Python DRI): /classify REST 섹션(req/resp schema, p99 SLA, model_version 컨벤션)이 본인이 구현할 Flask 코드와 일치하는지 1차 검토 → 누락된 부분은 A에게 직접 추가 요청. (의미 검토 본안은 Week 3.)

**산출**: `contracts/c-review-notes.md` (~250 LoC)

**구조**:
- §0 검토 범위·기준
- §1 응답 4건 (A의 v1.1-review-trigger 양식 준수)
  1. `GET /health` endpoint 누락 — schema 미명시 + app.py 이미 구현 → drift
  2. `POST /classify` request body 상한 미정 — `events.length ≤ 1024, body ≤ 4 MiB` 제안 + 숫자 근거
  3. 빈 `events[]` 처리 정책 — `{verdict:"benign", confidence:0.0}` 표준화 제안
  4. `model_version` stub/rules prefix 컨벤션 부재 — `lr-`, `rules-`, `rules-fallback-`, `stub-` 4-prefix enum 확장
- §2 비-제출 항목 (의도적 보류 — A 자체 노트 중복 + Week 3 미룸)
- §3 mechanical ack 최종 판정 (`compiles-against-engine: OK with 4 additive 요청`)
- §4 변경 이력

**의의**:
- A의 v1.1-review-trigger.md 데드라인 (2026-05-24, 48h) 충족
- worker-C-timeline.md §2.3 의 "Week 1 mechanical ack" 책임 이행 완료
- v1.1 collation (Week 3) 본안 의미 검토와 분리해 mechanical 만 다룸
- 본 세션의 §2.3 책임 검증 evidence 확보

**git op**: 없음 (파일 생성만). 추후 staging·commit 은 사용자 결정.

---

### 1.5 `WEEK1-PROGRESS-C-2026-05-22.md` 작성 (본 문서) — timeline 매핑 보고

**timeline 매핑**: 본 세션 자체의 traceability 산출물 (timeline 외부)

**의의**: 다음 standup·리허설·git blame 시 "C가 2026-05-22 에 무엇을 했나" 가 단일 문서로 추적 가능.

**git op**: 없음.

---

## 2. timeline 충돌 검증

worker-C-timeline.md Week 1 책임 (§2 본문) ↔ 본 세션 산출의 매핑:

| timeline section | 책임 | 본 세션 |
|---|---|---|
| §2.1 `/classify` stub + fallback_rules skeleton | C | ✅ **이전에 완료** (HEAD commit 8f2ed61) — 본 세션 추가 변경 없음 |
| §2.2 영속 백업 도구 (`fallback_rules.py`) | C | ✅ **이전에 완료** — 본 세션 추가 변경 없음 |
| §2.3 Schema v1-draft mechanical ack + Python DRI 검토 | C | ✅ **본 세션 §1.4 (c-review-notes.md 작성)** 으로 이행 |
| §2.4 Week 1 검증 게이트 (`run-all.sh` + `ws-record.sh` + AC1 tag) | C(주관) + A·B | ⏸️ **부분 — `requirements.lock` 사전 준비만 (§1.3)**. AC1 4-레이어 자동 검증 실행은 A의 root 권한 정책 / aggregator wire-up 의존이라 보류 (의존성 없는 만큼만 진행 원칙 준수) |
| §2.5 `scripts/run-all.sh` 5종 self-contained 가드 패치 | C | ✅ **이전 세션 (2026-05-22 18:xx)** 완료 + plan/Velxor 측 doc sync 완료. 본 세션 추가 변경 없음 |
| §2.6 커밋 | C | ⏸️ **보류** — 사용자 정책 "git 작업 최소화" 준수. 다음 사용자 결정 시점에 일괄 커밋 가능 |

**충돌 점검**:
- 본 세션 산출은 모두 **C 단독 영역** (§2.3 + §2.4 부분)에 한정
- A·B 영역(aggregator, App.tsx 등) 침범 없음
- §2.5 patch 의 doc sync 는 이미 plan/Velxor 측에 반영되어 있어 본 세션 재작업 X
- worker-C-timeline.md 본문 자체는 본 세션에서 수정하지 않음 (그대로 보존)

**타임라인 ledger 영향**:
- C 의 Week 1 예상 시간 (~7h) 중 본 세션 ~2.5h 소비:
  - §2.3 c-review-notes.md 작성 = ~1.5h
  - §1.3 requirements.lock 발행 = ~5분
  - §1.1·§1.2·§1.5 운영·문서 작업 = ~1h (STATUS 작성 포함)
- 잔여 Week 1 분량: §2.4 본 검증 (1.5h) + §2.6 커밋 (0.5h) = ~2h
- 전체 ~45h 중 누적 ~8.5h 소비 추정, 잔여 ~36.5h.

---

## 3. 본 세션에서 생성·변경된 파일

| 파일 | 유형 | 산출 | LoC |
|---|---|---|---|
| `STATUS-2026-05-22.md` | 신규 | devC 트리 전수 검토 status snapshot | 599 |
| `contracts/c-review-notes.md` | 신규 | §2.3 Python DRI 검토 응답 (v1.1 review trigger 양식 준수) | ~250 |
| `python-engine/requirements.lock` | 신규 | 18 패키지 핀 lock (Week 0 환경 lock 보조) | 18 |
| `ui/package-lock.json` | 원복 | npm install 부산물 unstaged 변경 폐기 | (working tree restore) |
| `WEEK1-PROGRESS-C-2026-05-22.md` | 신규 | 본 보고서 | ~150 |

**git status 현재**:
```
M  scripts/run-all.sh     (이전 세션 패치, staged + unstaged)
?? STATUS-2026-05-22.md
?? contracts/c-review-notes.md
?? python-engine/requirements.lock
?? WEEK1-PROGRESS-C-2026-05-22.md
?? rust-service/logs/      (cargo run 부산물, .gitignore 대상)
```

---

## 4. 보류된 작업 (의존성 / 사용자 결정 / timeline 후순위)

### 4.1 다른 팀원 의존 — 사용자 정책 "역할 필요하면 작업을 다 끝내고 요청"에 따라 보류

다음 작업은 **C 본인 영역의 사전 준비를 모두 마친 상태**로 보류:

| # | 보류 작업 | 의존성 | C가 다음에 할 것 |
|---|---|---|---|
| α | AC1 자동 검증 1회 (`VELXOR_STUB=collector ./scripts/run-all.sh` + `ws-record.sh` PASS 확인) | A의 root 권한 정책 ADR — 현 `rust-service` 가 fanotify EPERM 으로 즉시 종료. `VELXOR_STUB=collector` 우회는 가능하나 결정 미합의 | A 응답 후 자기 머신에서 1회 실행 + 결과 캡처 |
| β | `walking-skeleton-v1` tag push | A·B 가 자기 머신에서 `run-all.sh` 1회씩 재현 완료 알림 (AC1 조건 c "3인 재현") | 알림 수신 후 `git tag walking-skeleton-v1 && git push --tags` |
| γ | `app.py` model_version `"rule-based-v1"` → `"rules-v1"` rename | A의 v1.1 schema 발행 (2026-05-24 이후) | v1.1 발행 후 자체 PR |
| δ | `/classify` empty events 가드 + size 가드 (`events.length ≤ 1024` 등) | A의 v1.1 schema 발행 | v1.1 발행 후 자체 PR |

### 4.2 사용자 결정 의존 — git 작업 최소화 정책

본 세션 산출 파일들의 staging·commit·push 는 사용자가 직접 결정·실행:

```bash
# 권장 단위 (참고용, 실행은 사용자가 직접)
cd /home/lsy/src/Velxor

# unit 1: STATUS + 진척 보고서
git add STATUS-2026-05-22.md WEEK1-PROGRESS-C-2026-05-22.md
git commit -m "C: week1 status snapshot + progress report 2026-05-22"

# unit 2: Python DRI v1.1 review notes
git add contracts/c-review-notes.md
git commit -m "C: v1.1 schema review notes (4 additive proposals)"

# unit 3: env lock + run-all.sh patch (이전 세션 산출과 합쳐 일괄)
git restore --staged scripts/run-all.sh         # 혼합 상태 정리
git add scripts/run-all.sh python-engine/requirements.lock
git commit -m "C: run-all.sh self-contained guards + requirements.lock"

# (현 main 직접 작업 → devC 흐름 복귀 의향 시)
git push origin HEAD:devC                       # 직접 push if devC 정책 유지
# 또는 새 브랜치로 옮긴 후 PR
```

### 4.3 timeline 후순위 — Week 2-3 이후

- §3 Week 2 사전 작업 (선택, 1h) — feature engineering 사전 스케치
- §4 Week 3 v1.1 schema collation 본안 의미 검토
- §5 ~ Week 6 학습 모델 초기 시도
- §7.5 `docs/ARCHITECTURE.md` 작성 (Week 7)
- §10 평가 + 데모

본 세션은 이들을 건드리지 않음 (timeline 충돌 0건).

---

## 5. A·B에게 보낼 요청 (작업 완료 후 일괄)

본 세션의 본인 영역 작업이 모두 마무리되었으므로, 의존성 있는 후속 진행을 위해 다음 3건을 A·B 에 송부 예정:

### 5.1 → Worker A (Rust DRI)

```
[Subject] root 권한 정책 ADR + aggregator wire-up + run-all.sh 재현 1회

1. root 권한 정책 ADR 요청:
   - 현재 rust-service 가 root 없이 실행 시 fanotify_init EPERM 으로 즉시
     종료 (logs/trace.json:3 evidence). collector_source.rs:13 이 비-stub
     모드에서 fanotify_adapter::run_fanotify 를 호출하기 때문.
   - 옵션 A: sudo setcap cap_sys_admin+ep target/release/rust-service (1회만)
     옵션 B: sudo ./target/release/rust-service (매번)
     옵션 C: Week 4까지 VELXOR_STUB=collector 영속 (real 분기 비활성)
   - C 의견: AC1 통과 위해 옵션 C로 walking-skeleton-v1 발행 후, Week 4
     시작 시 옵션 A로 전환. consensus-plan ADR 추가 후보.
   - 결정 회신 부탁 — Week 1 마감 직접 영향.

2. aggregator.rs 본 구현 요청:
   - 현재 `pub fn placeholder() {}` 빈 상태 (3 LoC).
   - 최소 sliding window + classifier_client.classify() 한 줄 wire-up 필요.
   - main.rs 에서 classifier_client 가 import 되지 않아 #[allow(dead_code)]
     로 임시 무력화된 상태도 함께 해소.
   - C의 후속 AC4 (p99<100ms) 측정 인프라 셋업이 본 작업 완료에 의존.

3. AC1 3인 재현 1회 요청:
   - 본인 환경(htA/Velxor 트리) 에서 ./scripts/run-all.sh 1회 + ws-record.sh
     캡처 확인 후 알림 부탁. AC1 조건 c (3인 재현) 의 A 측 충족용.
   - 사전 조건: 위 1번 옵션 C 채택 시 VELXOR_STUB=collector 로 실행.

산출:
  contracts/c-review-notes.md  ← v1.1 review 응답 4건 제출 완료
  python-engine/requirements.lock  ← 환경 lock 발행
  scripts/run-all.sh  ← 5종 self-contained 가드 패치 완료 (이전 세션)
```

### 5.2 → Worker B (UI DRI)

```
[Subject] App.tsx 본 구현 시작 + Node 22 전환 결정 + AC1 재현 1회

1. App.tsx 본 구현 즉시 시작 요청:
   - 현재 src/ui/App.tsx 가 Vite 기본 boilerplate 상태 (count 버튼 + 로고).
   - Week 1 critical risk — 본 세션 STATUS §4.3 에서 B 32h 중 ~2h 만 소비로
     underload 재발 신호로 가시화.
   - 최소 빈 ProcessTree placeholder + ws/client.ts 첫 줄
     (new WebSocket("ws://127.0.0.1:7000?last_seq=0")) 부터 시작 부탁.

2. Node 22.12+ 전환 결정 요청:
   - 현재 Node 20.20.2 / Electron 42 가 ≥22.12 요구 (EBADENGINE 경고).
   - ENVIRONMENT.md Node 20 pin 갱신 / Electron 31 다운그레이드 / Week 9
     deferral 중 택일.

3. AC1 3인 재현 1회 요청:
   - 본인 환경에서 ./scripts/run-all.sh 1회 (UI :5173 부팅까지만 보면 됨)
     + 알림 부탁. AC1 조건 c 의 B 측 충족용.

산출 (C 측):
  contracts/c-review-notes.md  ← UI consumer 측 §3/§4 review 와 분리되었으나
                                  Week 3 v1.1 collation 시 통합 처리됨
```

### 5.3 송신 채널

worker-C-timeline.md §2.3 본문 "누락된 부분은 A에게 직접 추가 요청" 명시 → Slack / GitHub PR comment / 메일 중 채택 (본 보고서는 evidence 영속용으로 contracts/ 디렉토리에 영속화됨).

---

## 6. Risk & Open Question

### 6.1 본 세션 발생 risk

- **현 작업 branch = `main`** (정책 위반): role-assignment.md 의 "PRs from devA/devB/devC → main only" 위배. 본 세션은 사용자 정책 "git 작업 최소화" 준수해 branch 이동·재배치 미수행. 추후 사용자가 일괄 commit 단계에서 devC 흐름 복귀 결정 가능.
- **`ui/package-lock.json` 원복** 후 재-`npm install` 시 동일 변경 재발 가능: Node 20.20.2 가 lockfile 작성 환경과 다른 한, 같은 30 라인 strip 이 반복됨. 근본 해소는 §5.2 B-2 (Node 22+ 전환) 결정 후 lockfile 재생성.

### 6.2 본 세션에서 발견·해소 못한 open question

| Q | 누구가 답 | 영향 |
|---|---|---|
| `collector_source.rs:13` 의 비-stub 분기를 Week 4까지 동결할 것인가, 아니면 setcap 으로 즉시 통과시킬 것인가 | A | AC1 통과 시점 |
| `worker-C-timeline.md` 본문이 devC 트리 사본 vs plan/Velxor 사본 간 동기화 상태인가 | 사용자 / C | Week 3 collation 영향 (현재 본 세션은 devC 사본 미수정) |
| `STATUS-2026-05-22.md` 와 본 보고서를 외부 (스폰서·교수님) 에 공유할 계획인가 | 사용자 | 추후 작성 톤 결정 |

---

## 7. 변경 이력

| 버전 | 일시 | 변경 | 발행자 |
|---|---|---|---|
| v1 | 2026-05-22 | 최초 작성. §1 완료 작업 5건 + §2 timeline 충돌 검증 + §3 산출 파일 5종 + §4 보류 작업 + §5 A·B 요청 초안 | C |

---

> **다음 보고서 작성 권장 시점**: `walking-skeleton-v1` tag push 직후 (Week 1 마감) — `WEEK1-CLOSE-C-<날짜>.md` 작명 후보.
