# Velxor 행위 기반 백신 — Consensus Plan (Draft v1)

## Metadata
- **Plan ID**: velxor-consensus-plan-v1
- **Source Spec**: `/home/lsy/ht/.omc/specs/deep-interview-velxor-behavior-vaccine.md`
- **Mode**: `--consensus --direct` (RALPLAN-DR short)
- **Generated**: 2026-05-20
- **Status**: DRAFT — pending Architect/Critic review
- **Iteration**: 1 / 5

## Requirements Summary (from spec)
- Windows 커널 레벨 **랜섬웨어 행위 탐지** 데모급 백신 (학교/공모전 발표용)
- 4계층: C+WDK 커널 드라이버 / Rust 유저모드 서비스 / Python+AI 분석 엔진 / React+Electron UI
- **합성 PoC**만 사용 (학습/시연 모두 자체생성)
- 한 학기 (~80-120시간), 본인=Rust+UI+인터페이스 스키마, 팀원1=드라이버, 팀원2=Python+AI
- **통합 전략 = Walking Skeleton**: Week 1에 본인이 IOCTL/REST/WS 스키마 잠금 + 4계층 stub end-to-end

## RALPLAN-DR Summary (short mode)

### Principles (5)
1. **데모 임팩트가 1차 척도**. 코드 우아함·정확도는 보조 지표.
2. **통합 리스크 0** — Week 1에 인터페이스 스키마를 잠그고 stub로 walking skeleton 확보.
3. **안전·재현성 우선** — 실제 ransomware 회피, 합성 PoC로 학습·시연 모두 해결.
4. **팀원 의존성 격리** — 본인 진도가 팀원 진도에 종속되지 않도록 stub fallback 영속화.
5. **시간 제약 존중** — 80-120시간 내 demo-quality. 프로덕션 quality 추구 X.

### Decision Drivers (top 3)
1. **시간 제약**: 한 학기 (2-3개월), 주당 ~10시간 → 총 80-120시간
2. **통합 위험**: 4계층 / 3개 언어 (C, Rust, Python, TS) / kernel-userspace 경계 / 2명 팀원
3. **시연 임팩트**: 관중 30초~1분에 "행위 기반 탐지" wow 모먼트

### Viable Options

**Option A: Walking Skeleton (CHOSEN)**
- Approach: Week 1에 본인이 IOCTL/REST/WS 스키마 명세 + 4계층 stub end-to-end → Week 2부터 각자 stub을 실제 구현으로 교체.
- Pros: 통합 리스크 0, 명세 조기 잠금, stub fallback 자동 확보, Week 1 이후 매 주 시연 가능, 팀원 지연 흡수 가능.
- Cons: Week 1 본인 부하 (스키마 + 4계층 stub) 약 15시간 → 주당 평균 초과 가능; 팀원이 stub을 무의미하게 느낄 risk (완화: 스키마 리뷰 미팅).

**Option B: Module-First (기획서 원안)**
- Approach: 각자 모듈을 4-5주 동안 독립 완성 → Week 5-6에 IOCTL/REST/WS 통합.
- Pros: 익숙한 패턴, Week 1 부하 분산.
- Cons: 마지막 통합 구간에서 스키마 충돌·재작업 폭풍 위험 (발표 1-2주 전), 팀원 지연이 본인 진도 직접 차단, 매주 시연 불가.
- **Invalidation**: Week 5-6 통합 폭풍이 발표 1-2주 전이라 리스크 감당 불가. Deep-interview Round 6 Simplifier 결과로 기각.

**Option C: 본인 단독 4계층 stub + 팀 비-의존**
- Approach: 본인이 ETW 대체(드라이버) + 룰 기반 분류기(Python) + UI 모두 빌드, 팀원은 옵션.
- Pros: 팀 의존성 0.
- Cons: 총 작업량 200+시간 추정 → 80-120시간 예산 위반; '팀 프로젝트' 정체성 파괴.
- **Invalidation**: 시간 예산 ≥2배 위반.

## Acceptance Criteria (from spec, restated for verification)
- **AC1 (Week 1)**: 본인이 설계한 스키마로 IOCTL → Rust → REST → WS → UI까지 fake event 1개가 end-to-end 흐름
- **AC2**: PoC 스크립트가 1초에 .docx → .docx.enc 300개 rename + 임의 바이트 쓰기 (재현 가능)
- **AC3**: PoC 실행 → UI 프로세스 트리 빨간 노드 + 우측 패널 "Process X 파일 N개 쓰기 중! AI: ransomware X%"
- **AC4**: PoC 시작 → UI 빨간 알림까지 ≤1초
- **AC5**: PoC positive N=10 중 ≥9 ransomware 분류, normal negative N=10 중 false positive ≤1
- **AC6**: 차단(자동/Block 버튼)으로 PoC 프로세스 종료
- **AC7**: 30초~1분 시연 영상 + 발표 슬라이드에 "프로세스 트리 폭발" 시나리오
- **AC8 (Fallback)**: 팀원 드라이버/Python 미완성 시 stub 모드로 데모 가능

## Implementation Steps

