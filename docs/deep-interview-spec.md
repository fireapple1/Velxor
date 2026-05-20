# Deep Interview Spec: Velxor — 행위 기반 백신 (합성 PoC 데모)

## Metadata
- **Interview ID**: velxor-2026-05-20
- **Rounds**: 6 (+ Round 0 topology gate)
- **Final Ambiguity Score**: 17.8%
- **Type**: brownfield (Velxor 기획서 존재, 소스 0줄)
- **Generated**: 2026-05-20
- **Threshold**: 20%
- **Initial Context Summarized**: Yes (velxor_planning_doc.html → summary)
- **Status**: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.35 | 0.2975 |
| Constraint Clarity | 0.85 | 0.25 | 0.2125 |
| Success Criteria | 0.80 | 0.25 | 0.2000 |
| Context Clarity | 0.75 | 0.15 | 0.1125 |
| **Total Clarity** | | | **0.8225** |
| **Ambiguity** | | | **0.1775 (17.8%)** |

## Topology
Round 0에서 확정된 4개 활성 컴포넌트, 0 deferred.

| Component | Status | Description | Coverage / 비고 |
|-----------|--------|-------------|------------------|
| 커널 드라이버 (C + WDK) | active | Ring 0 미니필터, 파일 I/O 후킹, 프로세스 생성 콜백, IOCTL 송신 | 팀원1 책임. 합성 PoC의 파일 burst를 감지 |
| Rust 유저모드 서비스 | active | IOCTL 수신 → 이벤트 집계 → REST 호출 → WebSocket 푸시 | 본인 책임. 인터페이스 스키마 설계 owner |
| 분석 엔진 (Python) | active | Flask REST, 행위 로그 feature 추출, XGBoost/RF binary classifier | 팀원2 책임. 합성 PoC 자체생성 학습 데이터로 학습 |
| UI (React + Electron) | active | 프로세스 트리, 위협 타임라인, AI 판정 + 신뢰도, 차단/허용 | 본인 책임. "프로세스 트리 폭발" 데모 모먼트 |

## Goal
Windows 커널 레벨에서 **랜섬웨어의 파일 암호화 행위**를 실시간 감지하고, AI 판정과 함께 **프로세스 트리 시각화**로 보여주는 **학교/공모전 데모급** 백신.
**합성 PoC** 기반으로 학습 데이터부터 시연까지 자체 생성하여 안전·재현·우발적 필터링 없는 데모를 보장한다.

## Constraints
- **Deadline**: 한 학기 (~2-3개월), 데모 발표용
- **본인 가용 시간**: 주당 ~10시간 (총 ~80-120시간)
- **데이터**: 합성 PoC만 사용 (실제 ransomware 샘플 X) — 학습/테스트/시연 모두 자체생성
- **환경**: Windows 10/11 격리 VM, 테스트 서명 모드 (`bcdedit /set testsigning on`), BSOD 회피
- **팀**: 본인(Rust+UI+인터페이스 스키마), 팀원1(C 드라이버), 팀원2(Python 엔진+AI)
- **통합 전략**: Walking Skeleton — Week 1에 본인이 IOCTL/REST/WS 스키마 잠그고 4계층 stub end-to-end 동작 확보 후 점진 교체
- **언어/스택**: C+WDK, Rust(tokio+tungstenite), Python(Flask, pefile 격하, XGBoost/RF), TypeScript+React+Electron+React Flow/D3

## Non-Goals
- 실제 사용자 배포, 프로덕션 안정성, 운영급 false positive 관리
- WHQL 서명, 시그너처 DB, 자동 업데이트 메커니즘
- 실제 ransomware 샘플 수집/실행
- 랜섬웨어 외 위협 시나리오 (프로세스 인젝션, 정보 탈취, persistence 등)
- VirusTotal 의존성, 정적 PE 분석을 메인 메커니즘으로 사용 (보조 가능)
- AI 모델 학술 수준 평가 (EMBER 벤치마크 등)

## Acceptance Criteria
- [ ] **AC1 (Walking Skeleton, Week 1 종료시점)**: 본인이 설계한 IOCTL → Rust event → REST → WebSocket → UI 노드 그리기까지 모든 stub이 연결되어 가짜 이벤트 1개가 끝까지 흐른다
- [ ] **AC2 (합성 PoC 동작)**: PoC 프로그램이 1초에 .docx → .docx.enc 형태로 300개 이상 파일을 rename + 임의 바이트 쓰기를 수행한다 (재현 가능 스크립트)
- [ ] **AC3 (탐지 시연)**: PoC 실행 시 UI 프로세스 트리에 PoC 노드가 그려진 직후 빨간색으로 깜빡이고, 우측 패널에 "Process X가 N초 동안 파일 K개 쓰기 중! 암호화 의심! AI 판정: 랜섬웨어 X%" 표시
- [ ] **AC4 (지연시간)**: PoC 시작부터 UI 빨간 알림까지 **1초 이내**
- [ ] **AC5 (분류 정확도)**: PoC 양성 샘플 N=10회 실행 중 ≥9회 ransomware로 분류, 일반 프로세스(메모장/브라우저/explorer) negative N=10회 중 false positive ≤1
- [ ] **AC6 (차단 동작)**: 자동 차단 또는 UI Block 버튼 클릭으로 PoC 프로세스가 실제로 종료된다
- [ ] **AC7 (데모 자료)**: 30초~1분 시연 영상 + 발표 슬라이드에 "프로세스 트리 폭발" 시나리오 포함
- [ ] **AC8 (팀 fallback)**: 팀원의 드라이버/Python이 늦어질 경우 stub으로 계속 데모 가능 (인터페이스 스키마 잠금 덕분)

