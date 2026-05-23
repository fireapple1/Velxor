# 작업자 C 업무 정리 — Python 분석 엔진 & PoC/평가

> **출처**: [`role-assignment.md`](./role-assignment.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md)
> **총 예상 시간**: ~40h (3인 균등 분담의 한 축)
> **주 책임 계층**: ③ Python 분석 엔진 + 데이터셋 + 측정

---

## 1. 한 줄 요약

작업자 C는 **랜섬웨어 행위 분류기**(Python + Flask + Waitress)를 책임지며, 합성 PoC 샘플과 데이터셋을 직접 만들고, 프로젝트의 정량적 합격 기준(AC2/AC4/AC5)을 측정·문서화하는 역할이다.

---

## 2. 소유(Owns) 범위

작업자 C가 단독으로 책임지는 산출물은 다음과 같다.

- **REST API 서버**
  - Flask + **Waitress** (cross-platform WSGI, `threads=4`) 기반 — Linux/Ubuntu에서도 동일 가동, AC4 sub-budget 측정 재현성 확보
  - 엔드포인트: `POST /classify`, `GET /health`
- **`features.py`** — 행위 윈도우 기반 통계 추출
  - write rate, rename rate, 확장자 다양성, 파일 크기 분포, PID 트리 fan-out
- **`fallback_rules.py`** — 규칙 기반 영속 백업
  - 예: write rate ≥ 50/1s → `ransomware`, confidence 0.9
- **학습 모델**
  - `/classify` p99 < 100ms 충족
  - 응답에 `model_version` 반드시 채움 (미달성 시 `"rule-based-v1"`로 영속)
- **PoC 샘플 v1 / v2 / v3 + positive / negative 데이터셋**
- **합격 기준 측정 스크립트 및 결과 문서**
  - `poc-bench.sh`, `eval-ac4.sh`, `eval-ac5.sh`, `docs/AC5-results.md`

---

## 3. 주차별 상세 업무

### Week 0 — 학기 전 주말 (약 2h)

- **0.5** Python 환경 셋업
  - `venv` + Flask + **Waitress**(threads=4) 설치
  - `/health` 엔드포인트가 200을 반환하는지 검증

### Week 1 — Walking Skeleton (약 5h)

- **1.3** Python 엔진 stub 구현
  - Flask + Waitress(threads=4) 로 띄우고 `/classify` 가 하드코드 verdict `{ransomware, 0.95}` 반환
  - 동작 모드 분기: `VELXOR_STUB=engine`
- **`fallback_rules.py` 골격** 작성 (write rate ≥ 50/1s → ransomware 0.9)
- **1.6** Interface Schema v1-draft에 대한 **mechanical ack** (컴파일 가능한 한 줄 응답)
- **AC1 walking skeleton 재현성 공동 책임**
  - 자기 머신에서 `run-all.sh` exit 0
  - `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}` 확인
  - 통과 시 `git tag walking-skeleton-v1`

### Week 3 — Schema v1.1 비동기 리뷰 (약 1h)

- **2.6** Interface Contract v1.1 리뷰에 **Python/모델 관점에서 missing/wrong field 노트 1개 제출**
  - 48시간 데드라인 (무응답 시 B가 단독 발행 — 발언권 행사 필수)

### Week 6-7 — PoC 샘플 & 데이터셋 & 학습 (약 22h, 가장 큰 블록)

- **6.1** `poc-samples/ransomware_simulator/v1/` 작성
  - `.docx → .docx.enc` rename + 32B prefix write, 300 files/1s
- **6.2 AC5a variants** (학습 / held-out 분리가 핵심)
  - `v2/`: `.txt → .crypted`, 500 files/0.8s
  - `v3/`: `.pdf → .locked`, 200 files/2s — **held-out (학습 금지)**
- **6.3 positive 데이터셋 생성기**
  - v1 + v2 학습용, v3 held-out
