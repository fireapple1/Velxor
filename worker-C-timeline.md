# 작업자 C — 타임라인 최적화 실행 플랜 (Copy-Paste Runnable)

> **목적**: 이 문서 하나만 위에서 아래로 따라가면 작업자 C의 ~40h 분량(Python 분석 엔진 + 합성 PoC + AC2/AC4/AC5 측정 + 발표 슬라이드)이 그대로 진행된다.
> **선행 문서**: [`worker-C-tasks.md`](./worker-C-tasks.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md), [`ENVIRONMENT.md`](./ENVIRONMENT.md)
> **브랜치**: `devC` (모든 PR은 `devC → main`)
> **OS 가정**: **Ubuntu 24.04 LTS** (bare-metal 또는 VM), native `/usr/bin/bash` 5.2.
>  22.04로 다운그레이드 시 [`ENVIRONMENT.md`](./ENVIRONMENT.md) §2.1 deadsnakes PPA·apt 버전 표 별도 검증.
> **Python**: 3.11.x (3.11.9 권장) — Ubuntu 24.04 기본은 3.12 → **pyenv 또는 deadsnakes PPA**로 3.11 격리. 본 문서의 모든 `python` 명령은 venv 활성화 후 사용하거나 명시적으로 `python3.11`을 쓴다.

---

## 0. 시작 전 단 한 번만 확인 (5분)

```bash
# 0-A. 저장소 클론 + devC 브랜치 진입
mkdir -p ~/src && cd ~/src
git clone <REPO_URL> Velxor && cd Velxor
git checkout -b devC origin/main || git checkout devC

# 0-B. apt baseline 한 번에 설치 (sudo 권한 필요)
sudo apt update && sudo apt install -y \
  build-essential clang pkg-config libssl-dev \
  git curl jq rsync unzip p7zip-full

# 0-C. Python 3.11 확보 (pyenv 또는 deadsnakes — ENVIRONMENT.md §2.1)
python3.11 --version          # Python 3.11.x 기대
node --version                # v20.x 기대 (UI 합동 디버깅용; nvm 권장)
git --version                 # 2.43+ 기대
/usr/bin/bash --version       # 5.2.x (24.04) 또는 5.1.x (22.04)

# 0-D. 추가 시스템 체크
locale -a | grep -E 'en_US.utf8|C.UTF-8' || sudo locale-gen en_US.UTF-8
cat /proc/sys/fs/inotify/max_user_watches   # ≥ 8192 권장 (UI/IDE와 공유)
```

> 어느 하나라도 어긋나면 **여기서 중단**하고 [`ENVIRONMENT.md §6`](./ENVIRONMENT.md)·§2.1 절차로 버전 맞춘 후 재진입.
>
> *(체크리스트)* `locale -a`로 UTF-8 locale을 확인하고, `ulimit -n`(open files)·`fs.inotify.max_user_watches`를 점검하면 이후 UI·collector(A 영역) 동시 가동 시 watch 한계 누락을 사전 차단할 수 있다.

---

## 1. Week 0 — 환경 셋업 (목표: 2h, 학기 시작 ≥1주 전 주말)

### 1.1 가상환경 + 의존성
```bash
mkdir -p python-engine && cd python-engine

# python3.11 명시 — Ubuntu 24.04 기본 python3는 3.12라 lock 외 버전이 들어옴
python3.11 -m venv .venv
source .venv/bin/activate
python --version              # 활성화 후엔 그냥 python으로 3.11.x 확인 가능

pip install --upgrade pip
pip install "flask==3.0.*" "waitress==3.0.*" "numpy==1.26.*" \
            "scikit-learn==1.4.*" "requests==2.*"
pip freeze > requirements.txt
```

> *(노하우)* Ubuntu native bash에서는 venv 활성화 경로가 `.venv/bin/activate`다. (Windows Git Bash의 `.venv/Scripts/activate`는 사용 안 함.) 활성화 후 `which python`이 `~/src/Velxor/python-engine/.venv/bin/python`을 가리키는지 확인 — 그렇지 않으면 venv가 안 잡힌 상태로 `pip install`이 시스템 site-packages로 흘러간다.
>
> *(왜 python3.11 명시)* Ubuntu 24.04 기본 `python3`는 3.12라 `python3 -m venv`로 만들면 venv가 3.12로 잠긴다. `scikit-learn 1.4.x` 같은 핀 의존성을 3.11에 맞춰 검증했으므로 인터프리터부터 3.11로 고정해야 한다.
>
> *(왜 의존성을 한꺼번에 깔아두나)* `scikit-learn`은 Week 6.6 학습 단계, `requests`는 Week 6.7 p99 자가측정 스크립트에서 import된다. Week 0에 미리 잠가두지 않으면 Week 6의 22h 단일 블록 한복판에서 의존성 설치/버전 충돌로 시간을 잃는다.

