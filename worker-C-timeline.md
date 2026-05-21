# 작업자 C — 타임라인 최적화 실행 플랜 (Copy-Paste Runnable)

> **목적**: 이 문서 하나만 위에서 아래로 따라가면 작업자 C의 ~40h 분량(Python 분석 엔진 + 합성 PoC + AC2/AC4/AC5 측정 + 발표 슬라이드)이 그대로 진행된다.
> **선행 문서**: [`worker-C-tasks.md`](./worker-C-tasks.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md), [`ENVIRONMENT.md`](./ENVIRONMENT.md)
> **브랜치**: `devC` (모든 PR은 `devC → main`)
> **OS 가정**: Windows 10 build 19045 또는 Windows 11 build 22631 VM, Git Bash 또는 WSL2 쉘
> **Python**: 3.11.x (3.11.9 권장)

---

## 0. 시작 전 단 한 번만 확인 (5분)

```bash
# 0-A. 저장소 클론 + devC 브랜치 진입
cd ~ && git clone <REPO_URL> Velxor && cd Velxor
git checkout -b devC origin/main || git checkout devC

# 0-B. 버전 락 검증 (ENVIRONMENT.md §5 일부)
python --version              # 3.11.x 기대
node --version                # v20.x 기대 (UI 합동 디버깅용)
git --version                 # 2.43+ 기대
bash --version                # 5.x 기대
```

> 어느 하나라도 어긋나면 **여기서 중단**하고 `ENVIRONMENT.md §6` 절차로 버전 맞춘 후 재진입.

---

## 1. Week 0 — 환경 셋업 (목표: 2h, 학기 시작 ≥1주 전 주말)

### 1.1 가상환경 + 의존성
```bash
mkdir -p python-engine && cd python-engine

python -m venv .venv
# Git Bash
source .venv/Scripts/activate
# (WSL/Linux면: source .venv/bin/activate)

pip install --upgrade pip
pip install "flask==3.0.*" "waitress==3.0.*" "numpy==1.26.*"
pip freeze > requirements.txt
```

### 1.2 `app.py` — `/health` 200 골격
`python-engine/app.py`:
```python
from flask import Flask, jsonify

app = Flask(__name__)

@app.get("/health")
def health():
    return jsonify(status="ok"), 200
```

### 1.3 `waitress_conf.py` — Waitress threads=4
`python-engine/waitress_conf.py`:
```python
from waitress import serve
from app import app

if __name__ == "__main__":
    serve(app, host="127.0.0.1", port=8765, threads=4)
```

### 1.4 Week 0 검증 게이트
```bash
python waitress_conf.py &
SERVER_PID=$!
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/health   # 200 기대
kill $SERVER_PID

python -c "import waitress; print(waitress.__version__)"                  # 3.x
```

### 1.5 커밋
```bash
cd .. && git add python-engine/ && git commit -m "C: week0 venv + flask /health + waitress threads=4"
git push -u origin devC
```

> **Done when**: curl `/health` → 200, Waitress 3.x 출력, push 성공.

---

## 2. Week 1 — Walking Skeleton (목표: 5h)

> **AC1 공동 책임**: `run-all.sh` exit 0 + `ws-record.sh` 캡처에 `node_add{event_type:"FileWrite"}` 확인. C는 engine 측을 책임.

### 2.1 `app.py`에 stub `/classify` 추가
```python
import os
from flask import Flask, jsonify, request

app = Flask(__name__)

VELXOR_STUB = os.getenv("VELXOR_STUB", "")
MODEL_VERSION = "stub-v1" if VELXOR_STUB == "engine" else "rule-based-v1"

@app.get("/health")
def health():
    return jsonify(status="ok", model_version=MODEL_VERSION), 200

@app.post("/classify")
def classify():
    _ = request.get_json(silent=True) or {}
    # Week 1 하드코드 응답 — Week 6+에 실제 모델/규칙으로 교체
    return jsonify(
        verdict="ransomware",
        confidence=0.95,
        evidence=["stub: hardcoded for walking-skeleton-v1"],
        model_version=MODEL_VERSION,
    ), 200
```

