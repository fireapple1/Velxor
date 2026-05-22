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