### 1.2 `app.py` — `/health` 200 골격
`python-engine/app.py`:
```python
from flask import Flask, jsonify

app = Flask(__name__)

@app.get("/health")
def health():
    return jsonify(status="ok"), 200
```

> *(참조)* `jsonify`는 dict/kwargs → JSON 직렬화 + `Content-Type: application/json` 헤더를 자동 설정한다. 직렬화 옵션·헤더 처리 메커니즘은 Flask 공식 문서의 *Response objects* 절을 참조.

### 1.3 `waitress_conf.py` — Waitress threads=4
`python-engine/waitress_conf.py`:
```python
from waitress import serve
from app import app

if __name__ == "__main__":
    serve(app, host="127.0.0.1", port=8765, threads=4)
```

> *(개념)* Flask 내장 dev 서버는 단일 스레드 동기 처리라 `/classify` 요청 1건이 IO blocking에 들어가면 후속 요청이 줄을 선다. Waitress는 production-grade WSGI 서버로 worker thread pool을 둔다. `threads=4`는 Python GIL 제약 아래에서 IO-blocking 동안 다른 요청을 받기 위한 실용적 최소값으로, AC4의 `/classify p99<100ms` sub-budget을 직선적으로 깎는 첫 번째 손잡이다.
>
> *(Why Waitress on Linux)* Linux에서는 gunicorn(fork model)도 옵션이지만, 원안의 측정 재현성·thread 거동 일관성을 위해 Waitress(cross-platform, thread pool)를 유지한다. 추후 AC4가 fork 기반에서 더 유리하다고 판단되면 별도 PR로 교체.
>
> *(참조)* thread 수·`channel_timeout`·`expose_tracebacks` 같은 추가 튜닝 옵션은 Waitress 공식 문서의 *Arguments to `waitress.serve`* 절을 참조.

### 1.4 Week 0 검증 게이트
```bash
python waitress_conf.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/health   # 200 기대
# trap이 EXIT에서 자동 종료 — 중간 실패 시에도 포트 8765 누수 방지

python -c "import waitress; print(waitress.__version__)"                  # 3.x
```

> *(체크리스트)* 이 curl 한 줄이 통과되면 `웹 서버 부팅 → 포트 바인딩 → HTTP 파싱 → Flask 라우팅 → jsonify 응답` 전체 파이프라인이 살아있다는 것이 확인된다. `-f`는 4xx/5xx에서도 exit 0이 되는 함정을 막는다.

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

> *(개념)* `VELXOR_STUB=engine`은 작업자 A(Rust)/B(UI) 진행 지연 시에도 엔진을 단독으로 띄워 데모/통합테스트가 끊어지지 않게 만드는 격리 토글이다. AC8(stub smoke)이 요구하는 "엔진 단독 200 응답" 조건의 진입점이며, Week 6+에서 모델 추론이 깨졌을 때 즉시 rule-based로 fallback하는 우회로이기도 하다.

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

> *(개념)* "영속 백업"은 모델 pickle 깨짐·학습 미달·`/classify p99>100ms` 등 어떤 모델 측 사고가 나도 엔진이 **항상 200을 반환**하도록 보장하는 마지막 안전망이다. 모델 성능 하락은 발표에서 설명 가능한 리스크지만, 200을 못 돌려주는 엔진은 AC8/AC4 둘 다 무효화하므로 가용성 우선순위가 정확도보다 높다.

### 2.3 Schema v1-draft mechanical ack
- B가 `contracts/interface-schema.md` 발행 알림이 오면, 그 PR에 **한 줄 코멘트**로 "compiles-against-engine: OK" 또는 컴파일 가능 여부만 응답. (의미 검토는 Week 3.)