### 2.2 `fallback_rules.py` — 골격 (Week 6에 본구현)
`python-engine/fallback_rules.py`:
```python
"""Rule-based fallback. /classify가 학습 모델 미달 시 영속 백업.
입력: events list of {event_type, ts_unix_ms, ...}, window_ms
출력: dict {verdict, confidence, evidence, model_version}
"""
from collections import Counter

MODEL_VERSION = "rule-based-v1"

def classify_events(events: list[dict], window_ms: int) -> dict:
    counts = Counter(e.get("event_type") for e in events)
    writes = counts.get("FileWrite", 0)
    window_s = max(window_ms / 1000.0, 1e-9)
    write_rate = writes / window_s

    if write_rate >= 50:
        return {
            "verdict": "ransomware",
            "confidence": 0.9,
            "evidence": [f"write_rate={write_rate:.1f}/s >= 50"],
            "model_version": MODEL_VERSION,
        }
    return {
        "verdict": "benign",
        "confidence": 0.6,
        "evidence": [f"write_rate={write_rate:.1f}/s"],
        "model_version": MODEL_VERSION,
    }
```

### 2.3 Schema v1-draft mechanical ack
- B가 `contracts/interface-schema.md` 발행 알림이 오면, 그 PR에 **한 줄 코멘트**로 "compiles-against-engine: OK" 또는 컴파일 가능 여부만 응답. (의미 검토는 Week 3.)

### 2.4 Week 1 검증 게이트
```bash
cd python-engine && source .venv/Scripts/activate
VELXOR_STUB=engine python waitress_conf.py &
SERVER_PID=$!
sleep 1

curl -s -X POST http://127.0.0.1:8765/classify \
  -H "Content-Type: application/json" \
  -d '{"events":[],"window_ms":1000}' | tee /tmp/classify-stub.json
# 기대: verdict=ransomware confidence=0.95 model_version=stub-v1

kill $SERVER_PID
```

루트에서 `scripts/run-all.sh` 통과 (B 주관) + `ws-record.sh` 캡처 확인 후 **AC1 통과 태그**는 B가 push:
```bash
git tag walking-skeleton-v1   # B가 push, C는 fetch만
```

### 2.5 커밋
```bash
git add python-engine/{app.py,fallback_rules.py}
git commit -m "C: week1 /classify stub + fallback_rules skeleton (VELXOR_STUB=engine)"
git push
```

> **Done when**: `VELXOR_STUB=engine` 모드에서 `/classify`가 하드코드 verdict 반환, AC1 tag fetch 성공.

---

## 3. Week 2 — 사전 작업 (선택, 1h)

> Week 4-5는 A 중심 통합 주간으로 C는 0h 배정. **이 여유를 Week 6-7 부하 완화에 미리 쓰는 게 안전**.

권장 Week 2 보너스:
- `poc-samples/ransomware_simulator/v1/` 디렉토리 골격만 생성 (코드는 비워둠)
- `datasets/{positive,negative}/.gitkeep` placeholder

```bash
mkdir -p poc-samples/ransomware_simulator/{v1,v2,v3}
mkdir -p datasets/{positive,negative}
touch datasets/positive/.gitkeep datasets/negative/.gitkeep
git add poc-samples datasets && git commit -m "C: week2 PoC/dataset directory scaffolds" && git push
```

---

## 4. Week 3 — v1.1 Schema Review 노트 1개 (목표: 1h, **48h 데드라인**)

B가 v1.1 review 트리거를 보내는 순간부터 **48시간 카운트다운 시작**. 무응답 시 B 단독 발행.

### 4.1 Python/모델 관점 체크리스트
다음 중 **최소 1개**를 PR 코멘트로 제출:
- [ ] `req.events[]` 안에 모델 학습이 의존하는 필드(예: `op_detail.entropy_hint`, `file_size`)가 누락 또는 wrong-typed인가?
- [ ] `window_ms` 의미 — sliding window 시작/끝 기준이 명확한가? (학습 데이터 생성 시 동일 의미 보장 필요)
- [ ] `resp.evidence[]` string 배열로 충분한가, 아니면 (k, v) typed 객체가 필요한가? (UI 패널 표시 vs 모델 디버깅)
- [ ] `model_version` 문자열 포맷 컨벤션 (예: `rule-based-v1`, `xgb-2026w7-r3`) 명시 부재?
- [ ] 응답 시간 SLA(p99<100ms)가 명시되어 있는가? — Waitress threads=4 sub-budget

