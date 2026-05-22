"""PoC v1: .docx → .docx.enc rename + 32B prefix write, target 300 files/1s.
Usage: python simulate.py <target_dir> [--count 300]
"""
import argparse, os, secrets, time
from pathlib import Path

def run(target_dir: Path, count: int):
    target_dir.mkdir(parents=True, exist_ok=True)
    # 사전 생성: .docx 파일 N개 준비
    for i in range(count):
        (target_dir / f"doc_{i:04d}.docx").write_bytes(b"DUMMYDOC" * 16)

    t0 = time.perf_counter()
    for i in range(count):
        src = target_dir / f"doc_{i:04d}.docx"
        dst = target_dir / f"doc_{i:04d}.docx.enc"
        os.replace(src, dst)              # rename
        with open(dst, "r+b") as f:
            f.write(secrets.token_bytes(32))  # 32B prefix overwrite
    elapsed = time.perf_counter() - t0
    print(f"v1: {count} ops in {elapsed*1000:.1f} ms ({count/elapsed:.0f} ops/s)")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=300)
    args = p.parse_args()
    run(args.target_dir, args.count)