### 2.4 Week 1 검증 게이트
```bash
cd python-engine && source .venv/bin/activate
VELXOR_STUB=engine python waitress_conf.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1

curl -fsS -X POST http://127.0.0.1:8765/classify \
  -H "Content-Type: application/json" \
  -d '{"events":[],"window_ms":1000}' | tee /tmp/classify-stub.json
# 기대: verdict=ransomware confidence=0.95 model_version=stub-v1
# trap EXIT이 자동으로 SERVER_PID 종료 — curl 실패 시에도 포트 누수 없음
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

> *(개념)* **sliding window**는 "직전 N ms 동안의 이벤트"만 묶어 분석하는 시간 창. `window_ms`의 시작/끝 기준(요청 도착 시각 기준의 backward window인지, 이벤트 ts 기준인지)이 학습 데이터 생성과 추론 시 동일해야 한다.
> **p99 latency**는 요청 응답시간을 정렬했을 때 99번째 백분위 — 즉 1%의 worst-case tail. 평균(mean)은 outlier에 둔감해 SLA 판정에 부적합하다.

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

> *(노하우)* 벤치마킹에 `time.time()` 대신 `time.perf_counter()`를 쓰는 이유: 전자는 wall-clock으로 NTP 보정·DST·시간대 변경 영향을 받아 음수 elapsed가 나올 수 있다. `perf_counter`는 monotonic + 가장 높은 해상도(보통 ns 단위)라 sub-ms 측정에 안전하다. AC2가 ms 경계값(1000ms) 근방이라 해상도가 결과를 가른다.

---

## 6. Week 6-7 — PoC + 데이터셋 + 학습 (목표: 22h, **최대 부하 구간**)

> ⚠️ **이 구간이 C의 전체 일정에서 가장 큰 블록**. 아래 6단계를 **순서대로** 진행. 각 단계는 독립 PR로 분리해도 좋다.

### 6.1 [Day 1-2, 4h] PoC v1 본구현 + AC2 검증
- 5.1의 `simulate.py`를 그대로 사용 — 단, AC2는 **rename/write 구간만**(파일 사전 생성 + Python 인터프리터 부팅 제외) 측정해야 하므로 `simulate.py` 출력을 기계 파싱 가능한 한 줄로 강화한다.

`poc-samples/ransomware_simulator/v1/simulate.py` 출력 형식 보강 (`run()` 마지막 줄):
```python
    # 기존 print 대신 — 기계 파싱 가능한 키=값 토큰을 추가 emit
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"v1: {count} ops in {elapsed_ms:.3f} ms ({count/(elapsed_ms/1000):.0f} ops/s)")
    print(f"AC2_MEASURED_MS={elapsed_ms:.3f}")   # poc-bench.sh가 grep
```

`scripts/poc-bench.sh`:
```bash
#!/usr/bin/env bash
# AC2: 300 file ops measured 구간만 wall-clock < 1s (Python 부팅/파일 prep 제외)
set -euo pipefail

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# simulate.py 내부 perf_counter 결과를 신뢰 (sub-ms 해상도 + monotonic)
OUTPUT=$(python poc-samples/ransomware_simulator/v1/simulate.py "$TMP" --count 300)
echo "$OUTPUT"

ELAPSED_MS=$(echo "$OUTPUT" | grep -oE 'AC2_MEASURED_MS=[0-9.]+' | cut -d= -f2)
if [ -z "$ELAPSED_MS" ]; then
  echo "AC2 FAIL — simulate.py did not emit AC2_MEASURED_MS" >&2
  exit 2
fi

echo "AC2 measured-ops wall-clock: ${ELAPSED_MS} ms"
# bash arithmetic은 정수만 — awk로 float 비교
if awk "BEGIN {exit !($ELAPSED_MS < 1000)}"; then
  echo "AC2 PASS"
  exit 0
else
  echo "AC2 FAIL (>=1000ms — do NOT relax threshold)"
  exit 1
