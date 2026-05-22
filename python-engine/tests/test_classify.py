"""Edge case unit tests — worker-C-timeline §7 흡수.
to-worker-c.md §4.2 "events 배열 edge case" 자가확인 evidence.

본 테스트는 *현 동작* 을 잠그는 baseline 이다. v1.1 발행 후 c-review-notes §1.3
(빈 events → benign 0.0 표준화) 반영 시 test_empty_events_returns_200 의
expected verdict 가 갱신되어야 한다 — 그 시점에 의도된 행위 변경 evidence.
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
    assert body["status"] == "ok"
    assert "model_version" in body


def test_classify_empty_events_returns_200(client):
    r = client.post("/classify", json={"events": [], "window_ms": 1000})
    assert r.status_code == 200
    body = r.get_json()
    assert body["verdict"] in ("benign", "ransomware")
    assert 0.0 <= body["confidence"] <= 1.0
    assert isinstance(body["evidence"], list)
    assert "model_version" in body


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
