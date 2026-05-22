"""PoC v1: .docx → encrypted-ext rename + variable-pattern write.

기본 count=300 (±20% jitter), 사전 파일 크기 512B~256KiB.
dst extension 은 풀에서 run-당 random 선택 — 학습이 single 문자열에 overfit X.
write pattern 4종 (prefix / prefix+suffix / multi_chunk / full) 매 op 별 random.
op 순서 shuffle — sequential bias 제거.

stdout: AC2_MEASURED_MS=<float>  (poc-bench.sh + gen-positive.py grep)
        DST_EXT=<.ext>           (gen-positive.py 가 산출 파일 glob)

학습 결정성: gen-positive.py 가 --seed 로 random.seed() 주입.
Usage: python simulate.py <target_dir> [--count 300] [--seed N]
"""
import argparse, random, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from _common import (
    jitter_count, gen_source_files, apply_encryption_write,
    rename_with_jitter,
)

DST_EXT_POOL = (".docx.enc", ".docx.encrypted", ".docx.crypt",
                ".docx.lock", ".crypted_docx")


def run(target_dir: Path, base_count: int, seed: int | None):
    if seed is not None:
        random.seed(seed)
    target_dir.mkdir(parents=True, exist_ok=True)
    count = jitter_count(base_count)
    sources = gen_source_files(target_dir, count, ".docx")
    order = list(range(len(sources)))
    random.shuffle(order)
    dst_ext = random.choice(DST_EXT_POOL)

    t0 = time.perf_counter()
    for i in order:
        src = sources[i]
        dst = rename_with_jitter(src, (dst_ext,))
        apply_encryption_write(dst)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"v1: {count} ops in {elapsed_ms:.3f} ms ({count/(elapsed_ms/1000):.0f} ops/s)")
    print(f"AC2_MEASURED_MS={elapsed_ms:.3f}")
    print(f"DST_EXT={dst_ext}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("target_dir", type=Path)
    p.add_argument("--count", type=int, default=300)
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()
    run(args.target_dir, args.count, args.seed)