fi
```

```bash
chmod +x scripts/poc-bench.sh
./scripts/poc-bench.sh        # → AC2 PASS 기대
```

> *(왜 측정 범위 분리)* 원래 스크립트는 외부 `time.time()*1000`로 Python 인터프리터 부팅(~80–150 ms) + 사전 .docx 300개 생성까지 포함한다. 그러면 실제 rename/write가 500 ms여도 wall-clock이 800–1100 ms로 측정되어 경계값에서 AC2가 randomly 실패한다. `simulate.py` 내부 `perf_counter` 구간만 신뢰한다.

### 6.2 [Day 2, 3h] PoC v2 + v3 variants
`poc-samples/ransomware_simulator/v2/simulate.py`: v1과 동일 패턴, `.txt → .crypted`, 500 files/0.8s.
`poc-samples/ransomware_simulator/v3/simulate.py`: `.pdf → .locked`, 200 files/2s. **held-out (학습 금지)**.

v2/v3 작성 가이드: 5.1 코드에서 다음 3개만 변경.
- 확장자 pair (`.txt`/`.crypted`, `.pdf`/`.locked`)
- count + 목표 elapsed
- prefix write 바이트 수 (선택)

> 🚫 **v3는 절대 학습 데이터에 포함되지 않게 디렉토리 격리**: `datasets/positive/` 안에 v3 로그를 절대 두지 않는다. v3 출력은 `datasets/heldout/v3/`로.

> *(개념)* **held-out set**은 학습 과정에서 모델이 한 번도 보지 못한 평가 전용 데이터. test set과 비슷하지만 일반적으로 분포 자체를 다르게 잡아 "학습 분포 밖" 일반화를 검증한다.
>
> *(Why v3만 held-out)* v1(`.docx→.docx.enc`)·v2(`.txt→.crypted`)로 학습한 모델이 **본 적 없는 확장자 변형**(`.pdf→.locked`)에서도 ransomware로 분류하는지가 핵심. 단순 확장자 매칭이 아니라 "행위 윈도우 통계" 자체를 학습했음을 증명하는 단일 가장 강력한 근거이며, AC5a 평가의 정당성 기둥이다.

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

> *(노하우)* JSONL은 **1줄 = 완전한 JSON 객체 1개**가 절대 규칙. 줄바꿈을 객체 내부에 넣으면 line-by-line streaming 파서가 깨진다. `json.dumps(e, ensure_ascii=False)`로 emit 시 마지막에 명시적으로 `+ "\n"`을 붙이고, 읽는 쪽은 `for line in open(...)` 패턴으로 처리해 메모리에 전체 파일을 올리지 않는다. AC5 평가 스크립트의 `jq -s '.'`도 이 가정을 깔고 있다.

### 6.4 [Day 4, 3h] AC5b Negative 데이터셋 (bursty-benign, Ubuntu 워크로드)

데이터셋 디렉토리는 ext4 로컬에 두고 `/tmp`(tmpfs)는 피한다 — tmpfs는 페이지 캐시 대신 RAM 직격이라 디스크 IO 측정이 비현실적으로 빨라진다.

```bash
mkdir -p datasets/negative ~/velxor-work/{src,dst}

# 사전: src에 소파일 트리 준비 (대량 rename/write를 유도하기 위해 ≥1000개)
for i in $(seq 1 1000); do
  echo "dummy-$i" > ~/velxor-work/src/file_$(printf '%04d' "$i").txt
done

# Case 1 (robocopy /MIR 대응): rsync mirror — temp-file rename 동반
rsync -aH --delete ~/velxor-work/src/ ~/velxor-work/dst/ \
  --info=NAME,STATS2 > datasets/negative/rsync_run_01.log 2>&1
#  --inplace 금지: rsync 기본은 `.~tmp~` 파일 → atomic rename이라 FileRename burst가 정확히 robocopy와 같은 의미

# Case 2 (7z 압축 해제): unzip 또는 p7zip
unzip -o some-archive.zip -d ./tmp_extract \
  > datasets/negative/unzip_run_01.log 2>&1
# 또는: 7z x some-archive.7z -otmp_extract > datasets/negative/7z_run_01.log 2>&1

# Case 3 (Linux native bursty-benign — 개발자 도구 시나리오)
# 큰 저장소 git clone 또는 npm/pnpm install — node_modules 폭발
git clone --depth 1 https://github.com/expressjs/express ~/velxor-work/repo \
  > datasets/negative/gitclone_run_01.log 2>&1
( cd ~/velxor-work/repo && npm install --silent ) \
  > datasets/negative/npm_install_run_01.log 2>&1
