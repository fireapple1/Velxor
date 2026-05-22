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


def _ext(p):
    if not p:
        return None
    return p.rsplit(".", 1)[-1].lower() if "." in p else ""


def _size(e):
    od = e.get("op_detail") or {}
    return od.get("file_size")


def _zero_vector():
    return {name: 0.0 for name in FEATURE_NAMES}
