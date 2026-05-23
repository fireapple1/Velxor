#!/usr/bin/env python3
"""interface-schema v1.1 ↔ 코드 deep drift 검증 (Codex audit #10).

기존 shell grep 만으로는 잡지 못한 semantic drift 를 Flask test_client +
Rust source 분석으로 검증한다.

검증 항목:
    §2.1  request body 상한
            - app.py MAX_EVENTS = 1024 (literal)
            - Flask MAX_CONTENT_LENGTH ≤ 4 MiB (실 동작)
            - oversized (1025) → 413
    §2.1  보안 입력 검증 (Codex Top 5 #1)
            - malformed JSON → 400
            - events 가 list 아님 → 400
            - events 항목이 dict 아님 → 400
    §2.2.1 model_version 4-prefix enum 모두 emit
            - "stub-v1", "lr-2026w7", "rules-v1", "rules-fallback-v1"
    §2.2.1 non-200 → verdict 미발행 (Rust classifier_client.rs)
            - "error_for_status()" 호출 존재
    §2.4  /health status enum
            - lr/stub → "ok", rules → "degraded"
    §3.2  WS message type 4종 emit (rust-service/src/*)
            - node_add, verdict, alert, gap

실패 항목 발견 시 stdout 명시 + exit 1.

실행 (repo root, venv 활성화 후):
    python scripts/check-schema-drift.py
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "python-engine"
RUST_DIR = ROOT / "rust-service" / "src"


def _ensure_app():
    sys.path.insert(0, str(APP_DIR))
    os.environ.pop("VELXOR_STUB", None)
    if "app" in sys.modules:
        importlib.reload(sys.modules["app"])
    import app  # noqa: E402
    return app


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def check_max_events_literal(report: list) -> None:
    src = _read(APP_DIR / "app.py")
    if "MAX_EVENTS = 1024" in src:
        report.append(("PASS", "§2.1 MAX_EVENTS = 1024 literal"))
    else:
        report.append(("FAIL", "§2.1 MAX_EVENTS = 1024 literal 미발견 (app.py)"))


def check_max_content_length_runtime(report: list, app_mod) -> None:
    cfg_val = app_mod.app.config.get("MAX_CONTENT_LENGTH")
    expected = 4 * 1024 * 1024
    if cfg_val == expected:
        report.append(("PASS",
                       f"§2.1 Flask MAX_CONTENT_LENGTH = {expected:,} bytes"))
    else:
        report.append(("FAIL",
                       f"§2.1 Flask MAX_CONTENT_LENGTH != {expected:,} "
                       f"(actual={cfg_val})"))


def check_oversized_413(report: list, app_mod) -> None:
    events = [
        {"event_type": "FileWrite", "ts_unix_ms": i, "pid": 1, "parent_pid": 0,
         "image_path": "/x", "seq": i, "dropped_since_last": 0,
         "schema_version": "1.0", "file_path": f"/x/{i}"}
        for i in range(1025)
    ]
    with app_mod.app.test_client() as c:
        r = c.post("/classify", json={"events": events, "window_ms": 1000})
    body = r.get_json() or {}
    if r.status_code == 413 and body.get("error") == "events_overflow":
        report.append(("PASS", "§2.1 oversized (1025 events) → 413 events_overflow"))
    else:
        report.append(("FAIL",
                       f"§2.1 oversized → 기대 413/events_overflow, "
                       f"실제 {r.status_code}/{body}"))


def check_malformed_json_400(report: list, app_mod) -> None:
    with app_mod.app.test_client() as c:
        r = c.post("/classify", data="not-json-at-all",
                   content_type="application/json")
    body = r.get_json() or {}
    if r.status_code == 400 and body.get("error") == "bad_request":
        report.append(("PASS", "§2.1 malformed JSON → 400 bad_request"))
    else:
        report.append(("FAIL",
                       f"§2.1 malformed JSON → 기대 400/bad_request, "
                       f"실제 {r.status_code}/{body}"))


def check_events_not_list_400(report: list, app_mod) -> None:
    with app_mod.app.test_client() as c:
        r = c.post("/classify", json={"events": "string-not-list",
                                      "window_ms": 1000})
    if r.status_code == 400:
        report.append(("PASS", "§2.1 events not list → 400 bad_request"))
    else:
        report.append(("FAIL",
                       f"§2.1 events not list → 기대 400, 실제 {r.status_code}"))


def check_events_item_not_dict_400(report: list, app_mod) -> None:
    with app_mod.app.test_client() as c:
        r = c.post("/classify", json={"events": [1, 2, 3], "window_ms": 1000})
    if r.status_code == 400:
        report.append(("PASS", "§2.1 events item not dict → 400 bad_request"))
    else:
        report.append(("FAIL",
                       f"§2.1 events item not dict → 기대 400, 실제 {r.status_code}"))


def check_model_version_prefixes(report: list) -> None:
    src = (_read(APP_DIR / "app.py")
           + "\n" + _read(APP_DIR / "fallback_rules.py"))
    for prefix in ('"stub-v1"', '"lr-2026w7"',
                   '"rules-v1"', '"rules-fallback-v1"'):
        if prefix in src:
            report.append(("PASS",
                           f"§2.2.1 model_version prefix {prefix} 존재"))
        else:
            report.append(("FAIL",
                           f"§2.2.1 model_version prefix {prefix} 미발견"))


def check_rust_error_for_status(report: list) -> None:
    src = _read(RUST_DIR / "classifier_client.rs")
    if ".error_for_status()" in src:
        report.append(("PASS",
                       "§2.2.1 classifier_client.rs error_for_status() 호출"))
    else:
        report.append(("FAIL",
                       "§2.2.1 classifier_client.rs error_for_status() 누락 — "
                       "non-200 verdict 미발행 보장 깨짐"))


def check_health_status_enum(report: list, app_mod) -> None:
    with app_mod.app.test_client() as c:
        r = c.get("/health")
    body = r.get_json() or {}
    status = body.get("status")
    mv = body.get("model_version", "")
    if status not in ("ok", "degraded"):
        report.append(("FAIL",
                       f"§2.4 /health status enum 위반: {status}"))
        return
    if mv.startswith(("lr-", "stub-")) and status != "ok":
        report.append(("FAIL",
                       f"§2.4 lr/stub 는 ok 강제 — 실제 {status} ({mv})"))
        return
    if mv.startswith("rules") and status != "degraded":
        report.append(("FAIL",
                       f"§2.4 rules- 는 degraded 강제 — 실제 {status} ({mv})"))
        return
    report.append(("PASS",
                   f"§2.4 /health status = {status} (model_version={mv})"))


def check_ws_message_types(report: list) -> None:
    src_concat = ""
    for p in RUST_DIR.glob("*.rs"):
        src_concat += "\n" + _read(p)
    for t in ("node_add", "verdict", "alert", "gap"):
        if f'"{t}"' in src_concat:
            report.append(("PASS", f"§3.2 WS message type \"{t}\" emit 코드 존재"))
        else:
            report.append(("FAIL",
                           f"§3.2 WS message type \"{t}\" emit 누락 (rust-service/src/*)"))


def main():
    app_mod = _ensure_app()
    report: list[tuple[str, str]] = []

    check_max_events_literal(report)
    check_max_content_length_runtime(report, app_mod)
    check_oversized_413(report, app_mod)
    check_malformed_json_400(report, app_mod)
    check_events_not_list_400(report, app_mod)
    check_events_item_not_dict_400(report, app_mod)
    check_model_version_prefixes(report)
    check_rust_error_for_status(report)
    check_health_status_enum(report, app_mod)
    check_ws_message_types(report)

    fails = [m for s, m in report if s == "FAIL"]
    print(f"=== check-schema-drift.py — {len(report)} 항목 ===")
    for s, m in report:
        glyph = "✅" if s == "PASS" else "❌"
        print(f"  {glyph} {m}")
    print()
    if not fails:
        print(f"[check-schema-drift] PASS — schema v1.1 ↔ 코드 일치 ({len(report)}/{len(report)})")
        return 0
    print(f"[check-schema-drift] FAIL — drift {len(fails)}/{len(report)}:")
    for m in fails:
        print(f"  - {m}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