```

→ negative 샘플 ≥10개 확보 (rsync/unzip/git-clone/npm-install 4종을 변형 반복하면 충분). 합성 PoC와 동일한 JSONL 포맷으로 변환하는 `scripts/log-to-events.py` 작성. **수집 방식 일관성을 위해 가능하면 작업자 A의 fanotify collector를 함께 띄워 동일 파이프라인으로 JSONL emit하는 게 가장 깔끔하다** (그렇지 않으면 robocopy 로그·rsync `--info` 출력 등 이질적 텍스트를 파싱해야 함).

> *(Why rsync + unzip + npm-install)* 셋 다 짧은 시간에 **고밀도 FileWrite/FileRename** burst를 일으키는 Ubuntu 환경의 대표적 정상 워크로드다. rsync는 robocopy의 직계 대응으로 temp-file rename 패턴까지 유사하고, unzip/7z는 압축 해제로 인한 다양한 확장자 동시 쓰기, `npm install`은 node_modules에 만 단위 소파일을 순식간에 풀어 ext_diversity·pid_fanout이 동시에 높은 가장 가혹한 FP 케이스다. `write_rate` 단독 모델은 이 셋 중 하나라도 ransomware로 오탐할 가능성이 크고, 모두에서 FP≤1/10을 통과해야 모델이 단순 임계치가 아니라 다변수 분류기임이 증명된다.
>
> *(노하우)* `apt`/`dpkg` 업데이트도 좋은 후보지만 sudo 권한 + 시스템 영향이 있어 학습 데이터로는 부담스럽다. 위 4종(`rsync`, `unzip/7z`, `git clone`, `npm install`)이 sudo 없이 user-space에서 일관 재현 가능해 가장 안전하다.

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

> *(Why ext_diversity + pid_fanout)* 두 피처가 rsync/unzip/npm-install(정상 burst)과 ransomware burst를 가르는 결정적 축이다.
> - `ext_diversity`: rsync mirror·git clone은 입력 트리의 확장자를 그대로 보존(소수 클래스) — 낮은 다양성. ransomware는 무차별 다파일 암호화로 단일 확장자(`.locked` 등)에 집중되지만 **원본 확장자의 다양성**이 높게 관찰됨. unzip/`npm install`은 다양성이 자연스럽게 높아 false negative 위험이 있으니 pid_fanout과 결합해 구분.
> - `pid_fanout`: 정상 도구는 메인 PID + 자식 워커 소수(rsync는 단일 PID, npm은 자식 다수지만 패턴이 깊고 짧음). ransomware는 단일 PID에서 폭주적 IO를 하거나, 반대로 자식 분기·스레드 폭이 더 넓다 — 둘 다 정상 분포에서 이탈 신호.
> 이 두 피처가 없으면 `write_rate` 단독 모델로 회귀해 AC5b FP를 통과하지 못한다.

### 6.6 [Day 7, 3h] 모델 학습 + `/classify` 본구현
의사 코드 (구체 알고리즘은 본인 선택; logistic regression 또는 RandomForest 권장 — 학습 빠르고 p99 budget 여유).

> *(Why LogisticRegression)* 딥러닝이 아닌 LR을 채택하는 이유는 **추론 지연이 결정적으로 작고 예측 가능**하기 때문이다. AC4의 `/classify p99<100ms`는 절대 양보 불가 조건이고, LR은 feature dot product 한 번이라 상시 sub-ms. 학습도 수십~수백 샘플에서 즉시 수렴해 Week 6-7의 22h 단일 블록 안에 반복 튜닝이 가능하다. 정확도 향상이 필요하면 RandomForest(여전히 ms 단위)로만 점프하고 신경망까지는 가지 않는다.

`python-engine/model/train.py`:
```python
"""v1+v2 학습, v3+negatives는 평가용으로 분리.
실행: repo root에서 `python python-engine/model/train.py`
"""
import json, glob, pickle, sys
from pathlib import Path
import numpy as np
from sklearn.linear_model import LogisticRegression

# 경로 anchoring: train.py 위치 기준으로 engine 디렉토리/repo root 산출
ENGINE_DIR = Path(__file__).resolve().parent.parent   # python-engine/
ROOT = ENGINE_DIR.parent                              # repo root
sys.path.insert(0, str(ENGINE_DIR))                   # features.py import 보장

from features import extract  # noqa: E402

WINDOW_MS = 1000
X, y = [], []

for path in sorted(glob.glob(str(ROOT / "datasets" / "positive" / "v[12]_*.jsonl"))):
    events = [json.loads(l) for l in open(path)]
    X.append(list(extract(events, WINDOW_MS).values()))
    y.append(1)

for path in sorted(glob.glob(str(ROOT / "datasets" / "negative" / "*.jsonl"))):
    events = [json.loads(l) for l in open(path)]
    X.append(list(extract(events, WINDOW_MS).values()))
    y.append(0)

if not X:
    sys.exit("ERR: no training samples found — datasets/positive 또는 datasets/negative가 비었음")

clf = LogisticRegression(max_iter=1000).fit(np.array(X), np.array(y))
MODEL_PATH = ENGINE_DIR / "model" / "model.pkl"
MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
with open(MODEL_PATH, "wb") as f:
    pickle.dump(clf, f)
print(f"trained, n_samples={len(y)}, saved={MODEL_PATH}")
```

`app.py`의 `/classify`를 모델 + fallback 라우팅으로 교체. 모델 경로는 **CWD에 의존하지 않게 `__file__` 기준 anchor**:
```python
import pickle, time
from pathlib import Path
from features import extract
from fallback_rules import classify_events as rule_classify

