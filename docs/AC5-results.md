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
- **artifact**: `python-engine/model/model.pkl` (767 B)
- **학습 입력**:
  - positive: `datasets/positive/v1_run_{01..10}.jsonl` + `v2_run_{01..10}.jsonl` (총 20)
  - negative: `datasets/negative/*.jsonl` (총 10 — rsync × 4, unzip × 4, gitclone × 1, npm × 1)
  - imbalance: 2:1 → `class_weight="balanced"` 보정
- **held-out**: `datasets/heldout/v3/v3_run_{01..10}.jsonl` (학습 절대 미포함)

### 2.1 학습 후 feature coefficient (honest reporting)

`python-engine/model/train.py` stdout 그대로:

```
classes_: [0 1]  (== [0=benign, 1=ransomware])

feature coefficients:
  write_rate         coef = -0.023976
  rename_rate        coef = -0.023976
  ext_diversity      coef = -0.000187
  size_mean          coef = +0.001644
  size_std           coef = -0.000682
  pid_fanout         coef = -0.000168
  intercept                 -0.0002

train accuracy: 1.0000
```

- `write_rate` / `rename_rate` 가 음수 coef — **본 데이터셋 분포에서는 "rate 가 낮을수록 ransomware"** 로 학습됨. 학습 평균 (X mean = 743/s) 가 negative bursty 워크로드(npm install, rsync 2000 등) 가 합성상 매우 큰 rate 를 만들어내기 때문. §4 한계 참조.

---

## 3. 평가 결과 (2026-05-23 측정)

### 3.1 Held-out v3 (expect ransomware)

| file | verdict | proba | n_events | label |
|---|---|---|---|---|
| v3_run_01.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_02.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_03.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_04.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_05.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_06.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_07.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_08.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_09.jsonl | ransomware | 1.000 | 400 | TP |
| v3_run_10.jsonl | ransomware | 1.000 | 400 | TP |

### 3.2 Negative (expect benign)

| file | verdict | proba | n_events | label |
|---|---|---|---|---|
| gitclone_express_run_01.jsonl | benign | 0.000 | 484 | TN |
| npm_install_express_run_01.jsonl | benign | 0.000 | 13128 | TN |
| rsync_1000_run_01.jsonl | benign | 0.000 | 2000 | TN |
| rsync_2000_run_01.jsonl | benign | 0.000 | 4000 | TN |
| rsync_300_run_01.jsonl | benign | 0.000 | 600 | TN |
| rsync_500_run_01.jsonl | benign | 0.000 | 1000 | TN |
| unzip_1000_run_01.jsonl | benign | 0.000 | 2000 | TN |
| unzip_2000_run_01.jsonl | benign | 0.000 | 4000 | TN |
| unzip_200_run_01.jsonl | benign | 0.000 | 400 | TN |
| unzip_500_run_01.jsonl | benign | 0.000 | 1000 | TN |

### 3.3 합산 + 판정

| 지표 | 값 | 기준 | 결과 |
|---|---|---|---|
| TP / positive | **10 / 10** | ≥ 9 / 10 | PASS |
| FN / positive | 0 / 10 | — | — |
| FP / negative | **0 / 10** | ≤ 1 / 10 | PASS |
| TN / negative | 10 / 10 | — | — |
| **AC5 overall** | — | — | **PASS** |

proba 분포가 1.000 / 0.000 양극단인 점은 학습 분포가 두 클래스 사이 큰 마진을 갖는 결과 (§4.1). 사후 보정 / 임계값 조정 없이 0.5 threshold 그대로 적용.

---

## 4. 한계 및 honest interpretation

### 4.1 학습 데이터 분포의 비현실성 (가장 큰 한계)

`scripts/gen-negative.py` 가 합성한 negative 워크로드는 각 워크로드의 결과 디렉토리를 walk 한 후 events 를 **모두 단일 1초 window 안에 발생한 것으로** 합성한다 (`features.py` 의 `window_ms = 1000` 정규화). 그 결과:

- npm install (express) → 13,128 events / 1초 → `write_rate ≈ 6500/s`
- rsync 2000 → 4,000 events / 1초 → `write_rate ≈ 2000/s`
- v3 ransomware → 400 events / 1초 → `write_rate ≈ 200/s`

실제 운영 환경에서 npm install 이 1초 안에 13,000 writes 를 만들지는 않는다. 1초 sliding window 안에서는 negative 의 평균 rate 가 ransomware 보다 *낮을 가능성*이 크다. 즉 **LR 의 음수 coef 는 본 데이터셋의 합성 분포에 specific 하며, 실 운영 collector trace 와 분포가 다르면 즉시 깨질 수 있다**.

→ **future work**: A 의 실 fanotify collector 가 동일 워크로드를 1초 sliding window 로 캡처한 trace 로 재학습. AC5-results-v2 발행 시 비교.

### 4.2 합성 PoC 일반화 의문 (AC5c disclaimer 동일)

v1/v2/v3 simulator 모두 [`open`, `truncate`, `write`, `rename`] 패턴만 emit. 실제 ransomware family 는 더 다양한 패턴 (`memory-mapped IO`, `large block write`, `process injection` 등) 사용. 본 모델이 그것을 잡는다는 보장 없음.

→ **future work**: 공개 ransomware corpus (e.g., RanSAP, MalwareBazaar) 의 sandbox trace 로 추가 평가.

### 4.3 v1.1 schema 의 `FileRename` 가정

데이터셋 합성 시 `FileRename + FileWrite` dual emit. 하지만 A 의 실 fanotify collector 는 `FAN_REPORT_DFID_NAME` class 전환 (v1.1 collation 후 deferred) 까지 `FileRename` 미발행. 즉 **실 운영 trace 는 `rename_rate` 가 0 일 수 있음** — 그 경우 LR 의 `rename_rate` coef (-0.024) 가 의미 잃음. write_rate 단독 의존도 증가.

→ **future work**: A 의 FileRename emit 활성화 후 재학습.

### 4.4 데이터셋 크기

학습 30 샘플 + held-out 10 샘플 — 통계적으로 매우 작음. 본 모델은 시연/평가 데모급. cross-validation 없음.

→ **future work**: 변형 시드 별로 100+ runs 확보 후 stratified k-fold.

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
