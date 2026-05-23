"""simulate v1/v2/v3 공용 변형 헬퍼.

목적: 동일 simulate.py 를 N 회 호출해도 매번 서로 다른 분포를 emit 해
LR 모델이 '암기' 가 아닌 'sliding window 통계' 를 학습하도록.

학습/평가 결정성을 유지하려면 simulate 호출 전 random.seed() 를 외부에서 고정.
gen-positive.py 가 run_idx 별로 seed 를 주입한다.

결정성 (Codex audit #9, AC5 v3.1+): 모든 byte payload 는 `random.randbytes()` 사용
(이전 `secrets.token_bytes` 는 OS entropy 라 seed 무관). 같은 seed 면 file_size /
content / 충돌 회피 idx 모두 비트 재현 가능.
"""
import os
import random
from pathlib import Path

NAME_POOL = ("doc", "report", "note", "file", "data", "memo", "draft", "letter")


def jitter_count(base: int, pct: float = 0.20) -> int:
    """base * (1 ± pct) 사이 정수. 최소 1."""
    lo = max(1, int(base * (1.0 - pct)))
    hi = max(lo + 1, int(base * (1.0 + pct)))
    return random.randint(lo, hi)


def rand_size(min_b: int = 512, max_b: int = 262144) -> int:
    """파일 사전 생성 크기 — 512B ~ 256KiB."""
    return random.randint(min_b, max_b)


def rand_name(idx: int) -> str:
    """파일명 prefix 풀에서 랜덤 선택 + zero-padded idx."""
    return f"{random.choice(NAME_POOL)}_{idx:04d}"


def gen_source_files(target_dir: Path, count: int, src_ext: str,
                     header: bytes = b"") -> list[Path]:
    """사전 생성된 source 파일 리스트 반환 (rename 대상)."""
    paths = []
    for i in range(count):
        size = rand_size()
        body_len = max(0, size - len(header))
        payload = header + random.randbytes(body_len)
        p = target_dir / f"{rand_name(i)}{src_ext}"
        # 같은 이름 충돌 회피 — 충돌 시 idx 추가 (random seeded → 결정적)
        while p.exists():
            p = target_dir / f"{rand_name(i)}_{random.randint(0, 0xFFFF):04x}{src_ext}"
        p.write_bytes(payload)
        paths.append(p)
    return paths


def apply_encryption_write(path: Path) -> None:
    """write pattern 4종 중 하나를 random 적용. 평균 ~32-128B 쓰기."""
    pattern = random.choice(("prefix", "prefix_suffix", "multi_chunk", "full"))
    size = path.stat().st_size
    with open(path, "r+b") as f:
        if pattern == "prefix":
            f.seek(0)
            f.write(random.randbytes(32))
        elif pattern == "prefix_suffix":
            f.seek(0)
            f.write(random.randbytes(32))
            if size > 64:
                f.seek(-32, os.SEEK_END)
                f.write(random.randbytes(32))
        elif pattern == "multi_chunk":
            n_chunks = random.randint(3, 5)
            chunk_size = random.choice((16, 32, 64))
            for _ in range(n_chunks):
                off = random.randint(0, max(0, size - chunk_size))
                f.seek(off)
                f.write(random.randbytes(chunk_size))
        else:  # full
            f.seek(0)
            f.write(random.randbytes(size))


def rename_with_jitter(src: Path, dst_ext_pool: tuple[str, ...]) -> Path:
    """src 를 dst_ext_pool 중 하나로 rename 후 새 경로 반환."""
    ext = random.choice(dst_ext_pool)
    dst = src.with_suffix("").with_name(src.stem + ext)
    os.replace(src, dst)
    return dst