### 4.2 코멘트 템플릿
```text
[C / Python engine review]
Issue: <필드명 또는 동작>
Why: <학습/추론/측정에 미치는 영향 1줄>
Proposed (additive only): <새 optional field 또는 명세 추가>
```

> ⚠️ **반드시 1개는 제출**. 무응답은 발언권 포기로 간주됨 (consensus-plan Principle 4).

```bash
# 코멘트만 작성하면 끝. 코드 변경 없음.
```

---

## 5. Week 4-5 — 휴식 또는 PoC 사전 작업 (목표: 0-3h)

C는 공식 0h. 단, Week 6-7이 22h 단일 블록이라 **PoC v1 시뮬레이터 스크립트만 미리 골격 작성**해두면 안전.

### 5.1 PoC v1 simulator 스켈레톤
`poc-samples/ransomware_simulator/v1/simulate.py`:
```python
"""PoC v1: .docx → .docx.enc rename + 32B prefix write, target 300 files/1s.
Usage: python simulate.py <target_dir> [--count 300]
"""
import argparse, os, secrets, time
from pathlib import Path

def run(target_dir: Path, count: int):
    target_dir.mkdir(parents=True, exist_ok=True)
    # 사전 생성: .docx 파일 N개 준비
    for i in range(count):
        (target_dir / f"doc_{i:04d}.docx").write_bytes(b"DUMMYDOC" * 16)

    t0 = time.perf_counter()
    for i in range(count):
        src = target_dir / f"doc_{i:04d}.docx"
        dst = target_dir / f"doc_{i:04d}.docx.enc"
        os.replace(src, dst)              # rename
        with open(dst, "r+b") as f:
            f.write(secrets.token_bytes(32))  # 32B prefix overwrite
    elapsed = time.perf_counter() - t0
    print(f"v1: {count} ops in {elapsed*1000:.1f} ms ({count/elapsed:.0f} ops/s)")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=300)
    args = p.parse_args()
    run(args.target_dir, args.count)
```

```bash
git add poc-samples/ransomware_simulator/v1/simulate.py
git commit -m "C: week4-5 PoC v1 simulator skeleton (.docx -> .docx.enc, 300 files/1s)"
git push
```

---

## 6. Week 6-7 — PoC + 데이터셋 + 학습 (목표: 22h, **최대 부하 구간**)

> ⚠️ **이 구간이 C의 전체 일정에서 가장 큰 블록**. 아래 6단계를 **순서대로** 진행. 각 단계는 독립 PR로 분리해도 좋다.

### 6.1 [Day 1-2, 4h] PoC v1 본구현 + AC2 검증
- 5.1의 `simulate.py`를 그대로 사용 (이미 작성됨).
- 추가: `scripts/poc-bench.sh` 작성.

`scripts/poc-bench.sh`:
```bash
#!/usr/bin/env bash
# AC2: 300 file ops wall-clock < 1s
set -euo pipefail

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

START_MS=$(python -c "import time; print(int(time.time()*1000))")
python poc-samples/ransomware_simulator/v1/simulate.py "$TMP" --count 300
END_MS=$(python -c "import time; print(int(time.time()*1000))")

ELAPSED=$((END_MS - START_MS))
echo "AC2 wall-clock: ${ELAPSED} ms"
if [ "$ELAPSED" -lt 1000 ]; then
  echo "AC2 PASS"
  exit 0
else
  echo "AC2 FAIL (>=1000ms)"
  exit 1
fi
```

```bash
chmod +x scripts/poc-bench.sh
./scripts/poc-bench.sh        # → AC2 PASS 기대
```

### 6.2 [Day 2, 3h] PoC v2 + v3 variants
`poc-samples/ransomware_simulator/v2/simulate.py`: v1과 동일 패턴, `.txt → .crypted`, 500 files/0.8s.
`poc-samples/ransomware_simulator/v3/simulate.py`: `.pdf → .locked`, 200 files/2s. **held-out (학습 금지)**.

v2/v3 작성 가이드: 5.1 코드에서 다음 3개만 변경.
- 확장자 pair (`.txt`/`.crypted`, `.pdf`/`.locked`)
- count + 목표 elapsed
- prefix write 바이트 수 (선택)

> 🚫 **v3는 절대 학습 데이터에 포함되지 않게 디렉토리 격리**: `datasets/positive/` 안에 v3 로그를 절대 두지 않는다. v3 출력은 `datasets/heldout/v3/`로.

