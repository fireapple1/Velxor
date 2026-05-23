"""행위 윈도우 통계 추출 — Velxor 분류기 입력 피처.

입력:
    events: BehaviorEventV1 dict list (contracts/interface-schema.md §1.1)
    window_ms: int — sliding window 길이 (밀리초)
출력:
    extract()  → dict {피처명: float}
    to_vector() → 순서 보장 list[float] (학습 모델 column order)

FEATURE_NAMES 의 순서가 학습 모델 column order 와 1:1 결합 — 변경 금지.
dict insertion order 에 의존하지 말고 to_vector() 또는 FEATURE_NAMES 명시 인덱싱.
"""
from collections import Counter
import numpy as np

FEATURE_NAMES = (
    "write_rate",
    "rename_rate",
    "ext_diversity",
    "size_mean",
    "size_std",
    "pid_fanout",
)


def extract(events, window_ms):
    if not events:
        return _zero_vector()

    types = Counter(e.get("event_type") for e in events)
    exts = Counter(
        _ext(e.get("file_path")) for e in events if e.get("file_path")
    )
    sizes = [s for s in (_size(e) for e in events) if s is not None and s >= 0]
    pids = Counter(e.get("pid") for e in events if e.get("pid") is not None)

    w_s = max(window_ms / 1000.0, 1e-9)
    return {
        "write_rate":    types.get("FileWrite", 0) / w_s,
        "rename_rate":   types.get("FileRename", 0) / w_s,
        "ext_diversity": float(len(exts)),
        "size_mean":     float(np.mean(sizes)) if sizes else 0.0,
        "size_std":      float(np.std(sizes)) if sizes else 0.0,
        "pid_fanout":    float(len(pids)),
    }


def to_vector(events, window_ms):
    """학습/추론용 순서 보장 vector (numpy-호환 list[float])."""
    feats = extract(events, window_ms)
    return [feats[name] for name in FEATURE_NAMES]


def slice_to_windows(events, window_ms):
    """events 를 ts_unix_ms 기준 [window_ms] bucket 으로 분할.

    train/eval 전용 — live app.py 는 rust-service 가 이미 슬라이싱한 batch 를 받음.
    Option D (AC5-results v3 §2.2): JSONL 단일 sample 대신 시간 윈도우 단위로
    feature 추출 → ts spread 다양화 효과 학습.

    빈 입력 → []. window_ms ≤ 0 → 전체를 단일 window 로 묶음 (legacy 호환)."""
    if not events:
        return []
    if window_ms <= 0:
        return [list(events)]
    sorted_events = sorted(events, key=lambda e: e.get("ts_unix_ms", 0))
    t0 = sorted_events[0].get("ts_unix_ms", 0)
    buckets = {}
    for e in sorted_events:
        idx = (e.get("ts_unix_ms", t0) - t0) // window_ms
        buckets.setdefault(idx, []).append(e)
    return [buckets[k] for k in sorted(buckets.keys())]


def _ext(p):
    if not p:
        return None
    return p.rsplit(".", 1)[-1].lower() if "." in p else ""


def _size(e):
    od = e.get("op_detail") or {}
    return od.get("file_size")


def _zero_vector():
    return {name: 0.0 for name in FEATURE_NAMES}
