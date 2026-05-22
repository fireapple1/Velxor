import os
from flask import Flask, jsonify, request

app = Flask(__name__)

VELXOR_STUB = os.getenv("VELXOR_STUB", "")
MODEL_VERSION = "stub-v1" if VELXOR_STUB == "engine" else "rule-based-v1"

@app.get("/health")
def health():
    return jsonify(status="ok", model_version=MODEL_VERSION), 200

@app.post("/classify")
def classify():
    _ = request.get_json(silent=True) or {}
    # Week 1 하드코드 응답 — Week 6+에 실제 모델/규칙으로 교체
    return jsonify(
        verdict="ransomware",
        confidence=0.95,
        evidence=["stub: hardcoded for walking-skeleton-v1"],
        model_version=MODEL_VERSION,
    ), 200
