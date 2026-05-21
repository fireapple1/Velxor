# Velxor

Windows 커널 레벨에서 **랜섬웨어의 파일 암호화 행위를 실시간 감시**하고, Rust 유저모드 서비스 → Python AI 분석 엔진을 거쳐 React + Electron UI로 **시각화 + AI 판정**까지 하는 학교/공모전 데모급 백신.

**팀**: Zeraxis (3인)

## 4계층 아키텍처

| 계층 | 언어 | 역할 |
|------|------|------|
| ① 커널 드라이버 | C + WDK | Ring 0 미니필터, 파일 I/O 후킹, 프로세스 생성 콜백, FltMgr comm port로 이벤트 송신 (`FltSendMessage`) |
| ② 유저모드 서비스 | Rust | FltMgr comm port 수신 → burst 감지 → REST 호출 → WebSocket 푸시 |
| ③ 분석 엔진 | Python + AI | Flask + 행위 기반 분류 모델 (또는 rule-based fallback) |
| ④ UI | TypeScript + React + Electron | 실시간 프로세스 트리, 위협 타임라인, AI 판정 + 차단 |

## 데이터 전략

실제 ransomware 샘플을 쓰지 않고 **합성 PoC**(대량 파일 rename + 임의 바이트 쓰기)로 학습·시연 모두 자체 생성한다. 합성 PoC는 평판 DB에 없어 EDR/AV의 우발적 차단 없음 → 안전·재현성 확보.

## 통합 전략 — Walking Skeleton + Interface Evolution Gate

- **Week 0** (학기 전): tooling install + ETW 스파이크 (driver fallback 사전 검증)
- **Week 1**: 작업자 B가 Driver→Service 메시지(FltMgr comm port) / REST / WS 스키마 v1-draft 주관, A/B/C 3인 동시 stub 구현 ([`role-assignment.md`](./role-assignment.md) 참조)
- **Week 3**: async 48h v1.1 review (additive-only)
- **Week 4-7**: 각 계층 stub → 실제 구현 교체 (`VELXOR_STUB` env flag로 stub code path 영속)
- **Week 8-9**: 통합, 차단, AC5 측정 (held-out variant + bursty-benign negatives)
- **Week 10**: 발표

## 기획·계획 문서

| 단계 | 문서 | 설명 |
|------|------|------|
| 1. 초기 기획 | [`velxor_planning_doc.html`](./velxor_planning_doc.html) | 팀 초기 기획서 (2025) |
| 2. Deep Interview Spec | [`deep-interview-spec.md`](./deep-interview-spec.md) | 6라운드 Socratic Q&A로 정련 (final ambiguity 17.8%, historical) |
| 3. Consensus Plan (기술 명세) | [`velxor-consensus-plan.md`](./velxor-consensus-plan.md) | Planner/Architect/Critic 2회 합의 정제, **기술 명세 source of truth** |
| 4. 역할 분담 (현재) | [`role-assignment.md`](./role-assignment.md) | 3인 공동 작업자(A/B/C) 균등 분담 — 현재 ownership 모델 |
| 5. 개발 환경 | [`ENVIRONMENT.md`](./ENVIRONMENT.md) | 3인 공통 툴체인 버전 pin, Week 0 검증 체크리스트 |

## 데모 임팩트 모먼트

VM에서 합성 PoC 실행 → 좌측 프로세스 트리 노드가 빨갛게 깜빡 + 우측 패널에 "Process X가 0.8초 동안 파일 500개 쓰기 중! AI 판정: 랜섬웨어 91%" + 자동/수동 차단. 30초~1분 분량. (PoC v2 baseline: .txt → .crypted, 500 files/0.8s)

## Status

🟡 **계획 단계** — `velxor-consensus-plan.md`가 `pending approval` 상태. 코드 작성은 명시적 실행 승인 이후 시작.

## 한계 / Future Work

- 평가는 합성 PoC 기준이며 실제 랜섬웨어 일반화는 future work.
- 학교/공모전 발표용 demo-grade; 운영 배포·시그너처 DB·자동 업데이트 등 프로덕션 요구사항은 비범위.
