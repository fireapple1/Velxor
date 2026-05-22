#!/usr/bin/env python3
"""POST /classify p99 < 100ms 자체 측정 — worker-C-timeline §6.7.

선행 조건: python-engine/waitress_conf.py 가 :8765 에서 live 상태여야 함.
실행 (repo root, venv 활성화 후):
    scripts/p99-bench.py
"""
import math
import sys
import time

import requests

URL = "http://127.0.0.1:8765/classify"
N_WARMUP = 5
N_MEASURE = 100
TARGET_MS = 100.0

payload = {
    "events": [
        {
            "event_type": "FileWrite",
            "file_path": f"/x/doc_{i}.docx",
            "pid": 1234,
            "op_detail": {"file_size": 32000},
            "ts_unix_ms": 1716300000000 + i,
        }
        for i in range(300)
    ],
    "window_ms": 1000,
}

# warmup (JIT/cache 안정화)
for _ in range(N_WARMUP):
    requests.post(URL, json=payload, timeout=2).raise_for_status()

lat_ms = []
for _ in range(N_MEASURE):
    t0 = time.perf_counter()
    r = requests.post(URL, json=payload, timeout=2)
    r.raise_for_status()
    lat_ms.append((time.perf_counter() - t0) * 1000.0)

lat_ms.sort()
# nearest-rank percentile: ceil(p * N) - 1 (clamped)
def percentile(xs, p):
    idx = max(min(math.ceil(p * len(xs)) - 1, len(xs) - 1), 0)
    return xs[idx]

p50 = percentile(lat_ms, 0.50)
p95 = percentile(lat_ms, 0.95)
p99 = percentile(lat_ms, 0.99)

print(f"n={len(lat_ms)}  p50={p50:.2f}ms  p95={p95:.2f}ms  "
      f"p99={p99:.2f}ms  max={lat_ms[-1]:.2f}ms")
print(f"AC4 sub-budget < {TARGET_MS:.0f}ms : "
      f"{'PASS' if p99 < TARGET_MS else 'FAIL'}")

sys.exit(0 if p99 < TARGET_MS else 1)
