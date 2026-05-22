"""Edge case unit tests — worker-C-timeline §7 흡수.
to-worker-c.md §4.2 "events 배열 edge case" 자가확인 evidence.

v1.1 schema (interface-schema.md §2.1-§2.4) 후속 반영:
  §2.1 body 상한 (events≤1024, body≤4MiB) → test_classify_oversized_events_returns_413
  §2.2.1 model_version prefix enum (rules-v1 / rules-fallback-v1 / lr- / stub-)
        → test_model_version_no_legacy_rule_based_v1
  §2.2.2 empty events 표준화 → test_classify_empty_events_returns_benign_zero
  §2.4 health status enum (ok / degraded) → test_health_status_enum
"""
import os
import importlib

import pytest


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("VELXOR_STUB", raising=False)
    import app  # noqa: WPS433
    importlib.reload(app)
    app.app.testing = True
    with app.app.test_client() as c:
        yield c


@pytest.fixture
def stub_engine_client(monkeypatch):
    monkeypatch.setenv("VELXOR_STUB", "engine")
    import app  # noqa: WPS433
    importlib.reload(app)
    app.app.testing = True
    with app.app.test_client() as c:
        yield c


@pytest.fixture
def stub_both_client(monkeypatch):
    monkeypatch.setenv("VELXOR_STUB", "both")
    import app  # noqa: WPS433
    importlib.reload(app)
    app.app.testing = True
    with app.app.test_client() as c:
        yield c


def test_health_returns_200_with_model_version(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.get_json()
    assert body["status"] in ("ok", "degraded")
    assert "model_version" in body


def test_health_status_enum(client):
    """v1.1 §2.4 — lr-* / stub-* 는 ok, rules-* 는 degraded."""
    body = client.get("/health").get_json()
    if body["model_version"].startswith(("lr-", "stub-")):
        assert body["status"] == "ok"
    else:
        assert body["status"] == "degraded"


def test_classify_empty_events_returns_benign_zero(client):
    """v1.1 §2.2.2 — empty events 모든 모드 공통 표준화."""
    r = client.post("/classify", json={"events": [], "window_ms": 1000})
    assert r.status_code == 200
    body = r.get_json()
    assert body["verdict"] == "benign"
    assert body["confidence"] == 0.0
    assert body["evidence"] == ["no events in window"]
    assert "model_version" in body


def test_classify_empty_events_stub_also_benign_zero(stub_engine_client):
    """v1.1 §2.2.2 — stub 모드도 empty events 시 hardcoded ransomware 우회."""
    r = stub_engine_client.post("/classify", json={"events": [], "window_ms": 1000})
    body = r.get_json()
    assert r.status_code == 200
    assert body["verdict"] == "benign"
    assert body["confidence"] == 0.0


def test_classify_oversized_events_returns_413(client):
    """v1.1 §2.1 — events.length > 1024 → 413 events_overflow."""
    events = [
        {"event_type": "FileWrite", "ts_unix_ms": i, "pid": 1, "parent_pid": 0,
         "image_path": "/x", "seq": i, "dropped_since_last": 0,
         "schema_version": "1.0", "file_path": f"/x/{i}"}
        for i in range(1025)
    ]
    r = client.post("/classify", json={"events": events, "window_ms": 1000})
    assert r.status_code == 413
    body = r.get_json()
    assert body["error"] == "events_overflow"
    assert body["max_events"] == 1024


def test_model_version_no_legacy_rule_based_v1(client):
    """v1.1 §2.2.1 — 'rule-based-v1' 은 v1.0 의 drift, v1.1 에서 'rules-v1' 로 rename."""
    body = client.get("/health").get_json()
    assert body["model_version"] != "rule-based-v1"
    prefix = body["model_version"].split("-")[0]
    assert prefix in ("lr", "rules", "stub"), body["model_version"]


def test_classify_single_event_returns_200(client):
    r = client.post("/classify", json={
        "events": [{
            "schema_version": "1.0",
            "seq": 1,
            "dropped_since_last": 0,
            "pid": 1234,
            "parent_pid": 1,
            "image_path": "/usr/bin/python3",
            "event_type": "FileWrite",
            "file_path": "/tmp/a.docx",
            "ts_unix_ms": 1716300000000,
        }],
        "window_ms": 1000,
    })
    assert r.status_code == 200


def test_classify_many_events_returns_200(client):
    events = [
        {
            "schema_version": "1.0",
            "seq": i,
            "dropped_since_last": 0,
            "pid": 1234,
            "parent_pid": 1,
            "image_path": "/usr/bin/python3",
            "event_type": "FileWrite",
            "file_path": f"/tmp/doc_{i}.docx",
            "ts_unix_ms": 1716300000000 + i,
        }
        for i in range(300)
    ]
    r = client.post("/classify", json={"events": events, "window_ms": 1000})
    assert r.status_code == 200
    body = r.get_json()
    assert body["verdict"] in ("benign", "ransomware")


def test_model_version_consistency_engine_and_both_both_emit_stub(
    stub_engine_client, stub_both_client,
):
    """to-worker-c.md §4.1 — VELXOR_STUB in (engine, both) → stub-v1 일관."""
    he = stub_engine_client.get("/health").get_json()
    hb = stub_both_client.get("/health").get_json()
    assert he["model_version"] == "stub-v1"
    assert hb["model_version"] == "stub-v1"


def test_malformed_json_does_not_crash(client):
    r = client.post(
        "/classify",
        data="not-json-at-all",
        content_type="application/json",
    )
    assert r.status_code == 200