- **6.4 AC5b bursty-benign negative 데이터셋** (Ubuntu 워크로드)
  - `rsync -aH --delete src/ dst/` (Windows robocopy /MIR 대응)
  - `unzip sample.zip -d tmp_extract` 또는 `7z x sample.zip -o tmp_extract`
  - `tar xf large.tar.gz`, `git clone <large repo>`, `npm/pnpm install` (node_modules 폭발) — benign 이지만 폭발적 I/O가 발생하는 케이스
- **`features.py` 본구현** — 위의 통계 피처들
- **학습 모델 트레이닝**
  - `/classify` p99 < 100ms 만족 (Waitress threads=4)
  - 미달성 시: `fallback_rules.py` 영속, `model_version: "rule-based-v1"` 표기
- **`scripts/poc-bench.sh`** 작성
  - **AC2** 검증: 300 file ops wall-clock < 1s

### Week 8-9 — 통합·측정 (약 8h)

- **8.4 AC5 측정** — `scripts/eval-ac5.sh`
  - v1+v2 학습, v3 held-out + rsync/unzip(7z)/npm-install negative 로 평가
  - **합격선: TP ≥ 9/10, FP ≤ 1/10**
  - 결과는 `docs/AC5-results.md` 로 산출
- **AC4 측정** — `scripts/eval-ac4.sh`
  - Rust `tracing` JSON 파싱
  - event→ws **p99 < 1000ms**, classify **p99 < 100ms** 출력
- **임계값 완화 금지, honest reporting**
  - held-out v3 결과를 그대로 슬라이드에 기재

### Week 10 — 발표 (약 2h)

- **10.1** 슬라이드 — 데이터 전략 섹션 + AC5 결과 페이지
- **AC5c disclaimer 필수 기재**
  - *"evaluated on synthetic PoC, not real-world malware"*
- **10.2** 백업 시연 영상 — *Deferral #4* (예산 초과 시 가장 먼저 잘리는 항목)

---

## 4. 공동 책임 (3인 모두 해당하는 항목)

| 항목 | C 의 역할 |
|---|---|
| Week 1 AC1 walking skeleton 재현 | 자기 머신에서 `run-all.sh` 통과 + `ws-record.sh` 캡처 확인 |
| Week 3 v1.1 schema review (48h async) | 노트 1개 제출 |
| Week 9 리허설 3회 | 전원 참석, `REHEARSAL-LOG.md` 기여 |
| Week 10 발표 | C 담당 섹션 슬라이드 (PoC + 데이터셋 + AC5) |
| **AC8 stub 모드 검증** | **C 가 `VELXOR_STUB=engine` 모드 smoke pass 담당** |

---

## 5. 통합 포인트 (C 관여 부분)

| 통합 포인트 | 시점 | C 의 역할 | Fallback |
|---|---|---|---|
| ② → ③ Rust → Python `POST /classify` | Week 1 (stub) / Week 7 (real) | C가 서버측, B가 클라이언트측 공동 작업 | `VELXOR_STUB=engine` 또는 `fallback_rules.py` (`model_version: "rule-based-v1"`) |

> **격리 원칙**: B의 Rust 통합 서비스가 늦더라도 C의 엔진은 단독 검증 가능해야 한다. 반대로 모델 학습이 늦으면 `fallback_rules.py`가 영속되며 데모는 계속 진행된다.

---

## 6. Acceptance Criteria 책임 매핑 (C 주관)

| AC | 검증 artifact | 비고 |
|---|---|---|
| **AC2** PoC 동작 | `poc-bench.sh` — 300 ops wall-clock < 1s | C 단독 |
| **AC4** 지연시간 | `eval-ac4.sh` — event→ws p99 < 1000ms, classify p99 < 100ms | B(tracing instrumentation) + **C(측정 스크립트)** |
| **AC5** 분류 정확도 | `eval-ac5.sh`, `AC5-results.md` — TP ≥ 9/10, FP ≤ 1/10 | C 단독 |
| **AC5a** held-out v3 | `poc-samples/v3/` (.pdf → .locked) | C 단독 |
| **AC5b** bursty-benign negative | rsync / unzip(7z) / npm-install 로그 (Ubuntu) | C 단독 |
| **AC5c** disclaimer | slide deck "evaluated on synthetic PoC, not real-world malware" | C 단독 |
| **AC8** stub 영속성 | `VELXOR_STUB=engine` smoke pass | C 가 engine 모드 담당 |