## Assumptions Exposed & Resolved
| Assumption | Challenge (라운드) | Resolution |
|------------|-------------------|------------|
| "행위 기반 탐지 = 실제 랜섬웨어 샘플 실행이 필요" | R4 Contrarian: 합성 PoC가 안전/재현/자체생성 가능, 동일한 시각적 임팩트 | 합성 PoC only |
| "기획서의 모듈→통합 순서가 표준" | R6 Simplifier: 마지막 통합 구간 폭발 리스크 | Walking Skeleton, Week 1에 스키마 잠금 |
| "PE 정적 분석 + VirusTotal이 핵심 메커니즘" | R2 Goal Clarity: 행위 기반의 의미를 명세 | 파일 I/O 행위가 primary, PE는 보조 |
| "프로덕션급 백신 완성" | R1 Project Type: 데모/공모전 위주 | 데모 임팩트가 evaluation criterion |
| "AI 모델 다범주 분류 필요" | R2 정착: 랜섬웨어 전용 | binary classifier (랜섬웨어 vs 정상) 충분 |
| "4계층 토폴로지 자명" | R0 Topology Gate | 4계층 모두 active 확정 (deferred 없음) |

## Technical Context (brownfield)
- **Repo**: `/home/lsy/ht/Velxor`
- **현재 상태**: README.md (placeholder "# Velxor"), `velxor_planning_doc.html` (기획서), 소스 0줄
- **Git**: 2 commits ("Initial commit", "Add files via upload")
- **기획서 기반 결정사항**: 4계층 아키텍처 / 언어 스택 / 팀 역할 / IPC 수단(IOCTL / REST / WebSocket) 유지
- **기획서 대비 변경사항**:
  - 데이터 소스: 실제 샘플 → 합성 PoC
  - 통합 순서: 모듈 우선 → Walking Skeleton (인터페이스 우선)
  - VirusTotal/PE 정적 분석: 보조로 격하

## Week-by-Week Roadmap (Walking Skeleton)
| Week | Goal | 본인 작업 | 팀 작업 |
|------|------|-----------|---------|
| 1 | Skeleton 완성 | IOCTL/REST/WS 스키마 명세 + 4계층 stub + UI 노드 1개 표시 | 스키마 리뷰 + 각자 환경 셋업 |
| 2-3 | UI 깊이 | React Flow 프로세스 트리, 위협 타임라인, 디테일 패널, 차단 버튼 | 팀원1: 미니필터 골격, 팀원2: Flask + dummy model |
| 4-5 | 실데이터 흐름 | Rust 이벤트 집계/burst 감지/REST 호출, WS push | 팀원1: 실제 IOCTL 송신, 팀원2: feature 추출 + 모델 학습 |
| 6-7 | 합성 PoC 작성 | PoC 스크립트(랜섬웨어 따라하기), positive/negative 데이터 셋 생성기 | 팀원1: 콜백 안정화, 팀원2: 모델 튜닝 |
| 8-9 | 통합 + 시연 리허설 | 데모 시나리오 스크립트, UI 폴리싱, 차단 동작 | 통합 버그 fix |
| 10 | 발표 준비 | 슬라이드, 영상, 시연 |  |

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Project (Velxor) | core | name, scope, deadline | has 4 Components |
| Threat (Ransomware) | core domain | type, behavior_signature | targeted_by Detection |
| SyntheticPoC | core domain | name, behavior_script, parameters | generates BehaviorEvents |
| FileIO | core domain | path, op (write/rename), size, ts | emitted_by Process, captured_by MinifilterDriver |
| Process | core domain | pid, image, parent_pid | runs Sample, watched_by Driver |
| BehaviorEvent | core domain | type, pid, payload | aggregated_by RustService |
| EncryptionBurst | core domain | rate, file_count, entropy delta | triggers AIVerdict |
| MinifilterDriver | Component 1 | callbacks, IOCTL ID, payload schema | emits BehaviorEvent |
| RustService | Component 2 | tokio runtime, tungstenite WS, REST client | bridges Driver ↔ Engine ↔ UI |
| AnalysisEngine | Component 3 | Flask, classifier, feature extractor | returns AIVerdict |
| AIVerdict | core domain | label, confidence, evidence | rendered_by UI |
| UI | Component 4 | ProcessTree, DetailPanel, BlockButton, Timeline | renders DemoMoment |
| DemoMoment | success criterion | trigger, visualization, audio | proof_of_concept |
| ProcessTree | UI primitive | nodes, edges, highlight | rendered by React Flow/D3 |
| BlockAction | core domain | pid, decision (auto/manual) | terminates Process |
| Timeline (Semester) | constraint | weeks, hours/week | sizes scope |
| TeamMember | constraint | role, language, deliverable | owns Component |
| IntegrationContract | architecture | IOCTL/REST/WS schema | owned_by 본인 (Week 1) |
| TrainingDataset | data | positive_samples, negative_samples | trains AnalysisEngine |
| PositiveSample | dataset | source=SyntheticPoC log | trains classifier |
| NegativeSample | dataset | source=normal_process log | trains classifier |
| WalkingSkeleton | strategy | stubs[4], end-to-end pipeline | reduces integration risk |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability |
|-------|-------------|-----|---------|--------|-----------|
| 1 | 6 | 6 | - | - | N/A |
| 2 | 10 | 4 | 0 | 6 | 60% |
| 3 | 14 | 4 | 0 | 10 | 71% |
| 4 | 18 | 4 | 0 | 14 | 78% |
| 5 | 22 | 4 | 0 | 18 | 82% |
| 6 | 22 | 0 | 0 | 22 | **100% (converged)** |

