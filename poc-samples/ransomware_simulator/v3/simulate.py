"""PoC v3: .pdf → .locked rename + 32B prefix write, target 200 files/2s.
사전 파일 크기는 512B~64KiB random noise (학습 분포 다양화), PDF 매직 prefix 유지.

⚠️ HELD-OUT — 본 variant 의 산출 로그는 절대 datasets/positive/ 에 포함 금지.
   학습 데이터에 들어가면 AC5a (held-out 일반화) 평가가 무효화된다.
   적재 경로: datasets/heldout/v3/  (worker-C-timeline §6.2, §9 책임 #3)

Usage: python simulate.py <target_dir> [--count 200]
"""
import argparse, os, random, secrets, time
from pathlib import Path

PDF_MAGIC = b"%PDF-1.4\n"

def run(target_dir: Path, count: int):
    target_dir.mkdir(parents=True, exist_ok=True)
    # 사전 생성: .pdf 파일 N개 — PDF 매직 prefix + size 에 random noise
    for i in range(count):
        size = random.randint(512, 65536)
        body = secrets.token_bytes(size - len(PDF_MAGIC))
        (target_dir / f"report_{i:04d}.pdf").write_bytes(PDF_MAGIC + body)

    t0 = time.perf_counter()
    for i in range(count):
        src = target_dir / f"report_{i:04d}.pdf"
        dst = target_dir / f"report_{i:04d}.locked"
        os.replace(src, dst)              # rename
        with open(dst, "r+b") as f:
            f.write(secrets.token_bytes(32))  # 32B prefix overwrite
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"v3: {count} ops in {elapsed_ms:.3f} ms ({count/(elapsed_ms/1000):.0f} ops/s)")
    print(f"AC2_MEASURED_MS={elapsed_ms:.3f}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=200)
    args = p.parse_args()
    run(args.target_dir, args.count)
