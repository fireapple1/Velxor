"""PoC v2: .txt → .crypted rename + 32B prefix write, target 500 files/0.8s.
사전 파일 크기는 512B~64KiB random noise (학습 분포 다양화).
Usage: python simulate.py <target_dir> [--count 500]
"""
import argparse, os, random, secrets, time
from pathlib import Path

def run(target_dir: Path, count: int):
    target_dir.mkdir(parents=True, exist_ok=True)
    # 사전 생성: .txt 파일 N개 — size 에 random noise
    for i in range(count):
        size = random.randint(512, 65536)
        (target_dir / f"note_{i:04d}.txt").write_bytes(secrets.token_bytes(size))

    t0 = time.perf_counter()
    for i in range(count):
        src = target_dir / f"note_{i:04d}.txt"
        dst = target_dir / f"note_{i:04d}.crypted"
        os.replace(src, dst)              # rename
        with open(dst, "r+b") as f:
            f.write(secrets.token_bytes(32))  # 32B prefix overwrite
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"v2: {count} ops in {elapsed_ms:.3f} ms ({count/(elapsed_ms/1000):.0f} ops/s)")
    print(f"AC2_MEASURED_MS={elapsed_ms:.3f}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=500)
    args = p.parse_args()
    run(args.target_dir, args.count)