### Week 1 — Walking Skeleton (본인 ~15시간, 1회성 부하)
- **1.1 인터페이스 계약 명세** → `Velxor/contracts/interface-schema.md`
  - **IOCTL payload (v1)**: `BehaviorEventV1 { schema_version: "1", pid: u32, parent_pid: u32, image_path: string, event_type: enum(FileWrite|FileRename|ProcessCreate), file_path: string?, op_detail: object?, ts_unix_ms: u64 }`
  - **REST POST /classify**: req `{ events: BehaviorEventV1[], window_ms: u32 }` → resp `{ verdict: enum(benign|ransomware), confidence: f32, evidence: string[] }`
  - **WS message**: `{ type: enum(node_add|node_update|verdict|alert), payload: object }`
  - Semver 정책 명시; v1 freeze, v2는 변경 시 별도 협의
- **1.2 Rust 서비스 stub** → `Velxor/rust-service/`
  - `cargo init --bin`; deps: `tokio`, `tokio-tungstenite`, `reqwest`, `serde`, `serde_json`, `tracing`
  - Driver event source: 로컬 JSON 파일 `events.jsonl` 폴링 (driver stub)
  - REST client → `http://127.0.0.1:5000/classify`
  - WS server → `ws://127.0.0.1:9000/stream`
- **1.3 Python 엔진 stub** → `Velxor/python-engine/`
  - `venv` + `Flask`; `app.py`에 `POST /classify` 핸들러
  - 하드코드 응답: `{ verdict: "ransomware", confidence: 0.95, evidence: ["stub"] }`
- **1.4 UI stub** → `Velxor/ui/`
  - `npm create vite@latest -- --template react-ts`; add `electron`, `@xyflow/react` (React Flow)
  - WS client → `ws://127.0.0.1:9000/stream`
  - 단일 노드 표시 + 빨간 깜빡임 + 우측 detail panel placeholder
- **1.5 End-to-end smoke**: `Velxor/scripts/run-all.sh`로 3개 프로세스 기동, `events.jsonl`에 1개 이벤트 추가 → UI에 노드 등장 확인. README 갱신.

### Week 2-3 — UI 깊이 (본인 ~20시간)
- 2.1 ProcessTree 컴포넌트 (`@xyflow/react`) — 부모-자식 관계, 자동 레이아웃 (dagre)
- 2.2 Threat Timeline 컴포넌트 — burst 이벤트 시각화 (D3 또는 visx)
- 2.3 Detail Panel — 선택 노드의 PID, image, AI verdict, evidence
- 2.4 Block/Allow 버튼 + 사운드 효과 hook (Web Audio API)
- 2.5 WebSocket reconnect + 이벤트 큐 + 시퀀스 보존 (exponential backoff)

### Week 4-5 — 실데이터 흐름 (본인 ~20시간 + 팀 병렬)
- 4.1 Rust: tokio task로 PID별 sliding window (1초/5초) 이벤트 집계
- 4.2 Rust: burst detection (FileWrite ≥50 in 1s OR FileRename ≥30 in 1s) → trigger /classify
- 4.3 Rust: verdict caching per PID, dedupe 알림
- 4.4 Rust: WS broadcast (tokio broadcast channel) + replay buffer (마지막 100 events)
- 4.5 **팀원1 의존**: 실제 IOCTL 송신 driver → 본인 Rust 입력 어댑터 교체 (스키마 동일)
- 4.6 **팀원2 의존**: 학습된 모델 verdict → Python /classify 응답 교체 (인터페이스 동일)

### Week 6-7 — 합성 PoC (본인 ~15시간)
- 6.1 `Velxor/poc-samples/ransomware_simulator/` (Python or Rust binary)
  - 동작: 지정 디렉토리에서 .docx/.txt 파일 300개를 1초 안에 rename(.enc) + 임의 32바이트 prefix 쓰기
  - 파라미터: 파일 수, 디렉토리, 속도
- 6.2 positive 로그 생성기: PoC 실행 → 행위 로그 → `datasets/positive/*.jsonl`
- 6.3 negative 로그 생성기: 메모장/브라우저/explorer 일반 사용 → `datasets/negative/*.jsonl`
- 6.4 데이터셋 인계: 팀원2가 Python 측에서 학습 트리거 (XGBoost binary classifier)
- 6.5 통합 검증: UI 측에서 PoC 실행 → end-to-end 모든 계층 통과

### Week 8-9 — 통합 + 시연 리허설 (본인 ~15시간)
- 8.1 차단 동작 — Rust → Windows API `TerminateProcess(pid)` 또는 UI Block 버튼 클릭 → Rust → kernel/admin kill
- 8.2 데모 시나리오 스크립트 (1분 단위) — 발표용 흐름
- 8.3 UI 폴리싱 — 애니메이션, 색상, 사운드, 타이밍
- 8.4 **AC5 측정**: PoC 10회 + normal 10회 자동 실행 스크립트 → 결과 표 markdown
- 8.5 1차 리허설 (전체 팀), 백업 시나리오 (stub fallback 시연 흐름)