### 6.3 [Day 3, 3h] Positive 데이터셋 생성기
`scripts/gen-positive.py` (또는 inline shell):
```python
"""v1+v2 → datasets/positive/, v3 → datasets/heldout/v3/. 각 실행이 BehaviorEvent JSONL 1줄/이벤트."""
import json, time, uuid
from pathlib import Path

def emit(events, out_path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")

# v1/v2/v3 simulate를 호출하면서 동시에 FileWrite/FileRename 이벤트를 합성 emit.
# 실제 driver 없이 데이터셋만 만들 때는 simulate 직후 디렉토리 스캔 결과를 timestamp와 함께 기록.
```

각 PoC variant 1회 실행 → JSONL 1개 산출 → 10회 실행 → variant당 10개 sample.
- `datasets/positive/v1_run_{01..10}.jsonl`
- `datasets/positive/v2_run_{01..10}.jsonl`
- `datasets/heldout/v3/v3_run_{01..10}.jsonl`

### 6.4 [Day 4, 3h] AC5b Negative 데이터셋 (bursty-benign)
```bash
mkdir -p datasets/negative
# Case 1: robocopy /MIR (Windows 한정, VM 안에서 실행)
robocopy "C:\src" "C:\dst" /MIR /LOG:datasets/negative/robocopy_run_01.log

# Case 2: 7zip 압축 해제
7z x sample.zip -o"./tmp_extract" > datasets/negative/7zip_run_01.log
```
→ negative 샘플 ≥10개 확보. 합성 PoC와 동일한 JSONL 포맷으로 변환하는 `scripts/log-to-events.py` 작성.

### 6.5 [Day 5-6, 6h] `features.py` 본구현
`python-engine/features.py`:
```python
"""행위 윈도우 통계 추출.
입력: events list[dict], window_ms
출력: dict feature vector (numpy 호환)
"""
from collections import Counter
import numpy as np

def extract(events: list[dict], window_ms: int) -> dict:
    if not events:
        return _zero_vector()

    types = Counter(e.get("event_type") for e in events)
    exts = Counter(_ext(e.get("file_path")) for e in events if e.get("file_path"))
    sizes = [_size(e) for e in events if _size(e) is not None]
    pids = Counter(e.get("pid") for e in events)

    w_s = max(window_ms / 1000.0, 1e-9)
    return {
        "write_rate":    types.get("FileWrite", 0) / w_s,
        "rename_rate":   types.get("FileRename", 0) / w_s,
        "ext_diversity": len(exts),
        "size_mean":     float(np.mean(sizes)) if sizes else 0.0,
        "size_std":      float(np.std(sizes))  if sizes else 0.0,
        "pid_fanout":    len(pids),
    }

def _ext(p):
    if not p: return None
    return p.rsplit(".", 1)[-1].lower() if "." in p else ""

def _size(e):
    od = e.get("op_detail") or {}
    return od.get("file_size")

def _zero_vector():
    return {k: 0.0 for k in
            ("write_rate","rename_rate","ext_diversity","size_mean","size_std","pid_fanout")}
```

### 6.6 [Day 7, 3h] 모델 학습 + `/classify` 본구현
의사 코드 (구체 알고리즘은 본인 선택; logistic regression 또는 RandomForest 권장 — 학습 빠르고 p99 budget 여유).

`python-engine/model/train.py`:
```python
"""v1+v2 학습, v3+negatives는 평가용으로 분리."""
import json, glob, pickle
import numpy as np
from sklearn.linear_model import LogisticRegression
from features import extract

WINDOW_MS = 1000
X, y = [], []

for path in glob.glob("datasets/positive/v[12]_*.jsonl"):
    events = [json.loads(l) for l in open(path)]
    X.append(list(extract(events, WINDOW_MS).values()))
    y.append(1)

for path in glob.glob("datasets/negative/*.jsonl"):
    events = [json.loads(l) for l in open(path)]
    X.append(list(extract(events, WINDOW_MS).values()))
    y.append(0)

clf = LogisticRegression(max_iter=1000).fit(np.array(X), np.array(y))
with open("python-engine/model/model.pkl", "wb") as f:
    pickle.dump(clf, f)
print("trained, n_samples =", len(y))
```

