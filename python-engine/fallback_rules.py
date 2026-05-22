"""Rule-based fallback. /classify가 학습 모델 미달 시 영속 백업.
입력: events list of {event_type, ts_unix_ms, ...}, window_ms,
      model_version (override: 호출 컨텍스트에 따라 prefix 구분)
출력: dict {verdict, confidence, evidence, model_version}

interface-schema.md §2.2.1 prefix enum:
  rules-v1           — 학습 모델 미로드 영속 룰 (default)
  rules-fallback-v1  — 학습 추론 예외 시 자동 fallback (app.py 가 override)
"""
from collections import Counter

MODEL_VERSION = "rules-v1"

def classify_events(events: list[dict], window_ms: int,
                    model_version: str | None = None) -> dict:
    mv = model_version or MODEL_VERSION
    counts = Counter(e.get("event_type") for e in events)
    writes = counts.get("FileWrite", 0)
    window_s = max(window_ms / 1000.0, 1e-9)
    write_rate = writes / window_s

    if write_rate >= 50:
        return {
            "verdict": "ransomware",
            "confidence": 0.9,
            "evidence": [f"write_rate={write_rate:.1f}/s >= 50"],
            "model_version": mv,
        }
    return {
        "verdict": "benign",
        "confidence": 0.6,
        "evidence": [f"write_rate={write_rate:.1f}/s"],
        "model_version": mv,
    }