## Interview Transcript
<details>
<summary>전체 Q&A (Round 0 + 6 rounds)</summary>

### Round 0 (Topology Gate)
**Q**: 4계층 토폴로지가 맞나요? 추가/제거/병합/분할 또는 deferred?
**A**: 4계층 그대로 맞음.
**Ambiguity**: 미산정 (Round 0)

### Round 1 (Component: 분석 엔진, Targeting: Criteria)
**Q**: 최종 결과물과 평가 관점이 어떤 그림인가요? (학교/공모전 데모 vs 연구/논문 vs 실제 배포 vs 코딩 학습)
**A**: 학교/공모전 데모.
**Ambiguity**: 52% (Goal 0.55, Constraints 0.40, Criteria 0.45, Context 0.50)

### Round 2 (Component: 커널 드라이버, Targeting: Goal)
**Q**: 데모에서 시연할 탐지 시나리오가 어떤 그림? (랜섬웨어 전용 vs 일반 행위 분류 vs PE 정적 vs 인젝션)
**A**: 랜섬웨어 전용.
**Ambiguity**: 49% (Goal 0.65, Constraints 0.40, Criteria 0.40, Context 0.55)

### Round 3 (Component: UI, Targeting: Criteria)
**Q**: 데모 임팩트 모먼트 (관중이 30초~1분 안에 '메서구나' 느낄 장면)는?
**A**: 프로세스 트리 폭발 — 좌측 트리에 빨간 노드 깜빡 + 우측 패널 "Process X가 0.8초 동안 파일 247개 쓰기 중!" + AI 판정 + 자동 차단.
**Ambiguity**: 38% (Goal 0.75, Constraints 0.50, Criteria 0.60, Context 0.55)

### Round 4 (Component: 분석 엔진, **Contrarian Mode**, Targeting: Constraints)
**Q**: 정말 실제 랜섬웨어 샘플을 써야 데모 임팩트인가, 합성 PoC가 더 나은 좌표는 아닌가?
**A**: 합성 PoC만 쓰기.
**Ambiguity**: 30% (Goal 0.80, Constraints 0.65, Criteria 0.65, Context 0.60)

### Round 5 (Component: Rust 서비스, Targeting: Constraints)
**Q**: 데모/발표 데드라인과 본인의 실제 가용 시간은?
**A**: 한 학기 (2-3개월, 주당 10시간).
**Ambiguity**: 23.5% (Goal 0.85, Constraints 0.75, Criteria 0.70, Context 0.70)

### Round 6 (Component: Rust 서비스 + 전체 통합, **Simplifier Mode**, Targeting: Criteria + Constraints)
**Q**: 마지막 통합 구간 폭발 리스크 — Week 1에 본인이 스키마 잠그고 stub end-to-end 가는 게 안전하지 않은가?
**A**: End-to-end PoC 먼저 (Walking Skeleton).
**Ambiguity**: 17.8% (Goal 0.85, Constraints 0.85, Criteria 0.80, Context 0.75) ✅

</details>

## Status: PENDING APPROVAL
이 명세는 `pending approval` 상태입니다. 사용자가 실행 경로를 명시적으로 선택하기 전에는 어떤 코드 변경/PR/실행도 시작하지 않습니다.