`app.py`의 `/classify`를 모델 + fallback 라우팅으로 교체:
```python
import pickle, time
from features import extract
from fallback_rules import classify_events as rule_classify

try:
    with open("python-engine/model/model.pkl", "rb") as f:
        _MODEL = pickle.load(f)
    MODEL_VERSION = "lr-2026w7"
except FileNotFoundError:
    _MODEL = None
    MODEL_VERSION = "rule-based-v1"  # 영속 fallback

@app.post("/classify")
def classify():
    body = request.get_json(silent=True) or {}
    events = body.get("events", [])
    window_ms = int(body.get("window_ms", 1000))

    if os.getenv("VELXOR_STUB") == "engine" or _MODEL is None:
        return jsonify(**rule_classify(events, window_ms)), 200

    feats = list(extract(events, window_ms).values())
    proba = float(_MODEL.predict_proba([feats])[0][1])
    verdict = "ransomware" if proba >= 0.5 else "benign"
    return jsonify(
        verdict=verdict,
        confidence=proba if verdict == "ransomware" else 1 - proba,
        evidence=[f"lr_proba={proba:.3f}"],
        model_version=MODEL_VERSION,
    ), 200
```

### 6.7 [Day 7, 1h] /classify p99 < 100ms 자체 측정
```bash
# 간단 부하: 100회 요청 후 정렬 99번째
python - <<'PY'
import time, requests, json, statistics
payload = {"events": [{"event_type":"FileWrite","ts_unix_ms":i} for i in range(300)], "window_ms": 1000}
lat = []
for _ in range(100):
    t0 = time.perf_counter()
    r = requests.post("http://127.0.0.1:8765/classify", json=payload, timeout=2)
    lat.append((time.perf_counter()-t0)*1000)
lat.sort()
print(f"p50={lat[50]:.1f}ms  p99={lat[99]:.1f}ms")
PY
```
- **p99 < 100ms PASS** → 그대로 진행.
- **p99 >= 100ms FAIL** → 즉시 `_MODEL = None` (또는 `VELXOR_STUB=engine`) 영속 + `MODEL_VERSION="rule-based-v1"` 표시. **임계값 완화 금지**.

### 6.8 커밋 마일스톤
```bash
git add poc-samples scripts/poc-bench.sh scripts/gen-positive.py scripts/log-to-events.py \
        python-engine/{features.py,fallback_rules.py,app.py} python-engine/model/
git commit -m "C: week6-7 PoC v1/v2/v3 + datasets + features + model + AC2 bench"
git push
git tag ac5-baseline                       # 의미 단위 tag
git push --tags
```

> **Done when**: `poc-bench.sh` PASS + `/classify` p99 < 100ms (또는 fallback 영속) + v1/v2 positive 10개씩, v3 held-out 10개, negative 10개 이상 확보.

---

## 7. Week 8-9 — 통합 + AC4/AC5 측정 (목표: 8h)

### 7.1 `scripts/eval-ac5.sh` — TP/FP 평가
`scripts/eval-ac5.sh`:
```bash
#!/usr/bin/env bash
# AC5: held-out v3 10개 + negative 10개 → TP >= 9/10, FP <= 1/10
set -euo pipefail

ENGINE=http://127.0.0.1:8765/classify
TP=0; FP=0; FN=0; TN=0

for f in datasets/heldout/v3/*.jsonl; do
  EVENTS=$(jq -s '.' "$f")
  V=$(curl -s -X POST "$ENGINE" -H "Content-Type: application/json" \
        -d "{\"events\":${EVENTS},\"window_ms\":2000}" | jq -r .verdict)
  [ "$V" = "ransomware" ] && TP=$((TP+1)) || FN=$((FN+1))
done

for f in datasets/negative/*.jsonl; do
  EVENTS=$(jq -s '.' "$f")
  V=$(curl -s -X POST "$ENGINE" -H "Content-Type: application/json" \
        -d "{\"events\":${EVENTS},\"window_ms\":2000}" | jq -r .verdict)
  [ "$V" = "ransomware" ] && FP=$((FP+1)) || TN=$((TN+1))
done

echo "TP=$TP FN=$FN  FP=$FP TN=$TN"
[ "$TP" -ge 9 ] && [ "$FP" -le 1 ] && { echo "AC5 PASS"; exit 0; }
echo "AC5 FAIL (do NOT relax thresholds — record as-is per AC5 policy)"; exit 1
```

