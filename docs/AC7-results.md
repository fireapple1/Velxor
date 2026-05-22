# AC7 — 1 시간 sustained run (메모리 leak 부재) 측정 결과

> **작성자**: Worker C (ralph 자동 실행)
> **측정일**: 2026-05-23 (Asia/Seoul)
> **재현**: `bash scripts/ac7-sustained.sh` (release 1 h) 또는 `AC7_DURATION=300 bash scripts/ac7-sustained.sh` (dev 5 m)
> **policy**: honest reporting — dev (5 m) 결과를 release proxy 로 보고, 1 h 정식 측정은 발표 직전 별도 실시.

---

## 0. AC7 합격 기준 (consensus-plan §AC7)

| 지표 | 기준 |
|---|---|
| sustained 가동 시간 | 정의된 DURATION 만큼 헬스 폴링 100 % |
| RSS Δ (engine + rust) | ≤ 10 % |
| dropped_since_last | 증가 0 (silent loss 없음) |
| classify_failed_ratio | < 0.01 |

---

## 1. dev mode (AC7_DURATION=300, 5 분)

`scripts/ac7-sustained.sh` 자동 출력 (`~/velxor-work/ac7-sustained/run-20260523-020620/summary.txt`):

```
duration=300s  poll=30s
RSS  engine: 122672 → 122676 KB (Δ 0%)
RSS  rust  : 11116 → 11116 KB (Δ 0%)
health_fails=0  dropped_lines=0
classify  done=10  failed=0  ratio=0.0000
RESULT=PASS
```

(자세한 시계열은 `rss.tsv` / `health.tsv` 동봉. 10 폴링 cycle (30 s 간격)
모두 engine `/health` 200 + rust WS :7000 listen 정상.)

### 1.1 게이트 평가

| 지표 | 측정 | 게이트 | 결과 |
|---|---|---|---|
| Health polling | 0/10 폴링 fail | 0 fail | ✅ PASS |
| Engine RSS Δ | +4 KB (0%) | ≤ 10 % | ✅ PASS |
| Rust   RSS Δ | 0 KB (0%) | ≤ 10 % | ✅ PASS |
| dropped_since_last | 0 lines | 0 | ✅ PASS |
| classify_failed_ratio | 0.0000 (0/10) | < 0.01 | ✅ PASS |
| **AC7 overall (dev 5 m)** | — | — | **✅ PASS** |

---

## 2. release mode (AC7_DURATION=3600, 1 시간) — 발표 직전 별도 실시

dev 5 m PASS 는 release 1 h 의 proxy. 본 측정은 발표 직전 (Week 10) 별도 실시:

```bash
AC7_DURATION=3600 bash scripts/ac7-sustained.sh
```

결과는 본 문서 §2 에 append (또는 별도 `AC7-results-1h.md`).

---

## 3. 한계 / honest interpretation

- dev 5 m → release 1 h: 짧은 측정은 short-term GC / 일시 RSS 증가 패턴을
  catch 하지만 long-term leak (10-30 분 누적) 은 못 잡음.
- engine 부하: stub 모드 (VELXOR_STUB=collector + events.jsonl 60 burst
  반복 poll) 라 model inference 측 단독 부하 검증 없음 → release 1 h 는
  unset (lr-2026w7 모델) 모드로 재실시 권장.
- rust-service 부하: events.jsonl 가 정적이라 fanotify silent drop / 큐
  overflow 같은 실 부하 시그널 없음 → 실 fanotify 모드 (root) 1 h 측정은
  AC7-results-1h-real 으로 별도.

---

## 4. 재현

```bash
# dev (5 m)
AC7_DURATION=300 bash scripts/ac7-sustained.sh

# release (1 h)
AC7_DURATION=3600 bash scripts/ac7-sustained.sh

# 실 fanotify (root, future work)
sudo VELXOR_STUB= AC7_DURATION=3600 bash scripts/ac7-sustained.sh
```

artifacts: `~/velxor-work/ac7-sustained/run-<YYYYMMDD-HHMMSS>/`
- `engine.log / rust.log` — 각 프로세스 출력
- `rss.tsv` — 폴링별 RSS (ts / engine / rust)
- `health.tsv` — 폴링별 health (ts / engine_h / rust_ws)
- `summary.txt` — 최종 게이트 평가