### Week 10 — 발표 준비 (본인 ~10시간)
- 10.1 슬라이드 (아키텍처, 데이터 전략, 데모 시나리오, AC5 결과)
- 10.2 시연 영상 (실패 백업용)
- 10.3 발표 리허설 1-2회

## Files Created (planned)
```
Velxor/
├── contracts/
│   └── interface-schema.md
├── rust-service/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── driver_source.rs   # JSON poll → real IOCTL adapter
│       ├── aggregator.rs      # sliding window
│       ├── classifier_client.rs
│       └── ws_broadcaster.rs
├── python-engine/
│   ├── app.py
│   ├── requirements.txt
│   ├── features.py            # behavior log → feature vector
│   └── model/                 # 팀원2 책임 (학습 코드)
├── ui/
│   ├── package.json
│   ├── electron/main.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/{ProcessTree,Timeline,DetailPanel,BlockButton}.tsx
│   │   └── ws/client.ts
│   └── vite.config.ts
├── poc-samples/
│   └── ransomware_simulator/
├── datasets/
│   ├── positive/
│   └── negative/
├── scripts/
│   ├── run-all.sh
│   ├── eval-ac5.sh
│   └── poc-bench.sh
├── docs/
│   ├── ARCHITECTURE.md
│   └── DEMO-SCRIPT.md
└── README.md
```

## Risks and Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| 팀원1 (C/WDK) 일정 지연 | High | Medium | Week 1 stub 영속화 + ETW provider 대체 경로 사전 검증 |
| 팀원2 (Python+AI) 모델 미완성 | Medium | Medium | 룰 기반 fallback (write rate 임계치) — /classify 동일 인터페이스 |
| Test signing 미적용으로 driver 로드 실패 | Medium | High | Week 1에 환경 setup 검증 + 문서화; ETW provider 백업 |
| Driver crash → BSOD | Low | High | 격리 VM + snapshot, 사전 리허설 N회 |
| WebSocket reconnect 불안정 | Medium | Low | Rust 측 broadcast + replay buffer, UI exponential backoff |
| 합성 PoC가 실제 ransomware 일반화 어려움 | Medium | Low | 발표에 "behavior pattern reproduction" 명시, 한계 명시 |
| 80-120시간 예산 초과 | High | Medium | 비핵심(통계 대시보드, 영구 차단 정책) deferred; 스키마 잠금이 재작업 방지 |
| Week 1 본인 부하 집중 (~15h) | High | Medium | Week 0(이전 주말) 환경 셋업 미리, 스키마 초안 |

## Verification Steps
- **AC1**: Week 1 종료 시 화상 데모 → 팀 sign-off 후 git tag `walking-skeleton-v1`
- **AC2**: `scripts/poc-bench.sh` 실행 → wall-clock < 1s for 300 file ops (재현)
- **AC3**: 시연 영상 녹화 (OBS) → 빨간 노드 + verdict panel 가시 확인
- **AC4**: Rust에 `tracing` instrument → `event_received_ts → ws_sent_ts` < 1000ms p99
- **AC5**: `scripts/eval-ac5.sh` 자동화 → 결과 markdown 표 (TP, FP, accuracy)
- **AC6**: PoC 차단 후 `ps`/Task Manager로 프로세스 부재 확인
- **AC7**: `docs/DEMO-SCRIPT.md` + 영상 파일 존재
- **AC8**: Week 8 리허설에서 모든 layer를 stub로 두고 1회 시연 성공

## ADR
**Decision**: Walking Skeleton 접근, 본인이 interface contract owner, 합성 PoC 데이터, 4계층 모두 활성, 데모 시나리오는 ransomware 행위 탐지 단일.

**Drivers**:
1. 시간 제약 (한 학기, 80-120시간)
2. 통합 리스크 최소화
3. 시연 임팩트
4. 팀원 의존성 격리

**Alternatives considered**:
- Module-First (Option B) — invalidate: 통합 폭풍, 발표 1-2주 전 리스크
- 본인 단독 4계층 stub (Option C) — invalidate: 시간 예산 ≥2배 위반
- 실제 ransomware 샘플 — invalidate (deep-interview Round 4): 안전·재현성 손실
- AI 대신 룰 기반 only — fallback으로만 보존; primary는 학습 모델

**Why chosen**: Walking Skeleton은 통합 리스크를 0으로 만들고, stub fallback을 자동 확보하며, Week 1 이후 매주 시연 가능한 상태를 유지하므로 학기 일정·팀 의존성·시연 임팩트 세 driver를 모두 충족.

**Consequences**:
- 긍정: 본인이 시스템 통합자 역할 → 학습 기회 큼. 마일스톤마다 데모 가능. 인터페이스 스키마가 곧 산출물의 일부.
- 부정: Week 1 본인 부하 집중. 팀원이 stub 단계에서 진척감 부족 risk (완화: 스키마 리뷰 미팅).

**Follow-ups**:
- Week 1 종료: 스키마 리뷰 미팅 (팀원1/팀원2 sign-off)
- Week 4 종료: AC5 첫 정량 측정 (모델 정확도 베이스라인)
- Week 8 종료: 1차 리허설, stub fallback 시연 검증

## Status
DRAFT — Architect 검토 대기.
