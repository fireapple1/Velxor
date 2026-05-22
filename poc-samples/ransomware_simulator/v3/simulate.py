"""PoC v3: .pdf → locked-ext rename + variable-pattern write — HELD-OUT.

⚠️ 본 variant 의 산출 로그는 절대 datasets/positive/ 에 포함 금지.
   학습 데이터에 들어가면 AC5a (held-out 일반화) 평가가 무효화된다.
   적재 경로: datasets/heldout/v3/

기본 count=200 (±20% jitter), PDF magic prefix 유지.
write pattern + dst_ext + count jitter 은 _common 공용.
"""
import argparse, random, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from _common import (
    jitter_count, gen_source_files, apply_encryption_write,
    rename_with_jitter,
)

PDF_MAGIC = b"%PDF-1.4\n"
DST_EXT_POOL = (".locked", ".pdf.lock", ".lock_pdf", ".pdf.crypt", ".enc_pdf")


def run(target_dir: Path, base_count: int, seed: int | None):
    if seed is not None:
        random.seed(seed)
    target_dir.mkdir(parents=True, exist_ok=True)
    count = jitter_count(base_count)
    sources = gen_source_files(target_dir, count, ".pdf", header=PDF_MAGIC)
    order = list(range(len(sources)))
    random.shuffle(order)
    dst_ext = random.choice(DST_EXT_POOL)

    t0 = time.perf_counter()
    for i in order:
        src = sources[i]
        dst = rename_with_jitter(src, (dst_ext,))
        apply_encryption_write(dst)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"v3: {count} ops in {elapsed_ms:.3f} ms ({count/(elapsed_ms/1000):.0f} ops/s)")
    print(f"AC2_MEASURED_MS={elapsed_ms:.3f}")
    print(f"DST_EXT={dst_ext}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=200)
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()
    run(args.target_dir, args.count, args.seed)
