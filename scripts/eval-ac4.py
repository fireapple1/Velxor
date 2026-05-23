#!/usr/bin/env python3
"""AC4 측정 — A 의 tracing JSON 파싱 → classify p99 < 100ms.

docs/history/worker-C-timeline.md §7.3 spec + docs/history/from-worker-a-to-c-2026-05-23.md §2.1 / §6.

A 가 emit 하는 tracing event (rust-service/logs/trace.json, tracing_subscriber
JSON layer):
  classify_start  : classify_start_ts, n_arrived, pid       (aggregator.rs)
  classify_done   : classify_end_ts,   latency_ms, pid, n   (aggregator.rs)
  classify_failed : error, latency_ms?                       (aggregator.rs)
  evt_in          : event_received_ts, seq                   (collector_source / fanotify_adapter)
  ws_out          : ws_sent_ts, seq, src("live"|"backlog")  (ws_broadcaster)

AC4 게이트 (consensus-plan §AC4):
  classify p99  < 100 ms   (sub-budget, C 측정)
  event → ws p99 < 1000 ms (시연 wall-clock, best effort, seq 매칭 시만)

honest reporting (docs/history/worker-C-timeline.md §7.3):
  - silent drop 가능성 → 도달 이벤트만 p99 계산 + n=<sample_count> 함께 emit
  - nearest-rank ceil-1 p99 (선형 보간 X)
  - classify_failed (timeout / 예외) 비율 별도 보고 — 게이트엔 영향 X 이지만
    failed 비율이 높으면 p99 계산 표본이 편향됨을 평가자에 알림

사용:
    python scripts/eval-ac4.py                          # rust-service/logs/trace.json
    python scripts/eval-ac4.py path/to/trace.json
    python scripts/eval-ac4.py -                        # stdin
    bash   scripts/eval-ac4.sh                          # shell wrapper
"""
import json
import math
import sys
from pathlib import Path

CLASSIFY_TARGET_MS = 100.0
EVENT_WS_TARGET_MS = 1000.0


def parse_line(line: str):
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def find_field(rec, name):
    """tracing_subscriber JSON 의 다양한 nesting 지원."""
    if name in rec:
        return rec[name]
    fields = rec.get("fields")
    if isinstance(fields, dict) and name in fields:
        return fields[name]
    return None


def event_name(rec):
    m = find_field(rec, "message")
    if m is not None:
        return m
    span = rec.get("span")
    if isinstance(span, dict):
        return span.get("name")
    return None


def percentile(xs, p):
    """nearest-rank ceil-1 (sorted xs 가정)."""
    if not xs:
        return None
    idx = max(min(math.ceil(p * len(xs)) - 1, len(xs) - 1), 0)
    return xs[idx]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "rust-service/logs/trace.json"
    if src == "-":
        fp = sys.stdin
        src_label = "stdin"
    else:
        path = Path(src)
        if not path.exists():
            sys.exit(
                f"ERR: {src} 없음.\n"
                "      A 측 rust-service 가 tracing 캡처해야 함 — 예:\n"
                "      VELXOR_STUB=collector ./scripts/run-all.sh "
                "(rust-service/logs/trace.json 에 stderr 캡처)"
            )
        fp = open(path)
        src_label = src

    classify_latencies = []
    classify_failed = 0
    evt_in_by_seq = {}
    ws_out_latencies = []

    for line in fp:
        rec = parse_line(line)
        if not rec:
            continue
        name = event_name(rec)
        if name == "classify_done":
            lm = find_field(rec, "latency_ms")
            if isinstance(lm, (int, float)):
                classify_latencies.append(float(lm))
        elif name == "classify_failed":
            classify_failed += 1
        elif name == "evt_in":
            seq = find_field(rec, "seq")
            ts = find_field(rec, "event_received_ts")
            if seq is not None and ts is not None:
                evt_in_by_seq[seq] = ts
        elif name == "ws_out":
            seq = find_field(rec, "seq")
            ts = find_field(rec, "ws_sent_ts")
            if seq is not None and ts is not None and seq in evt_in_by_seq:
                ws_out_latencies.append(ts - evt_in_by_seq[seq])

    if fp is not sys.stdin:
        fp.close()

    classify_latencies.sort()
    ws_out_latencies.sort()

    print(f"=== AC4 classify (p99 < {CLASSIFY_TARGET_MS:.0f}ms)  src={src_label} ===")
    if classify_latencies:
        n = len(classify_latencies)
        print(f"  n={n}  failed={classify_failed}"
              f"  failed_ratio={classify_failed / (n + classify_failed):.3f}")
        print(f"  p50={percentile(classify_latencies, 0.50):.2f}ms  "
              f"p95={percentile(classify_latencies, 0.95):.2f}ms  "
              f"p99={percentile(classify_latencies, 0.99):.2f}ms  "
              f"max={classify_latencies[-1]:.2f}ms")
        p99 = percentile(classify_latencies, 0.99)
        classify_pass = p99 < CLASSIFY_TARGET_MS
        print(f"  AC4 classify : {'PASS' if classify_pass else 'FAIL'}")
    else:
        print("  n=0 — classify_done events 없음.")
        print("       원인 후보: (1) burst trigger (FileWrite >= 50/1s) 미발생,")
        print("                 (2) A 측 tracing instrumentation 미동작.")
        classify_pass = False

    print()
    print(f"=== event → ws (p99 < {EVENT_WS_TARGET_MS:.0f}ms, best effort) ===")
    if ws_out_latencies:
        n = len(ws_out_latencies)
        print(f"  n={n}  (seq 매칭된 evt_in ↔ ws_out 페어)")
        print(f"  p50={percentile(ws_out_latencies, 0.50):.2f}ms  "
              f"p95={percentile(ws_out_latencies, 0.95):.2f}ms  "
              f"p99={percentile(ws_out_latencies, 0.99):.2f}ms  "
              f"max={ws_out_latencies[-1]:.2f}ms")
        p99_ws = percentile(ws_out_latencies, 0.99)
        ws_pass = p99_ws < EVENT_WS_TARGET_MS
        print(f"  event→ws     : {'PASS' if ws_pass else 'FAIL'}")
    else:
        print("  n=0 — seq 매칭된 페어 없음 (evt_in / ws_out 둘 다 seq 필드 필요).")

    # AC4 게이트는 classify p99 단일 — event→ws 는 best effort 보고만.
    sys.exit(0 if classify_pass else 1)


if __name__ == "__main__":
    main()