ENGINE_DIR = Path(__file__).resolve().parent
MODEL_PATH = ENGINE_DIR / "model" / "model.pkl"

try:
    with open(MODEL_PATH, "rb") as f:
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
    proba = float(_MODEL.predict_proba([feats])[0][1])  # [0]=첫 샘플, [1]=positive(ransomware) 확률
    verdict = "ransomware" if proba >= 0.5 else "benign"
    return jsonify(
        verdict=verdict,
        confidence=proba if verdict == "ransomware" else 1 - proba,
        evidence=[f"lr_proba={proba:.3f}"],
        model_version=MODEL_VERSION,
    ), 200
```

> *(노하우)* `predict_proba`는 `(n_samples, n_classes)` 형태 ndarray를 반환한다. 클래스 인덱스 순서는 `_MODEL.classes_`로 결정되며, 위 학습 코드에서 y∈{0,1}을 그대로 fit했으므로 `[0]=benign, [1]=ransomware` 확률이다. `_MODEL.classes_ == array([0, 1])`임을 학습 직후 확인할 것 — 클래스 라벨링이 바뀌면 `[0][1]` 인덱싱이 침묵 실패한다.
>
> *(참조)* `max_iter`, `class_weight`("balanced"가 negative 부족 시 도움), `C`(정규화 강도) 하이퍼파라미터는 scikit-learn 공식 문서의 *LogisticRegression* API를 참조.

### 6.7 [Day 7, 1h] /classify p99 < 100ms 자체 측정

**선행**: 측정 전에 서버가 떠 있어야 한다. 떠 있지 않으면 `requests.exceptions.ConnectionError`로 실패.
```bash
cd python-engine && source .venv/bin/activate
python waitress_conf.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1
curl -fsS http://127.0.0.1:8765/health > /dev/null   # 살아있나 확인
cd ..
```

```bash
# 부하: 100회 요청, nearest-rank p99 = ceil(0.99*N)-1 인덱스
python - <<'PY'
import math, time, requests
payload = {"events": [{"event_type":"FileWrite","ts_unix_ms":i} for i in range(300)], "window_ms": 1000}
lat = []
for _ in range(100):
    t0 = time.perf_counter()
    r = requests.post("http://127.0.0.1:8765/classify", json=payload, timeout=2)
    r.raise_for_status()
    lat.append((time.perf_counter() - t0) * 1000)
lat.sort()
p50 = lat[math.ceil(0.50 * len(lat)) - 1]
p99 = lat[math.ceil(0.99 * len(lat)) - 1]   # N=100 → 인덱스 98 (lat[99]는 최댓값=p100)
print(f"p50={p50:.1f}ms  p99={p99:.1f}ms")
PY
```
- **p99 < 100ms PASS** → 그대로 진행.
- **p99 >= 100ms FAIL** → 즉시 `_MODEL = None` (또는 `VELXOR_STUB=engine`) 영속 + `MODEL_VERSION="rule-based-v1"` 표시. **임계값 완화 금지**.

> *(왜 ceil-1)* nearest-rank percentile 정의상 N=100 샘플의 p99는 99번째로 큰 값 = 정렬 후 인덱스 98. 원래 코드 `lat[99]`는 100번째 = 최댓값(p100)이라 늘 진짜 p99보다 낙관적이거나(거의 같음) tail outlier 1개에 휘둘려 비교 불가능했다.

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
shopt -s nullglob          # 매칭 없으면 빈 배열 (literal 패턴이 jq로 흘러가는 사고 차단)

ENGINE=http://127.0.0.1:8765/classify
TP=0; FP=0; FN=0; TN=0

heldout=(datasets/heldout/v3/*.jsonl)
negatives=(datasets/negative/*.jsonl)
if [ "${#heldout[@]}" -eq 0 ] || [ "${#negatives[@]}" -eq 0 ]; then
  echo "ERR: held-out 또는 negative JSONL이 비어있음 — Week 6.3/6.4 산출물 확인" >&2
  exit 2
fi

for f in "${heldout[@]}"; do
  EVENTS=$(jq -s '.' "$f")
  V=$(curl -fsS -X POST "$ENGINE" -H "Content-Type: application/json" \
        -d "{\"events\":${EVENTS},\"window_ms\":2000}" | jq -r .verdict)
  [ "$V" = "ransomware" ] && TP=$((TP+1)) || FN=$((FN+1))
done

for f in "${negatives[@]}"; do
  EVENTS=$(jq -s '.' "$f")
  V=$(curl -fsS -X POST "$ENGINE" -H "Content-Type: application/json" \
        -d "{\"events\":${EVENTS},\"window_ms\":2000}" | jq -r .verdict)
  [ "$V" = "ransomware" ] && FP=$((FP+1)) || TN=$((TN+1))
done

echo "TP=$TP FN=$FN  FP=$FP TN=$TN"
[ "$TP" -ge 9 ] && [ "$FP" -le 1 ] && { echo "AC5 PASS"; exit 0; }
echo "AC5 FAIL (do NOT relax thresholds — record as-is per AC5 policy)"; exit 1
```

