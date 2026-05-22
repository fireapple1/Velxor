"""features.extract / to_vector 단위 테스트 — worker-C-timeline §6.5.

pytest 기반. 통합 테스트(실 데이터셋) 는 dataset 없으면 skip.
"""
import json
import sys
from pathlib import Path

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))
REPO_ROOT = ENGINE_DIR.parent

from features import FEATURE_NAMES, extract, to_vector  # noqa: E402


def test_empty_events_returns_zero_vector():
    v = extract([], 1000)
    assert v == {name: 0.0 for name in FEATURE_NAMES}


def test_feature_names_stable_order():
    """학습 모델 column order 의존 — 변경 시 train.py 도 깨짐."""
    assert FEATURE_NAMES == (
        "write_rate", "rename_rate", "ext_diversity",
        "size_mean", "size_std", "pid_fanout",
    )


def test_single_filewrite_event():
    events = [{
        "event_type": "FileWrite",
        "file_path": "/tmp/a.docx",
        "op_detail": {"file_size": 100},
        "pid": 1234,
    }]
    v = extract(events, 1000)
    assert v["write_rate"] == 1.0
    assert v["rename_rate"] == 0.0
    assert v["ext_diversity"] == 1.0
    assert v["size_mean"] == 100.0
    assert v["size_std"] == 0.0
    assert v["pid_fanout"] == 1.0


def test_window_ms_zero_safe():
    """ZeroDivision 방지 — w_s 가 1e-9 로 클램프."""
    events = [{"event_type": "FileWrite", "pid": 1}]
    v = extract(events, 0)
    assert v["write_rate"] > 1e8


def test_to_vector_order_matches_feature_names():
    events = [{
        "event_type": "FileRename",
        "file_path": "/x/y.txt",
        "op_detail": {"file_size": 42},
        "pid": 99,
    }]
    vec = to_vector(events, 1000)
    feats = extract(events, 1000)
    assert vec == [feats[n] for n in FEATURE_NAMES]


def test_ext_diversity_case_insensitive():
    events = [
        {"event_type": "FileWrite", "file_path": f"/x/a.{ext}", "pid": 1}
        for ext in ("docx", "txt", "pdf", "DOCX")
    ]
    v = extract(events, 1000)
    assert v["ext_diversity"] == 3.0


def test_size_missing_or_negative_skipped():
    events = [
        {"event_type": "FileWrite", "pid": 1},  # op_detail 없음
        {"event_type": "FileWrite", "pid": 1, "op_detail": {"file_size": -1}},  # negative
        {"event_type": "FileWrite", "pid": 1, "op_detail": {"file_size": 100}},
    ]
    v = extract(events, 1000)
    assert v["size_mean"] == 100.0
    assert v["size_std"] == 0.0


def test_pid_fanout_distinct():
    events = [
        {"event_type": "FileWrite", "pid": p} for p in (1, 2, 3, 1, 2)
    ]
    v = extract(events, 1000)
    assert v["pid_fanout"] == 3.0


def test_mixed_rename_and_write_rates():
    events = (
        [{"event_type": "FileRename", "pid": 1}] * 30 +
        [{"event_type": "FileWrite",  "pid": 1}] * 60
    )
    v = extract(events, 1000)
    assert v["rename_rate"] == 30.0
    assert v["write_rate"] == 60.0


# 통합 — 실 데이터셋
@pytest.mark.parametrize("rel_path,expected_class", [
    ("datasets/positive/v1_run_01.jsonl",        "positive"),
    ("datasets/positive/v2_run_01.jsonl",        "positive"),
    ("datasets/negative/rsync_500_run_01.jsonl", "negative"),
    ("datasets/heldout/v3/v3_run_01.jsonl",      "heldout"),
])
def test_real_dataset_extracts_nonzero(rel_path, expected_class):
    path = REPO_ROOT / rel_path
    if not path.exists():
        pytest.skip(f"{path} not generated yet")
    events = [json.loads(l) for l in open(path)]
    v = extract(events, 1000)
    assert v["write_rate"] > 0
    assert v["rename_rate"] > 0
    for name in FEATURE_NAMES:
        assert isinstance(v[name], float)
