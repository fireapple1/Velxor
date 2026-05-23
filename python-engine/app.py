import os
import pickle
from pathlib import Path

from flask import Flask, jsonify, request

from features import slice_to_windows, to_vector
from fallback_rules import classify_events as rule_classify

app = Flask(__name__)

VELXOR_STUB = os.getenv("VELXOR_STUB", "")
ENGINE_DIR = Path(__file__).resolve().parent
MODEL_PATH = ENGINE_DIR / "model" / "model.pkl"

# v1.1 §2.1 Request body 상한 — A aggregator burst window 정렬
MAX_EVENTS = 1024
MAX_BODY_BYTES = 4 * 1024 * 1024  # 4 MiB
# Content-Length 누락 / chunked 인 경우에도 Werkzeug 가 4MiB 초과 시 413 거부.
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

# train.py / eval-ac5.py 와 동일 — per-window 추론 정합 (Option D, AC5 v3 §2.2).
# rust-service aggregator 가 보내는 batch 가 단일 1s window 보다 길 수 있어
# (debounce ≥ 1s 간격, 다 PID 동시 burst) serve 측도 슬라이싱 필요.
MIN_EVENTS_PER_WINDOW = 4

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


@app.errorhandler(413)
def _too_large(_):
    """Werkzeug MAX_CONTENT_LENGTH 거부 시 schema §2.1 error payload 통일."""
    return jsonify(error="events_overflow", max_events=MAX_EVENTS), 413


@app.post("/classify")
def classify():
    # v1.1 §2.1 body 상한 — Content-Length 도 strict (MAX_CONTENT_LENGTH 가 본체)
    cl = request.content_length
    if cl is not None and cl > MAX_BODY_BYTES:
        return jsonify(error="events_overflow", max_events=MAX_EVENTS), 413

    # malformed / non-JSON body → 400 (이전에는 silent=True 로 200 benign 통과 — 보안 결함)
    body = request.get_json(silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify(error="bad_request", reason="json object required"), 400

    events = body.get("events", [])
    if not isinstance(events, list):
        return jsonify(error="bad_request", reason="events must be list"), 400
    if events and not all(isinstance(e, dict) for e in events):
        return jsonify(error="bad_request", reason="events items must be objects"), 400

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

    # 3) 모델 추론 — per-window slicing + max(window_proba) (train.py / eval-ac5.py 정합)
    try:
        windows = slice_to_windows(events, window_ms)
        eligible = [w for w in windows if len(w) >= MIN_EVENTS_PER_WINDOW]
        if not eligible:
            # 모든 window 가 min_events 미만 → 저활동 batch, eval-ac5.py 와 동일
            # 의미 (benign / no-signal) 로 응답. lr 모델 호출 회피하지만 verdict 일관.
            return jsonify(
                verdict="benign",
                confidence=0.0,
                evidence=[f"no eligible window (all < MIN_EVENTS={MIN_EVENTS_PER_WINDOW})"],
                model_version=MODEL_VERSION,
            ), 200
        probas = [
            float(_MODEL.predict_proba([to_vector(w, window_ms)])[0][1])
            for w in eligible
        ]
        proba = max(probas)
    except Exception:
        # v1.1 §2.2.1 — 추론 예외 → rules-fallback-v1 (영속 룰과 구분)
        return jsonify(
            **rule_classify(events, window_ms, model_version="rules-fallback-v1")
        ), 200

    verdict = "ransomware" if proba >= 0.5 else "benign"
    confidence = proba if verdict == "ransomware" else 1.0 - proba
    evidence = [f"lr_max_proba={proba:.3f}", f"n_windows={len(eligible)}"]
    return jsonify(
        verdict=verdict,
        confidence=confidence,
        evidence=evidence,
        model_version=MODEL_VERSION,
    ), 200