### 7.2 `docs/AC5-results.md` 작성
```bash
mkdir -p docs
./scripts/eval-ac5.sh | tee /tmp/ac5.out
cat > docs/AC5-results.md <<EOF
# AC5 Results (held-out v3 + bursty-benign negatives)

- Evaluated: $(date -Iseconds)
- Model version: $(curl -s http://127.0.0.1:8765/health | jq -r .model_version)
- Threshold policy: NO relaxation. Held-out v3 (.pdf → .locked) excluded from training.

## Outcome
\`\`\`
$(cat /tmp/ac5.out)
\`\`\`

## AC5a — held-out variant
v3 = .pdf → .locked, 200 files/2s, **not in training set**.

## AC5b — bursty-benign negatives
robocopy /MIR, 7zip 압축 해제 로그.

## AC5c — disclaimer
**Evaluated on synthetic PoC, not real-world malware.**
EOF
git add docs/AC5-results.md scripts/eval-ac5.sh
git commit -m "C: week8-9 AC5 eval script + AC5-results.md (honest reporting)"
git push
```

### 7.3 `scripts/eval-ac4.sh` — Rust tracing JSON → p99
B가 emit한 `tracing` JSON 파일(`rust-service/logs/trace-*.json` 또는 stdout) 가정.

`scripts/eval-ac4.sh`:
```bash
#!/usr/bin/env bash
# AC4: event_received_ts → ws_sent_ts p99 < 1000ms, classify p99 < 100ms
set -euo pipefail
LOG="${1:-rust-service/logs/trace.json}"

python - "$LOG" <<'PY'
import json, sys, statistics
path = sys.argv[1]
e2w, classify = [], []
with open(path) as f:
    for line in f:
        try: r = json.loads(line)
        except: continue
        if "event_received_ts" in r and "ws_sent_ts" in r:
            e2w.append(r["ws_sent_ts"] - r["event_received_ts"])
        if "classify_start_ts" in r and "classify_end_ts" in r:
            classify.append(r["classify_end_ts"] - r["classify_start_ts"])

def p99(xs): xs = sorted(xs); return xs[int(len(xs)*0.99) - 1] if xs else float("nan")
print(f"event→ws  p99 = {p99(e2w):.1f} ms  (target < 1000 ms)")
print(f"classify  p99 = {p99(classify):.1f} ms  (target < 100 ms)")
PY
```

```bash
chmod +x scripts/eval-ac4.sh
./scripts/eval-ac4.sh rust-service/logs/trace.json
git add scripts/eval-ac4.sh && git commit -m "C: week8-9 AC4 eval script (tracing JSON p99)" && git push
```

### 7.4 AC8 stub smoke (C 담당 = engine 모드)
```bash
VELXOR_STUB=engine python -m waitress_conf &
sleep 1
curl -s http://127.0.0.1:8765/health | jq .              # model_version=rule-based-v1 또는 stub-v1
curl -s -X POST http://127.0.0.1:8765/classify -d '{}' -H 'Content-Type: application/json' | jq .
# → 항상 200 + verdict 채워짐. 미달 시 fix.
```

### 7.5 리허설 3회 참여
B 주관. C는 `REHEARSAL-LOG.md`에 자기 섹션(엔진 응답 시간, fallback 동작 여부) 기록.

> **Done when**: `eval-ac5.sh` 출력 + `AC5-results.md` 커밋, `eval-ac4.sh` 출력 정상, `VELXOR_STUB=engine` 단독 smoke pass.

---

## 8. Week 10 — 발표 (목표: 2h)

### 8.1 슬라이드 — 데이터 전략 + AC5 결과 페이지
필수 포함:
- 합성 PoC v1/v2 (학습) vs v3 (held-out) 분리도
- robocopy/7zip negative 워크로드 라벨
- `docs/AC5-results.md` 표 그대로 캡처
- **AC5c disclaimer 굵게**: *"Evaluated on synthetic PoC, not real-world malware. Real-world testing is future work."*

### 8.2 (선택) 백업 시연 영상 — Deferral #4
시간 부족 시 **이게 가장 먼저 잘리는 항목**. 본 데모가 라이브로 잘 돌면 skip.