> *(개념)* **TP**(True Positive) = 실제 랜섬웨어를 ransomware로 맞춘 수. **FP**(False Positive) = 정상 행위를 ransomware로 오탐한 수. **Honest reporting**은 임계값(0.5)·feature 가중치·평가 데이터를 **결과를 맞추려 사후 조정하지 않고** 측정한 그대로 보고하는 원칙. AC5의 신뢰도 전체가 이 원칙에 매여 있어 한 번 조정이 발각되면 평가 자체가 무효가 된다.
>
> *(왜 jq `-s`)* JSONL 파일을 `-s`(slurp)로 읽으면 줄별 객체를 단일 배열로 묶어 `/classify`의 `events[]` 필드 형식과 호환된다. `[줄1, 줄2, ...]`가 그대로 events 배열이 됨 — 6.3의 "1줄=1이벤트" 가정과 짝지어진다.

### 7.2 `docs/AC5-results.md` 작성
```bash
set -o pipefail   # eval-ac5.sh 실패가 tee 성공에 가려지지 않도록
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

## AC5b — bursty-benign negatives (Ubuntu)
rsync -aH --delete mirror, unzip/7z 압축 해제, git clone(large), npm install (node_modules 폭발) 로그.

## AC5c — disclaimer
**Evaluated on synthetic PoC, not real-world malware. Evaluated on Linux/ext4 + fanotify userspace collector; Windows NTFS/minifilter behavior may differ.**
EOF
git add docs/AC5-results.md scripts/eval-ac5.sh
git commit -m "C: week8-9 AC5 eval script + AC5-results.md (honest reporting)"
git push
```

### 7.3 `scripts/eval-ac4.sh` — Rust tracing JSON → p99
B가 emit한 `tracing` JSON 파일(`rust-service/logs/trace-*.json` 또는 stdout) 가정. 입력 측 fanotify collector(A 영역)는 root로 실행되며 `fs.inotify.max_user_watches`·`fanotify` 큐 한계에 닿으면 이벤트를 silent drop할 수 있다. AC4 p99 산식은 도달한 이벤트만 계산하므로 누락된 요청은 통계에서 제외되어 tail latency가 실제보다 낙관적으로 측정될 수 있다. 측정 결과에 `n=<sample_count>`를 함께 기록해 평가자가 표본 충분성을 검증하도록 한다.

`scripts/eval-ac4.sh`:
```bash
#!/usr/bin/env bash
# AC4: event_received_ts → ws_sent_ts p99 < 1000ms, classify p99 < 100ms
set -euo pipefail
LOG="${1:-rust-service/logs/trace.json}"

python - "$LOG" <<'PY'
import json, math, sys
path = sys.argv[1]
e2w, classify = [], []
with open(path) as f:
    for line in f:
        try: r = json.loads(line)
        except Exception: continue
        if "event_received_ts" in r and "ws_sent_ts" in r:
            e2w.append(r["ws_sent_ts"] - r["event_received_ts"])
        if "classify_start_ts" in r and "classify_end_ts" in r:
            classify.append(r["classify_end_ts"] - r["classify_start_ts"])

def p99(xs):
    if not xs:
        return float("nan")
    xs = sorted(xs)
    # nearest-rank percentile: ceil(0.99*N)-1, clip to [0, N-1]
    idx = min(math.ceil(0.99 * len(xs)) - 1, len(xs) - 1)
    return xs[max(idx, 0)]

print(f"event→ws  p99 = {p99(e2w):.1f} ms  (target < 1000 ms, n={len(e2w)})")
print(f"classify  p99 = {p99(classify):.1f} ms  (target < 100 ms,  n={len(classify)})")
PY
```

```bash
chmod +x scripts/eval-ac4.sh
./scripts/eval-ac4.sh rust-service/logs/trace.json
git add scripts/eval-ac4.sh && git commit -m "C: week8-9 AC4 eval script (tracing JSON p99)" && git push
```

