#!/usr/bin/env python3
"""v1/v2/v3 simulate 를 실행하면서 BehaviorEventV1 JSONL 데이터셋 합성.

적재 경로 (worker-C-timeline §6.3):
    v1/v2 → datasets/positive/<variant>_run_NN.jsonl  (학습용)
    v3    → datasets/heldout/v3/v3_run_NN.jsonl       (held-out, 학습 금지)

각 simulate 1 run = 1 JSONL = 2*count 이벤트 (FileRename + FileWrite interleaved).
ts_unix_ms 는 simulate 측정 시작점 + (op_idx / count) × elapsed 로 균등 분배.
schema: contracts/interface-schema.md §1 BehaviorEventV1 v1.0 호환.

⚠️ 본 합성 데이터셋은 collector v1.1 (FileRename emit 추가) 가정.
   v1.0 collector 는 FileRename 미발행 — 학습 후 실 운영 distribution 정합 확인 필요.

Usage (repo root, venv 활성화 후):
    scripts/gen-positive.py                       # v1/v2/v3 × 10 runs 기본
    scripts/gen-positive.py --variant v1 --runs 3
    scripts/gen-positive.py --count 100           # variant default count override
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

VARIANT_RULES = {
    "v1": {
        "simulate": REPO_ROOT / "poc-samples/ransomware_simulator/v1/simulate.py",
        "dst_glob": "*.docx.enc",
        "src_ext": ".docx",
        "dst_ext": ".docx.enc",
        "default_count": 300,
        "out_dir": REPO_ROOT / "datasets/positive",
    },
    "v2": {
        "simulate": REPO_ROOT / "poc-samples/ransomware_simulator/v2/simulate.py",
        "dst_glob": "*.crypted",
        "src_ext": ".txt",
        "dst_ext": ".crypted",
        "default_count": 500,
        "out_dir": REPO_ROOT / "datasets/positive",
    },
    "v3": {
        "simulate": REPO_ROOT / "poc-samples/ransomware_simulator/v3/simulate.py",
        "dst_glob": "*.locked",
        "src_ext": ".pdf",
        "dst_ext": ".locked",
        "default_count": 200,
        "out_dir": REPO_ROOT / "datasets/heldout/v3",
    },
}

AC2_RE = re.compile(r"AC2_MEASURED_MS=([0-9.]+)")


def synth_one_run(variant: str, count: int, run_idx: int) -> Path:
    rule = VARIANT_RULES[variant]
    out_dir = rule["out_dir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{variant}_run_{run_idx:02d}.jsonl"

    with tempfile.TemporaryDirectory(prefix=f"velxor-{variant}-") as tmp:
        t_start_ms = int(time.time() * 1000)
        result = subprocess.run(
            [sys.executable, str(rule["simulate"]), tmp, "--count", str(count)],
            capture_output=True, text=True, check=True,
        )
        m = AC2_RE.search(result.stdout)
        if not m:
            raise RuntimeError(f"{variant}: AC2_MEASURED_MS missing in simulate output")
        elapsed_ms = float(m.group(1))

        dst_files = sorted(Path(tmp).glob(rule["dst_glob"]))
        if len(dst_files) != count:
            raise RuntimeError(
                f"{variant}: expected {count} dst files, got {len(dst_files)}"
            )

        pid = os.getpid()
        parent_pid = os.getppid()
        image_path = sys.executable
        events = []
        seq = 0
        for i, dst in enumerate(dst_files):
            ts = t_start_ms + int((i / count) * elapsed_ms)
            base = dst.name[: -len(rule["dst_ext"])]
            src_path = str(dst.parent / f"{base}{rule['src_ext']}")
            dst_path = str(dst)

            seq += 1
            events.append({
                "schema_version": "1.0",
                "seq": seq,
                "dropped_since_last": 0,
                "pid": pid,
                "parent_pid": parent_pid,
                "image_path": image_path,
                "event_type": "FileRename",
                "file_path": dst_path,
                "op_detail": {"src_path": src_path, "dst_path": dst_path},
                "ts_unix_ms": ts,
            })
            seq += 1
            try:
                fsize = dst.stat().st_size
            except FileNotFoundError:
                fsize = 0
            events.append({
                "schema_version": "1.0",
                "seq": seq,
                "dropped_since_last": 0,
                "pid": pid,
                "parent_pid": parent_pid,
                "image_path": image_path,
                "event_type": "FileWrite",
                "file_path": dst_path,
                "op_detail": {"file_size": fsize},
                "ts_unix_ms": ts,
            })

        with out_path.open("w") as f:
            for e in events:
                f.write(json.dumps(e) + "\n")

    return out_path


def main():
    p = argparse.ArgumentParser()
    p.add_argument(
        "--variant",
        choices=list(VARIANT_RULES.keys()) + ["all"],
        default="all",
    )
    p.add_argument("--runs", type=int, default=10, help="variant당 run 횟수")
    p.add_argument(
        "--count", type=int, default=None,
        help="run당 op count (미지정 시 variant default 사용)",
    )
    args = p.parse_args()

    variants = list(VARIANT_RULES.keys()) if args.variant == "all" else [args.variant]
    summary = []
    for v in variants:
        count = args.count if args.count is not None else VARIANT_RULES[v]["default_count"]
        for r in range(1, args.runs + 1):
            out = synth_one_run(v, count, r)
            summary.append((v, r, count, out))
            print(f"  {v}_run_{r:02d}: count={count}  → {out.relative_to(REPO_ROOT)}")

    print()
    print(f"=== generated {len(summary)} JSONL files ===")
    by_v = {}
    for v, _, _, _ in summary:
        by_v[v] = by_v.get(v, 0) + 1
    for v, n in sorted(by_v.items()):
        out_dir = VARIANT_RULES[v]["out_dir"].relative_to(REPO_ROOT)
        print(f"  {v}: {n} files in {out_dir}/")


if __name__ == "__main__":
    main()