### 8.3 최종 커밋
```bash
git add docs/slides/c-section.pdf docs/slides/c-section.md
git commit -m "C: week10 presentation slides (data strategy + AC5 + disclaimer)"
git push
```

---

## 9. 결정적 책임 5개 (절대 잊지 말 것)

| # | 책임 | 위반 시 결과 |
|---|------|-------------|
| 1 | `/classify` p99 < 100ms — 미달 시 즉시 `fallback_rules.py` 영속 + `model_version: "rule-based-v1"` | AC4 sub-budget 위반 |
| 2 | AC5 정확도(TP≥9/10, FP≤1/10)는 **honest reporting**. 임계값 완화 금지 | 발표 신뢰도 붕괴 |
| 3 | held-out v3(.pdf→.locked)는 **학습 데이터에 절대 포함 X** | AC5a 무효화 |
| 4 | AC5c disclaimer를 발표 슬라이드에 반드시 기재 | Q&A에서 즉사 |
| 5 | `VELXOR_STUB=engine` 모드가 항상 동작 — A/B 지연되어도 엔진은 단독 생존 | AC8 위반, 데모 fallback 불가 |

---

## 10. 산출물 체크리스트 (최종 푸시 전)

```
Velxor/
├── python-engine/
│   ├── app.py                        ✅
│   ├── waitress_conf.py              ✅
│   ├── features.py                   ✅
│   ├── fallback_rules.py             ✅
│   ├── requirements.txt              ✅
│   └── model/model.pkl               ✅ (또는 부재 시 rule-based 영속)
├── poc-samples/ransomware_simulator/
│   ├── v1/simulate.py                ✅
│   ├── v2/simulate.py                ✅
│   └── v3/simulate.py                ✅ (held-out)
├── datasets/
│   ├── positive/v[12]_run_*.jsonl    ✅ (각 10개)
│   ├── heldout/v3/v3_run_*.jsonl     ✅ (10개)
│   └── negative/{robocopy,7zip}_*    ✅ (≥10개)
├── scripts/
│   ├── poc-bench.sh                  ✅ AC2
│   ├── eval-ac4.sh                   ✅ AC4
│   └── eval-ac5.sh                   ✅ AC5
└── docs/
    └── AC5-results.md                ✅ AC5c disclaimer 포함
```

---

## 11. 시간 예산 vs 실제 추적 (자체 ledger)

이 표를 매주 갱신:

| Week | 예산(h) | 실제(h) | 누적(h) | 산출물 태그 |
|------|---------|---------|---------|------------|
| 0    | 2       |         |         | `/health` 200 |
| 1    | 5       |         |         | `walking-skeleton-v1` (B push) |
| 2-3  | 1       |         |         | v1.1 review 노트 |
| 4-5  | 0-3     |         |         | (선택) PoC v1 스켈레톤 |
| 6-7  | 22      |         |         | `ac5-baseline` |
| 8-9  | 8       |         |         | `AC5-results.md` |
| 10   | 2       |         |         | slides |
| **합계** | **~40** | | | |

> 누적 hours > 1.15 × 40 = 46h 도달 시 즉시 deferral order 발동: 시연 영상(Deferral #4) → 모델 튜닝 단순화 → fallback 영속.

---

## 12. 트러블슈팅 빠른 참조

| 증상 | 원인 후보 | 즉시 조치 |
|------|-----------|-----------|
| `/health` 200 안 옴 | Waitress 미설치 / 포트 충돌 | `pip show waitress`, `netstat -ano \| grep 8765` |
| `/classify` 503 | 모델 pickle 깨짐 | `_MODEL=None` 강제 → rule-based 영속 |
| p99 > 100ms | 모델 추론 느림 / threads=4 미적용 | `serve(..., threads=4)` 확인, 모델을 logistic으로 단순화 |
| AC5 TP<9 | held-out v3 변형이 학습 분포 밖 | **임계값 완화 금지**. 결과 그대로 슬라이드 |
| AC5 FP>1 | robocopy burst가 write_rate 트리거 | features에 `pid_fanout`, `ext_diversity` 가중 (학습 데이터에 negative 추가) |
| `VELXOR_STUB=engine` 무효 | env 우선순위 무시 | `app.py` 최상단 `os.getenv` 분기 확인 |

---

## 끝 — 이 문서대로 위에서 아래로만 진행하면 ~40h 안에 작업자 C의 모든 책임이 완료된다.
