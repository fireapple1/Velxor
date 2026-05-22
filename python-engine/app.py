import os
import pickle
from pathlib import Path

from flask import Flask, jsonify, request

from features import to_vector
from fallback_rules import classify_events as rule_classify

app = Flask(__name__)

VELXOR_STUB = os.getenv("VELXOR_STUB", "")
ENGINE_DIR = Path(__file__).resolve().parent
MODEL_PATH = ENGINE_DIR / "model" / "model.pkl"

# v1.1 §2.1 Request body 상한 — A aggregator burst window 정렬
MAX_EVENTS = 1024
MAX_BODY_BYTES = 4 * 1024 * 1024  # 4 MiB

# 모드 결정 (interface-schema.md §2.2.1 prefix enum):
#   stub-v1            VELXOR_STUB in {engine, both} → 하드코드 verdict
#   lr-2026w7          model.pkl 로드 성공
#   rules-v1           model 로드 실패 / 부재 → 영속 룰 (§2.2.1)
# 추론 실패 시점에는 rules-fallback-v1 (rule_classify model_version override)
if VELXOR_STUB in ("engine", "both"):
    _MODEL = None
    MODEL_VERSION = "stub-v1"
elif MODEL_PATH.exists():
    try:
        with open(MODEL_PATH, "rb") as f:
            _MODEL = pickle.load(f)
        MODEL_VERSION = "lr-2026w7"
    except Exception:
        _MODEL = None
        MODEL_VERSION = "rules-v1"
else:
    _MODEL = None
    MODEL_VERSION = "rules-v1"


@app.get("/health")
def health():
    # v1.1 §2.4 status enum
    #   ok       — lr-* 학습 모델 로드 성공
    #   degraded — rules-* 영속 룰 또는 fallback 으로 응답 중
    #   stub-*   — 데모/시연 모드 (down 아님, ok 로 분류)
    status = "ok" if MODEL_VERSION.startswith(("lr-", "stub-")) else "degraded"
    return jsonify(status=status, model_version=MODEL_VERSION), 200


@app.post("/classify")
def classify():
    # v1.1 §2.1 body 상한 — Content-Length 우선 (큰 body 일찍 거부)
    cl = request.content_length
    if cl is not None and cl > MAX_BODY_BYTES:
        return jsonify(error="events_overflow", max_events=MAX_EVENTS), 413

    body = request.get_json(silent=True) or {}
    events = body.get("events") or []
    try:
        window_ms = int(body.get("window_ms", 1000))
    except (TypeError, ValueError):
        window_ms = 1000

    if len(events) > MAX_EVENTS:
        return jsonify(error="events_overflow", max_events=MAX_EVENTS), 413

    # v1.1 §2.2.2 empty events 표준화 — 모든 모드 공통 (stub/lr/rules)
    if not events:
        return jsonify(
            verdict="benign",
            confidence=0.0,
            evidence=["no events in window"],
            model_version=MODEL_VERSION,
        ), 200

    # 1) stub 모드 — 모델/룰 우회, 항상 ransomware 0.95 (AC8 영속성)
    if VELXOR_STUB in ("engine", "both"):
        return jsonify(
            verdict="ransomware",
            confidence=0.95,
            evidence=["stub: VELXOR_STUB hardcoded verdict"],
            model_version=MODEL_VERSION,
        ), 200

    # 2) 모델 없음 → 영속 룰 (rules-v1)
    if _MODEL is None:
        return jsonify(**rule_classify(events, window_ms)), 200

    # 3) 모델 추론
    try:
        vec = to_vector(events, window_ms)
        proba = float(_MODEL.predict_proba([vec])[0][1])  # [1] = ransomware class
    except Exception:
        # v1.1 §2.2.1 — 추론 예외 → rules-fallback-v1 (영속 룰과 구분)
        return jsonify(
            **rule_classify(events, window_ms, model_version="rules-fallback-v1")
        ), 200

    verdict = "ransomware" if proba >= 0.5 else "benign"
    confidence = proba if verdict == "ransomware" else 1.0 - proba
    return jsonify(
        verdict=verdict,
        confidence=confidence,
        evidence=[f"lr_proba={proba:.3f}"],
        model_version=MODEL_VERSION,
    ), 200