---

## 7. 리스크 & 대응 (C 오너십)

| Risk | Trigger | Mitigation |
|---|---|---|
| **학습 모델 미완성** | Week 7 종료 시 학습 모델 없음 | `fallback_rules.py` 영속, `model_version: "rule-based-v1"` 응답 |
| **합성 PoC 일반화 의문** | 발표 Q&A | AC5c disclaimer + "real-world testing future work" 명시 |

---

## 8. 생성/소유 파일 목록

```
Velxor/
├── python-engine/
│   ├── app.py                        # C — Flask 앱
│   ├── waitress_conf.py              # C — Waitress threads=4
│   ├── features.py                   # C — 행위 통계 피처
│   ├── fallback_rules.py             # C — 규칙 기반 백업
│   ├── requirements.txt              # C
│   └── model/                        # C — 학습 모델 산출물
├── poc-samples/
│   └── ransomware_simulator/
│       ├── v1/                       # C — .docx → .docx.enc
│       ├── v2/                       # C — .txt → .crypted (학습용)
│       └── v3/                       # C — .pdf → .locked (held-out)
├── datasets/
│   ├── positive/                     # C
│   └── negative/                     # C — rsync / unzip(7z) / npm-install 로그
├── scripts/
│   ├── poc-bench.sh                  # C — AC2
│   ├── eval-ac4.sh                   # C — tracing JSON → p99
│   └── eval-ac5.sh                   # C — TP/FP 평가
└── docs/
    └── AC5-results.md                # C
```

---

## 9. 브랜치 전략

- 작업자 C 의 모든 PR 은 **`devC`** 브랜치에서 `main` 으로 올린다.
- `python-engine/` 디렉토리의 CODEOWNER 는 `@C` (도입 권장).
- 의미 단위 tag 예: `ac5-baseline` 등.

---

## 10. 시간 예산 (C 합계 ~40h)

| Week | 시간 | 핵심 산출물 |
|---|---|---|
| Week 0 | 2h | Flask `/health` + Waitress 셋업 |
| Week 1 | 5h | Python stub + `fallback_rules.py` 골격 + schema ack |
| Week 2-3 | 1h | v1.1 schema review 노트 1개 |
| Week 4-5 | 0h | (A의 driver 통합 주간 — C는 휴식 또는 사전 작업) |
| Week 6-7 | 22h | PoC v1/v2/v3 + 데이터셋 + features + 모델 + `poc-bench.sh` |
| Week 8-9 | 8h | `eval-ac4.sh`, `eval-ac5.sh`, `AC5-results.md` |
| Week 10 | 2h | 슬라이드 + AC5c disclaimer |
| **합계** | **~40h** | — |

> Week 6-7 이 가장 큰 부하 구간이므로, Week 4-5 의 여유 시간을 활용해 PoC 시뮬레이터 골격을 미리 준비해 두면 안전하다.

---

## 11. 작업자 C 의 결정적 책임 요약

1. **`/classify` p99 < 100ms 를 책임진다** — 미달 시 즉시 `fallback_rules.py` 영속으로 전환.
2. **AC5 의 정확도 숫자(≥9/10 TP, ≤1/10 FP) 는 C 의 honest reporting 이다** — 임계값 완화 금지.
3. **held-out v3 (.pdf → .locked) 는 학습 데이터에 절대 포함하지 않는다.**
4. **AC5c disclaimer ("synthetic PoC, not real-world malware") 는 발표 슬라이드에 반드시 들어간다.**
5. **`VELXOR_STUB=engine` 모드가 항상 동작하도록 유지** — A 또는 B 가 지연되어도 C 의 엔진은 단독으로 살아 있어야 한다.
