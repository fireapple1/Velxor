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

## 2. 결과 (3 iter, classify event 합산)

`scripts/eval-ac4.sh` 출력 합산:

| iter | classify n | failed | latency_ms p50 | p99 | event→ws n | p99 (ms) |
|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 6.00 | 6.00 | 60 | 54 |
| 2 | 1 | 0 | 6.00 | 6.00 | 60 | **265** |
| 3 | 1 | 0 | 6.00 | 6.00 | 60 | 54 |
| **합산** | **3** | **0** | **6.00** | **6.00** | **180** | **265** |

- **AC4 classify p99 < 100 ms**: **PASS** (6 ms — 게이트 대비 16× 여유)
- **event → ws p99 < 1000 ms**: **PASS** (max 265 ms — 게이트 대비 3.7× 여유)
- failed_ratio: 0/3 (timeout / 예외 0건)
- `n_arrived` per classify: 50 (FileWrite ≥ 50/1s burst threshold 그대로)

원시 line 한 줄 (iter-1 예시):
```json
{"timestamp":"2026-05-22T15:13:46.273127Z","level":"INFO","fields":{
  "message":"classify_done","classify_end_ts":1779462826273,
  "classify_start_ts":1779462826267,"latency_ms":6,"pid":1234,
  "n_arrived":50},"target":"rust_service::aggregator"}
```

---

## 3. 표본 크기 한계 (honest reporting)

### 3.1 classify 표본이 작은 이유

iter 당 classify event **1 건만 발생**. 원인 명확:
- A 의 aggregator 가 *PID 별* verdict cache TTL 1 초 + 1 초 debounce 적용
  (consensus-plan §3.3, handoff-week4-5 §5)
- rehearsal.sh 의 60 burst event 가 **모두 pid=1234 단일** → cache 1 회 trigger
- 60 events 가 ~3 ms 안에 다 들어왔으므로 후속 events 는 debounce 로 흡수

→ AC4 sub-budget (classifier 응답 시간) 자체는 측정 충분 (6 ms × 3 회 모두
동일, std≈0). 하지만 **classifier 처리량 / tail latency 분포 정밀 측정에는
n=3 너무 작음**.

### 3.2 추가 측정 권장 (Future work)

큰 표본 확보 방안 (예상 trace 양 함께):

| 시나리오 | 예상 classify n | 비고 |
|---|---|---|
| Multi-PID burst (10 PID × 60 events) | 10 / iter | cache TTL 우회 |
| 시간 흐름 burst (1 PID, 1초 간격 × 10초) | 10 / iter | TTL 만료 후 재 classify |
| 실 fanotify trace (`sweep-fanotify.sh`) | 6 / 6 초 (이미 §4.7 sweep) | multi-PID 자연스럽게 발생 |
| `scripts/p99-bench.py` 자체 측정 100 회 | 100 | engine 측 단독 (warmup 5 + measure 100) |

본 보고서는 3 iter 결과만으로 AC4 게이트 PASS 를 확정 — latency_ms=6 가
3 회 모두 동일하므로 분산 매우 작다고 추정. 더 큰 표본은 발표 직전
리허설 + `p99-bench.py` 실측으로 보강 예정.

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
