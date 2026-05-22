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

# 모드 결정:
#   stub (VELXOR_STUB in {engine, both})  → 하드코드 verdict, model 미사용
#   model 로드 성공                        → lr-2026w7 (LogisticRegression)
#   model 로드 실패 / 부재                 → rule-based-v1 (영속 fallback)
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
        MODEL_VERSION = "rule-based-v1"
else:
    _MODEL = None
    MODEL_VERSION = "rule-based-v1"


@app.get("/health")
def health():
    return jsonify(status="ok", model_version=MODEL_VERSION), 200


@app.post("/classify")
def classify():
    body = request.get_json(silent=True) or {}
    events = body.get("events") or []
    try:
        window_ms = int(body.get("window_ms", 1000))
    except (TypeError, ValueError):
        window_ms = 1000

    # 1) stub 모드 — 모델/룰 우회, 항상 ransomware 0.95 (AC8 영속성)
    if VELXOR_STUB in ("engine", "both"):
        return jsonify(
            verdict="ransomware",
            confidence=0.95,
            evidence=["stub: VELXOR_STUB hardcoded verdict"],
            model_version=MODEL_VERSION,
        ), 200

    # 2) 모델 없음 → fallback rules (영속 백업)
    if _MODEL is None:
        return jsonify(**rule_classify(events, window_ms)), 200

    # 3) 모델 추론
    try:
        vec = to_vector(events, window_ms)
        proba = float(_MODEL.predict_proba([vec])[0][1])  # [1] = ransomware class
    except Exception:
        # 추론 실패 시 fallback rules — 항상 200 보장 (AC4/AC8)
        return jsonify(**rule_classify(events, window_ms)), 200

    verdict = "ransomware" if proba >= 0.5 else "benign"
    confidence = proba if verdict == "ransomware" else 1.0 - proba
    return jsonify(
        verdict=verdict,
        confidence=confidence,
        evidence=[f"lr_proba={proba:.3f}"],
        model_version=MODEL_VERSION,
    ), 200