### 7.4 AC8 stub smoke (C 담당 = engine 모드)
```bash
# waitress_conf는 python-engine/ 안에 있으므로 cd 후 실행해야 모듈 발견됨
cd python-engine
VELXOR_STUB=engine python waitress_conf.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1

curl -fsS http://127.0.0.1:8765/health | jq .              # model_version=stub-v1 (또는 rule-based-v1)
curl -fsS -X POST http://127.0.0.1:8765/classify \
     -H 'Content-Type: application/json' \
     -d '{"events":[],"window_ms":1000}' | jq .
# → 항상 200 + verdict 채워짐. 미달 시 fix.
cd ..
```

> *(Why empty 본문 대신 명시 events)* Flask `request.get_json(silent=True)`는 빈 본문을 `None`으로 돌리지만, 일부 가드가 본문 부재 시 422를 던지도록 미래에 강화될 수 있다. AC8은 "engine이 단독으로 살아있다"는 증명이라 의도된 minimal valid payload로 stress한다.

### 7.5 리허설 3회 참여
B 주관. C는 `REHEARSAL-LOG.md`에 자기 섹션(엔진 응답 시간, fallback 동작 여부) 기록.

> **Done when**: `eval-ac5.sh` 출력 + `AC5-results.md` 커밋, `eval-ac4.sh` 출력 정상, `VELXOR_STUB=engine` 단독 smoke pass.

---

## 8. Week 10 — 발표 (목표: 2h)

### 8.1 슬라이드 — 데이터 전략 + AC5 결과 페이지
필수 포함:
- 합성 PoC v1/v2 (학습) vs v3 (held-out) 분리도
- rsync/unzip/git-clone/npm-install negative 워크로드 라벨 (Ubuntu)
- 4계층 다이어그램에서 layer ①이 **fanotify userspace collector**(원안 WDK minifilter에서 마이그레이션)임을 1줄 표기
- `docs/AC5-results.md` 표 그대로 캡처
- **AC5c disclaimer 굵게**: *"Evaluated on synthetic PoC, not real-world malware. Evaluated on Linux/ext4 + fanotify userspace collector; Windows NTFS/minifilter behavior may differ. Real-world testing is future work."*

> *(체크리스트)* AC5c disclaimer는 슬라이드 1곳만 두면 Q&A에서 캡처/공유 시 떨어져 나간다. **`README.md` 최상단, `docs/AC5-results.md` 본문, 발표 슬라이드, 데모 영상 자막**까지 동일 문구로 박아두면 어디서 잘려나가도 한 곳은 살아남는다.

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
│   └── negative/{rsync,unzip,7z,gitclone,npm_install}_*    ✅ (≥10개, Ubuntu)
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
| `/health` 200 안 옴 | Waitress 미설치 / 포트 충돌 | `pip show waitress`; `ss -ltnp 'sport = :8765'` 또는 `lsof -iTCP:8765 -sTCP:LISTEN`; 종료는 `fuser -k 8765/tcp` |
| `/classify` 503 | 모델 pickle 깨짐 | `_MODEL=None` 강제 → rule-based 영속 |
| p99 > 100ms | 모델 추론 느림 / threads=4 미적용 | `serve(..., threads=4)` 확인, 모델을 logistic으로 단순화 |
| AC5 TP<9 | held-out v3 변형이 학습 분포 밖 | **임계값 완화 금지**. 결과 그대로 슬라이드 |
| AC5 FP>1 | rsync/unzip/npm burst가 write_rate 트리거 | features에 `pid_fanout`, `ext_diversity` 가중 (학습 데이터에 npm-install 등 추가). `class_weight="balanced"`도 검토 |
| `python3.11: command not found` | Ubuntu 24.04 기본 python3는 3.12 | `pyenv install 3.11.9` 또는 `sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt install python3.11 python3.11-venv` |
| fanotify smoke 실패 (A 영역) | root 권한 부족, 커널 옵션 미활성 | `sudo` 로 실행 확인; `grep CONFIG_FANOTIFY /boot/config-$(uname -r)`가 `=y`인지 |
| `chmod +x` 후에도 실행 안 됨 | git에 권한 비트 미반영 | `git update-index --chmod=+x scripts/foo.sh` 후 재커밋 |
| `VELXOR_STUB=engine` 무효 | env 우선순위 무시 | `app.py` 최상단 `os.getenv` 분기 확인 |

---

## 끝 — 이 문서대로 위에서 아래로만 진행하면 ~40h 안에 작업자 C의 모든 책임이 완료된다.
