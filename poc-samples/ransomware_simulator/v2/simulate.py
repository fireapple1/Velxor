"""PoC v2: .txt → encrypted-ext rename + variable-pattern write.

기본 count=500 (±20% jitter), 나머지 변형 정책은 v1 과 동일 (_common 공용).

stdout: AC2_MEASURED_MS + DST_EXT.
"""
import argparse, random, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from _common import (
    jitter_count, gen_source_files, apply_encryption_write,
    rename_with_jitter,
)

DST_EXT_POOL = (".crypted", ".encrypted", ".crypt", ".locked_txt", ".txt.lock")


def run(target_dir: Path, base_count: int, seed: int | None):
    if seed is not None:
        random.seed(seed)
    target_dir.mkdir(parents=True, exist_ok=True)
    count = jitter_count(base_count)
    sources = gen_source_files(target_dir, count, ".txt")
    order = list(range(len(sources)))
    random.shuffle(order)
    dst_ext = random.choice(DST_EXT_POOL)

    t0 = time.perf_counter()
    for i in order:
        src = sources[i]
        dst = rename_with_jitter(src, (dst_ext,))
        apply_encryption_write(dst)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"v2: {count} ops in {elapsed_ms:.3f} ms ({count/(elapsed_ms/1000):.0f} ops/s)")
    print(f"AC2_MEASURED_MS={elapsed_ms:.3f}")
    print(f"DST_EXT={dst_ext}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=500)
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()
    run(args.target_dir, args.count, args.seed)
