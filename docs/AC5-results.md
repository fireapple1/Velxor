# AC5 — 합성 PoC 분류 정확도 측정 결과

> **작성자**: Worker C
> **측정일**: 2026-05-23 (Asia/Seoul)
> **재현**: `bash scripts/eval-ac5.sh` (내부에서 `scripts/eval-ac5.py` 실행)
> **policy**: honest reporting — 결과 그대로 기재, 임계값 사후 조정 없음.

---

## 0. AC5c disclaimer (필수, consensus-plan §AC5c)

> **Evaluated on synthetic PoC samples, not real-world malware.**
> 본 평가는 자체 작성한 `poc-samples/ransomware_simulator/{v1,v2,v3}/simulate.py` 가
> 생성한 합성 행위 시퀀스 + `scripts/gen-negative.py` 가 합성한 bursty-benign Ubuntu
> 워크로드(rsync / unzip / git clone / npm install) 의 fanotify-style trace 만을
> 대상으로 한다. 실제 ransomware family / in-the-wild 샘플에 대한 일반화는 future work.

---

## 1. AC5 합격 기준 (consensus-plan §AC5)

| 지표 | 기준 |
|---|---|
| held-out v3 (TP) | ≥ 9 / 10 |
| negative   (FP) | ≤ 1 / 10 |
| decision threshold | `proba ≥ 0.5 = ransomware` (사후 조정 금지) |
| held-out 분리 | v3 (.pdf → .locked) 는 학습 데이터에 절대 미포함 |

---

## 2. 모델

- **model_version**: `lr-2026w7`
- **알고리즘**: `sklearn.linear_model.LogisticRegression(max_iter=1000, class_weight="balanced")`
- **artifact**: `python-engine/model/model.pkl`
- **학습 입력 (2026-05-23 v3 보강 — Option D)**:
  - positive: `datasets/positive/v1_run_{01..30}.jsonl` + `v2_run_{01..30}.jsonl` (60 파일 → **60 windows**)
  - negative: `datasets/negative/*.jsonl` (37 파일 → **337 windows**)
    - baseline 10 (rsync × 4, unzip × 4, gitclone × 1, npm × 1)
    - **신규 spread variants 27**: rsync × 4 × 3 spreads (1/5/30s) + unzip × 4 × 3 + npm × 3
    - gitclone variants 미생성 — `git_express/` 디렉토리에 npm install 이후 `node_modules` 적재되어 baseline 과 분리 불가 (gitclone-only 결과 보존 안 됨). npm variants 만 진행.
  - imbalance: 60 positive : 337 negative (~1:5.6) → `class_weight="balanced"` 자동 보정
- **held-out (v3 미보강 — v2 와 동일)**: `datasets/heldout/v3/v3_run_{01..30}.jsonl` (학습 절대 미포함)

### 2.2 window-sliced features (Option D 핵심)

**v3 변경의 본질**: 이전 v2 까지 한 JSONL = 한 feature vector (window_ms=1000 고정 → write_rate=count/1.0s). ts spread 무관. Option D 의 spread 변형이 의미 있으려면 train/eval 도 ts 기반 슬라이싱 필요.

