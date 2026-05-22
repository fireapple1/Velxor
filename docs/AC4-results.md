# AC4 — `/classify` p99 < 100 ms 측정 결과

> **작성자**: Worker C
> **측정일**: 2026-05-23 (Asia/Seoul)
> **재현**: `bash scripts/eval-ac4.sh ~/velxor-work/rehearsal-2026-05-23/iter-N/rust.log`
> **policy**: honest reporting — 표본 크기·debounce 조건 명시, p99 계산 nearest-rank ceil-1 (선형 보간 X).

---

## 0. AC4 합격 기준 (consensus-plan §AC4)

| 지표 | 기준 |
|---|---|
| classify sub-budget | p99 < 100 ms (C 측정·해석) |
| event → ws (wall-clock) | p99 < 1000 ms (UI 1초 wow moment, best effort 보조) |

---

## 1. 측정 환경

- **input**: A 의 `scripts/rehearsal.sh` 가 생성한 3 iter tracing JSON
  (`~/velxor-work/rehearsal-2026-05-23/iter-{1,2,3}/rust.log`)
- **모드**: `VELXOR_STUB=collector` (events.jsonl 60 burst poll 200 ms)
- **engine**: `rules-v1` (model.pkl 미로드 모드 — fallback rules 분기)
  ※ 본 측정 시점 engine 는 `python-engine/.venv` 활성 + waitress threads=4
- **rust-service**: commit `120613e` 이후 `a086a0f` audit followup 까지 반영분
  (AC4 tracing instrumentation, `latency_ms` 직접 emit)
- **A 의 §3 합의**: `classify_start_ts` placement = spawn 안(현재) 그대로
  채택 — tokio scheduling + reqwest 큐잉 포함이 honest

---

## 2. 결과

### 2.1 Single-PID rehearsal trace (n = 3)

`scripts/eval-ac4.sh ~/velxor-work/rehearsal-2026-05-23/iter-{1,2,3}/rust.log`:

| iter | classify n | failed | latency_ms p50 | p99 | event→ws n | p99 (ms) |
|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 6.00 | 6.00 | 60 | 54 |
| 2 | 1 | 0 | 6.00 | 6.00 | 60 | **265** |
| 3 | 1 | 0 | 6.00 | 6.00 | 60 | 54 |
| **합산** | **3** | **0** | **6.00** | **6.00** | **180** | **265** |

### 2.2 Multi-PID burst trace (n = 10, 표본 보강)

`scripts/multi-pid-burst.sh` → `rust-service/logs/multi-pid-trace.json`
→ `scripts/eval-ac4.sh rust-service/logs/multi-pid-trace.json`:

```
n=10  failed=0  failed_ratio=0.000
p50=3.00ms  p95=13.00ms  p99=13.00ms  max=13.00ms
AC4 classify : PASS
```

10 PID × 50 events 합성 → aggregator.PidWindow 가 PID 별 burst threshold
(FileWrite ≥ 50/1s) 모두 트리거 → classify 10 회 발생 (verdict cache TTL
1 s × 10 PID 분리).

event→ws 페어는 0 — multi-pid-burst.sh 가 WS subscriber 미연결이라
`ws_out` tracing emit 자체가 안 됨. 게이트 자체에는 무관 (event→ws 는 보조).

### 2.3 합산 (n = 13)

| 출처 | classify n | failed | p99 latency_ms |
|---|---|---|---|
| rehearsal 3 iter | 3 | 0 | 6 |
| multi-PID burst | 10 | 0 | 13 |
| **합산** | **13** | **0** | **13** |

- **AC4 classify p99 < 100 ms**: **PASS** (13 ms — 게이트 대비 7.7× 여유)
- **event → ws p99 < 1000 ms**: **PASS** (rehearsal max 265 ms — 게이트 대비 3.7× 여유)
- failed_ratio: 0 / 13 (timeout / 예외 0 건)
- `n_arrived` per classify: 50 (FileWrite burst threshold 그대로)

원시 line 한 줄 (iter-1 예시):
```json
{"timestamp":"2026-05-22T15:13:46.273127Z","level":"INFO","fields":{
  "message":"classify_done","classify_end_ts":1779462826273,
  "classify_start_ts":1779462826267,"latency_ms":6,"pid":1234,
  "n_arrived":50},"target":"rust_service::aggregator"}
```

---

## 3. 표본 크기 한계 (honest reporting)

### 3.1 표본 규모 — n = 13 (rehearsal 3 + multi-PID 10)

원본 rehearsal 3 iter (single-PID 60 burst) 는 verdict cache TTL 1 s + 1 s
debounce 로 classify 1 회만 trigger 했음. 표본 보강 위해
`scripts/multi-pid-burst.sh` 가 10 PID × 50 events 합성 → PID 별 cache 우회
→ classify 10 회 발생.

n = 13 으로도 **AC4 게이트 PASS 는 견고** (p99 = 13 ms vs 게이트 100 ms,
7.7× 여유). 그러나 통계적 power 측면에서 추가 표본이 바람직.