- `python-engine/features.py::slice_to_windows(events, window_ms)` 신규 — ts_unix_ms 기준 bucket 분할
- `python-engine/model/train.py`: 각 JSONL → 1s window 단위 분할, 각 window = 1 sample (min_events=4 이하 window 제외)
- `scripts/eval-ac5.py`: 각 file 의 max(window_proba) ≥ threshold → ransomware (실 운영 fanotify streaming semantics 와 일치)
- **live engine `python-engine/app.py` 도 동일 슬라이싱 적용 (v3.1 추가, 2026-05-23)** — rust-service aggregator 가 1s debounce 기준 batch 를 보내지만 multi-second burst 도 가능 → serve 측도 `slice_to_windows + max(window_proba)` 로 train/eval 정합. no-eligible window (min_events=4 미만) 시 `benign 0.0` 응답 (Codex audit Top 5 #4 해소).

이 변경으로:
- positive simulate (ts spread ~5ms, all events in same window): 60 file × 1 window = 60 sample (변화 없음)
- negative baseline (ts spread 60ms~2.3s): 10 file × {1,2,3} window
- negative spread variants: 27 file × {1,5,30} window = 풍부한 sample
  - 예: rsync_1000_s5s = 5 window × ~200 events each → write_rate 200/s ← positive v3 (~200/s) 와 겹침
  - 예: npm_install_express_s30s = 30 window × ~219 events → write_rate 219/s ← positive v3 와 겹침
- 결과: write_rate 단독으론 분리 불가능해짐 → 모델이 다른 feature 활용 강제

### 2.3 simulate randomization (v2 와 동일 유지)

- count: base ± 20% jitter (v1 240~360, v2 400~600, v3 160~240)
- 파일 사이즈: 512B ~ 256KiB
- 파일명 풀 + dst extension 풀 + write pattern 4종 + op shuffle + --seed (자세한 사항 v2 §2)

### 2.4 학습 후 feature coefficient (honest reporting)

`python-engine/model/train.py` stdout (v3 보강 후):

```
학습 샘플 (window-sliced @ 1000ms, min_events=4):
  positive(v1+v2): 60 windows from 60 files
  negative       : 337 windows from 37 files
  total          : 397 samples

classes_: [0 1]  (== [0=benign, 1=ransomware])

feature coefficients:
  write_rate         coef = -0.003128
  rename_rate        coef = -0.003128
  ext_diversity      coef = +0.006643
  size_mean          coef = +0.000604
  size_std           coef = -0.000410
  pid_fanout         coef = -0.006090
  intercept = -15.0810

train accuracy: 1.0000
```

**v3 ↔ v2 비교**:
| feature | v2 coef | v3 coef | 의미 변화 |
|---|---|---|---|
| write_rate | -0.025672 | -0.003128 | **결정 영향 1/8 로 감소** — slicing 으로 negative rate 분포가 positive 영역 (200~600/s) 까지 확장됨 |
| ext_diversity | -0.000206 | **+0.006643** | **부호 반전** — positive(2) > rsync/unzip(1), npm(많음) 의 중간 영역에서 양의 가중 |
| size_mean | +0.000569 | +0.000604 | 거의 동일 — positive(~130KB random) ↔ negative(8B/80B dummy) 직교성 유지 |
| pid_fanout | -0.000185 | -0.006090 | 영향 약간 증가 |
| intercept | -0.0002 | -15.081 | 기본 logit 이 강하게 benign 쪽으로 이동 — 다수 negative window 학습 결과 |

→ **결론**: window slicing 이 의도대로 작동. write_rate 가 지배 피처에서 보조 피처로 내려옴. 대신 `ext_diversity` (positive 가 일관적으로 2 개) 와 `size_mean` (positive random 130KB ↔ negative tiny dummy) 가 주 결정자.

---

## 3. 평가 결과 (2026-05-23 측정)

### 3.1 Held-out v3 (expect ransomware) — 30 runs

전체 30 run 모두 동일 결과 (`bash scripts/eval-ac5.sh` 출력 첨부):

| n_runs | verdict | proba | n_events range | label |
|---|---|---|---|---|
| 30 / 30 | ransomware | 1.000 (모두) | 330 ~ 478 (count jitter ±20%) | TP × 30 |

대표 라인:
```
v3_run_01.jsonl  ransomware  1.000  448  [TP]
v3_run_15.jsonl  ransomware  1.000  372  [TP]
v3_run_30.jsonl  ransomware  1.000  458  [TP]
```

### 3.2 Negative (expect benign) — 37 files (v3 spread variants 포함)

| 파일 분류 | count | verdict | max_proba | n_events | n_win | label |
|---|---|---|---|---|---|---|
| baseline _run_01 | 10 | benign | 0.000 | 400 ~ 13128 | 1 ~ 3 | TN × 10 |
| rsync spread variants (1/5/30s) | 12 | benign | 0.000 | 600 ~ 4000 | 1 ~ 30 | TN × 12 |
| unzip spread variants (1/5/30s) | 12 | benign | 0.000 | 400 ~ 4000 | 1 ~ 30 | TN × 12 |
| npm_install spread variants | 3 | benign | 0.000 | 13128 | 1 ~ 30 | TN × 3 |

전체 37 file 모두 모든 window 의 proba=0.000 → max_proba=0.000.

### 3.3 합산 + 판정

| 지표 | 값 | 기준 | 결과 |
|---|---|---|---|
| TP / positive | **30 / 30** | ≥ 9 / 10 (3× 초과) | PASS |
| FN / positive | 0 / 30 | — | — |
| FP / negative | **0 / 37** | ≤ 1 / 10 (≈ ≤ 3.7 / 37) | PASS |
| TN / negative | 37 / 37 | — | — |
| **AC5 overall** | — | — | **PASS** |

→ **proba 분포는 v3 보강 (window slicing + spread variants) 후에도 1.000 / 0.000 양극단 유지**. 단, 양극단의 *원인* 이 v2 와 다름 — write_rate 직접 분리에서 size_mean / ext_diversity 직교성으로 이동 (§4.5).

---

## 4. 한계 및 honest interpretation

### 4.1 학습 데이터 분포의 비현실성 (v3 일부 해소)

이전 v2 까지: gen-negative 가 워크로드 events 를 단일 1초 window 로 정규화 → npm 13128/s, rsync 2000/s 같은 비현실적 분포 → write_rate 단독으로 perfect separation.

**v3 변경**: `--spreads 1,5,30` 으로 동일 워크로드를 1/5/30초로 펼친 ts 변형 생성 + train/eval 에서 `slice_to_windows` 로 1s bucket 분할. npm 30s spread = 219 events/s, rsync_1000 5s spread = 200 events/s 같이 positive (200~600/s) 와 겹치는 negative window 가 등장. 모델이 write_rate 만으론 못 풀게 됨.

남은 한계: simulate positive 도 ts spread 5~100ms 로 사실상 단일 window 에 압축됨. positive 의 *내적* 시간 분포는 여전히 비현실적 (실 ransomware 는 파일당 수십 ms ~ 수백 ms 소요). 진짜 1:1 비교는 fanotify 실 trace 캡처 필요.

→ **future work**: simulate 에 per-op sleep 추가 or gen-positive 에서 합성 ts spread 적용. A 의 실 fanotify trace 로 동일 시나리오 재캡처.

### 4.2 합성 PoC 일반화 의문 (AC5c disclaimer 동일)

v1/v2/v3 simulator 모두 [`open`, `truncate`, `write`, `rename`] 패턴만 emit. 실제 ransomware family 는 더 다양한 패턴 (`memory-mapped IO`, `large block write`, `process injection` 등) 사용. 본 모델이 그것을 잡는다는 보장 없음.

→ **future work**: 공개 ransomware corpus (e.g., RanSAP, MalwareBazaar) 의 sandbox trace 로 추가 평가.

### 4.3 v1.1 schema 의 `FileRename` 가정

데이터셋 합성 시 `FileRename + FileWrite` dual emit. 하지만 A 의 실 fanotify collector 는 `FAN_REPORT_DFID_NAME` class 전환 (v1.1 collation 후 deferred) 까지 `FileRename` 미발행. 즉 **실 운영 trace 는 `rename_rate` 가 0 일 수 있음** — 그 경우 LR 의 `rename_rate` coef (-0.024) 가 의미 잃음. write_rate 단독 의존도 증가.

→ **future work**: A 의 FileRename emit 활성화 후 재학습.

### 4.4 데이터셋 크기 (v3 보강 후 갱신)

| 분류 | v1 (초기) | v2 (보강) | v3 (Option D) | 변화 |
|---|---|---|---|---|
| positive 학습 file | 20 | 60 | 60 | v2 = v3 |
| positive 학습 **window** | 20 | 60 | 60 | v2 = v3 (ts spread 5ms 라 슬라이싱돼도 1 window/file) |
| negative 학습 file | 10 | 10 | **37** | 3.7× |
| negative 학습 **window** | 10 | 10 | **337** | 33.7× |
| held-out v3 | 10 | 30 | 30 | v2 = v3 |
| **총 학습 sample** | 30 | 70 | **397** | 13× over v1 |

- **negative file 보강**: 외부 네트워크 워크로드 재실행 회피 정책에 따라 캐시된 `~/velxor-work/*` 디렉토리 재사용 (`--reuse` 플래그). spread 변형 1/5/30s × 워크로드 8종 (gitclone variants 제외 — §2 참고).
- **negative window 33× 증가**: 1s window slicing 으로 30s-spread 1 file → 30 window 가 됨. 다수 저활동 window 가 학습 데이터에 포함.
- **cross-validation 미실시** — stratified k-fold + RandomForest/IsolationForest 비교는 future work (시간 제약).

### 4.5 v3 후에도 proba=1.000/0.000 양극단 — 진짜 원인 (갱신)

v3 보강 (slicing + spread variants) 후에도 양극단 유지. 단 **원인이 v2 와 다름**:

**v2 의 원인 (해소됨)**: write_rate 직선 분리. positive 240~600/s, negative 300~6500/s — 부분 겹쳤지만 npm/rsync2000 꼬리가 평균을 끌어올려 threshold 학습.

**v3 의 원인 (새로 식별)**: 두 class 의 **`size_mean` 직교성**.

| 데이터셋 | per-event `file_size` | window `size_mean` |
|---|---|---|
| positive v1/v2/v3 | random 512B ~ 256KiB | ~130,000 (130KB) |
| negative rsync | `f"dummy-{i}\n"` (8 bytes) | ~8 |
| negative unzip | `f"payload-{i}\n" * 8` (~80 bytes) | ~80 |
| negative gitclone | 실 git blob (다양, 1B ~ MBs) | ~1000~10000 |
| negative npm | 실 node_modules (다양) | ~500~5000 |

LR coef: `size_mean = +0.000604`, `intercept = -15.08`.
- positive window logit ≈ 0.000604 × 130000 - 15.08 ≈ **+63.4** → proba ≈ 1.000
- rsync window logit ≈ 0.000604 × 8 - 15.08 ≈ **-15.07** → proba ≈ 0.000
- npm window logit ≈ 0.000604 × 3000 - 15.08 ≈ **-13.3** → proba ≈ 0.000

**즉 `size_mean` 한 피처만으로 perfect separation 가능**. window slicing 으로 write_rate 가 무력화돼도 size_mean 직교성은 그대로.

**근본 원인**: 합성 데이터셋의 size 분포가 비현실적. 실 환경 ransomware 는 victim 의 다양한 파일 (text, image, binary) 을 암호화 → size 분포는 원본 파일과 동일. 실 환경 benign 워크로드 (백업, 코드 작업) 도 같은 size 분포. PoC 합성에서 positive 만 random 64KB+ 로 채워서 분리됨.

→ **future work**:
1. positive simulator 에 다양한 size 분포 도입 (작은 파일도 포함, 8B ~ 100MB 로그 분포)
2. negative 워크로드를 victim filesystem (사진/문서/코드) 의 실 backup workload 로 재캡처
3. entropy 피처 추가 (positive=random=high, negative dummy=low, real-file=mid) — 단 schema v1.x 의 op_detail 확장 필요
4. RandomForest 로 비선형 결정 경계 학습 (현재 LR 은 size_mean 한 축으로만 분리)

---

## 5. 재현 절차

```bash
cd /path/to/Velxor
bash scripts/setup-venv.sh        # 한 번만 — python-engine/.venv + requirements.lock
bash scripts/eval-ac5.sh          # exit 0 = PASS
```

학습 모델 재발행 시:
```bash
python-engine/.venv/bin/python python-engine/model/train.py
bash scripts/eval-ac5.sh
```

---

## 6. 변경 이력

| 버전 | 일시 | 변경 | 발행자 |
|---|---|---|---|
| v1 | 2026-05-23 | 최초 측정 + AC5 PASS (10/10 TP, 0/10 FP) + honest limitations | C |
| v2 | 2026-05-23 | simulate v1/v2/v3 randomization 보강 (count jitter, 파일명/extension 풀, write pattern 4종, op shuffle). 데이터셋 학습 20→60 + held-out 10→30. **재평가 PASS (30/30 TP, 0/10 FP)** + §4.4/4.5 갱신 — proba 분포 한계는 합성 분포 본질이라 명시 | C |
| v3 | 2026-05-23 | **Option D**: gen-negative `--spreads 1,5,30 --reuse` + features.py `slice_to_windows` + train/eval per-window. negative window 10→337 (33×). **재평가 PASS (30/30 TP, 0/37 FP)** + §2.2 슬라이싱 설계 + §4.5 갱신 — 양극단 proba 원인이 `write_rate` 에서 `size_mean` 직교성으로 이동 식별. | C |
| v3.1 | 2026-05-23 | **CCG audit fix (Codex Top 5)**: app.py 도 `slice_to_windows + max(window_proba)` 적용해 train/serve drift 제거. app.py malformed JSON → 400, events list 검증, `MAX_CONTENT_LENGTH` 강화 (보안). rust-service classifier_client 에 `error_for_status()` 추가 (non-200 verdict 미발행 보장, schema §2.2.1). gen-negative `--reuse` 모드에 `LABEL_EXCLUDE_SUBDIRS={gitclone_express:('node_modules',)}` 적용. test 32→34 (slice + boundary + 보안 케이스). | C |