### 3.2 추가 측정 권장 (Future work)

| 시나리오 | 예상 classify n | 비고 |
|---|---|---|
| ITER=10 rehearsal | 10 (1/iter × 10) | tested 코드 경로 |
| multi-PID 100 PID × 50 events | 100 | 본 스크립트 N_PIDS 만 조정 |
| 시간 흐름 burst (1 PID, 1 s 간격 × N s) | N | TTL 만료 후 재 classify |
| 실 fanotify trace (`sweep-fanotify.sh`) | 6 / 6 초 (이미 §4.7 sweep) | multi-PID 자연스럽게 |
| `scripts/p99-bench.py` 자체 측정 100 회 | 100 | engine 단독 (warmup 5 + measure 100) |

### 3.3 자체 측정 (`scripts/p99-bench.py`) 미실행 사유

C 환경에서 본 작업 시점 `waitress_conf.py` background 기동이 task harness
의 long-running process 격리로 즉시 SIGKILL 됨 (exit 144). interactive
shell 또는 별도 tmux 세션에서 사용자 직접 실행:

```bash
cd /home/lsy/src/Velxor
python-engine/.venv/bin/python python-engine/waitress_conf.py &
sleep 1
python-engine/.venv/bin/python scripts/p99-bench.py
pkill -f waitress_conf
```

기대 결과: `n=100  p50=<~5ms>  p95=<~10ms>  p99=<~30ms>  AC4 PASS`.

---

## 4. event → ws (best effort 보조 측정)

### 4.1 측정 정의

`evt_in` (collector_source 가 event 수신, `event_received_ts`) ↔ `ws_out`
(ws_broadcaster 가 client 에 송신, `ws_sent_ts`) seq 매칭.

iter 당 60 페어 × 3 iter = **n=180**.

### 4.2 분포

- iter-1: p50=53 / p99=54 / max=54 ms
- iter-2: p50=265 / p99=265 / max=265 ms ← **outlier**
- iter-3: p50=54 / p99=54 / max=54 ms

iter-2 의 균일 ~265 ms 는 ws_broadcaster 가 broadcast lag 흡수 후 한꺼번에
flush 한 시그널로 추정. (rust.log 에서 `broadcast lag` 라인 grep 시 0건 —
silent drop X, 단지 backlog → live 전환 타이밍 효과). 게이트 1000 ms 대비
여유 충분하지만 발표 영상 측정 시 변동성 인지 필요.

→ A 의 `worker-A-timeline §5.3` 리허설 보고서 (`docs/AC-rehearsal-report-
2026-05-23.md`) 에서도 iter-2 lag 측정값과 일치.

---

## 5. 한계 / Future Work

1. **표본 크기**: classify n=3, event→ws n=180 — statistical power 작음.
   `p99-bench.py` 실측으로 100+ 표본 확보 + multi-PID burst 시나리오 추가.
2. **engine 모드**: 본 측정 engine 는 `rules-v1` (model 부재 분기). LR 모드
   (`lr-2026w7`) 의 p99 는 별도 측정 필요 — 단 `to_vector(60 events)` +
   `predict_proba` 는 ms 단위라 큰 차이 없을 것으로 예상.
3. **wall-clock end-to-end**: PoC `simulate.py` → fanotify → UI 빨간 노드까지
   의 진짜 end-to-end 측정 (AC3) 은 B 의 OBS 영상 1000 ms frame 캡처로 별도
   검증.
4. **데모 환경 외**: 실 운영 환경 (cluster, container, network namespace) 의
   latency 분포는 본 측정 범위 외.

---

## 6. 재현 절차

### 6.1 기존 trace 로 재계산
```bash
cd /path/to/Velxor
bash scripts/eval-ac4.sh ~/velxor-work/rehearsal-2026-05-23/iter-1/rust.log
bash scripts/eval-ac4.sh ~/velxor-work/rehearsal-2026-05-23/iter-2/rust.log
bash scripts/eval-ac4.sh ~/velxor-work/rehearsal-2026-05-23/iter-3/rust.log
```

### 6.2 새 trace 생성
```bash
bash scripts/setup-venv.sh          # 한 번만
ITER=3 bash scripts/rehearsal.sh    # 3 iter 캡처 (default)
for i in 1 2 3; do
  bash scripts/eval-ac4.sh ~/velxor-work/rehearsal-$(date +%Y-%m-%d)/iter-$i/rust.log
done
```

### 6.3 자체 측정 (engine 단독)
```bash
python-engine/.venv/bin/python python-engine/waitress_conf.py &
sleep 1
python-engine/.venv/bin/python scripts/p99-bench.py
pkill -f waitress_conf
```

---

## 7. 변경 이력

| 버전 | 일시 | 변경 | 발행자 |
|---|---|---|---|
| v1 | 2026-05-23 | 최초 측정. 3 iter rust.log → classify p99=6ms PASS + event→ws p99=265ms PASS. n=3 표본 한계 honest 명시. | C |
