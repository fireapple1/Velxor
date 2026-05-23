#!/usr/bin/env python3
"""Bursty-benign Ubuntu 워크로드 실행 + 디렉토리 스캔 → BehaviorEventV1 JSONL
(worker-C-timeline §6.4, 방식 C 하이브리드).

방식 C 의미: A 의 fanotify collector 없이 C 단독으로 진행. 워크로드 실행 후
결과 디렉토리를 os.walk + os.stat 으로 스캔해 합성 이벤트 emit. positive 와
동일 BehaviorEventV1 v1.0 schema, FileRename + FileWrite dual emit 일관.
A 의 fanotify 가 살아나면 동일 워크로드를 collector 로 재캡처해 비교 검증 예정.

적재 경로: datasets/negative/<label>_run_01.jsonl

⚠️ ext4 로컬에 두고 /tmp(tmpfs) 회피 — tmpfs 는 RAM 직격이라 디스크 IO 분포가
   비현실적으로 빨라짐 (timeline §6.4 본문).

Usage (repo root, venv 활성화 후, 인터넷 필요):
    scripts/gen-negative.py                       # 4 workload × 변형 = 10 runs
    scripts/gen-negative.py --workload rsync_500  # 단일 워크로드
"""
import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
NEGATIVE_DIR = REPO_ROOT / "datasets" / "negative"
WORK_ROOT = Path.home() / "velxor-work"


def prep_source_tree(src_dir: Path, n: int):
    """대량 rename/write 유도용 소파일 트리 사전 준비."""
    if src_dir.exists():
        shutil.rmtree(src_dir)
    src_dir.mkdir(parents=True)
    for i in range(n):
        (src_dir / f"file_{i:04d}.txt").write_text(f"dummy-{i}\n")


def prep_zip_archive(zip_path: Path, n: int):
    """unzip 워크로드용 zip 사전 생성."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in range(n):
            zf.writestr(f"entry_{i:04d}.dat", f"payload-{i}\n" * 8)


def scan_to_events(dst_dir: Path, t_start_ms: int, spread_ms: float,
                   exclude_subdirs: tuple[str, ...] = (),
                   pid: int = 20000) -> list[dict]:
    """결과 디렉토리 walk → 파일별 FileRename + FileWrite dual emit (positive 일관).
    ts 는 t_start + (i/n) × spread_ms 로 균등 분배 — mtime 폭주 회피.

    spread_ms: 합성 분포 폭. 실측 워크로드 elapsed 가 아닌 인위적 값 권장
    (write_rate 분포 다양화 — Option D, AC5-results v3 §4.5).
    exclude_subdirs: walk 시 무시할 서브디렉토리 이름 (예: ('node_modules',)).
    pid: 결정성 (Codex audit #9) — os.getpid() 는 invocation 마다 달라져
         같은 seed 재생성이 byte-identical 안 됨. caller 가 명시 sentinel 주입."""
    parent_pid = 1
    image_path = "/synthetic/negative-workload"
    paths = []
    for root, dirs, files in os.walk(dst_dir):
        # in-place 수정으로 walk 가 무시
        dirs[:] = [d for d in dirs if d not in exclude_subdirs]
        for name in files:
            paths.append(Path(root) / name)
    paths.sort()

    n = max(len(paths), 1)
    events = []
    seq = 0
    for i, p in enumerate(paths):
        try:
            st = p.stat()
        except FileNotFoundError:
            continue
        ts = t_start_ms + int((i / n) * spread_ms)
        seq += 1
        events.append({
            "schema_version": "1.0",
            "seq": seq,
            "dropped_since_last": 0,
            "pid": pid,
            "parent_pid": parent_pid,
            "image_path": image_path,
            "event_type": "FileRename",
            "file_path": str(p),
            "op_detail": {"src_path": f"{p}.tmp", "dst_path": str(p)},
            "ts_unix_ms": ts,
        })
        seq += 1
        events.append({
            "schema_version": "1.0",
            "seq": seq,
            "dropped_since_last": 0,
            "pid": pid,
            "parent_pid": parent_pid,
            "image_path": image_path,
            "event_type": "FileWrite",
            "file_path": str(p),
            "op_detail": {"file_size": st.st_size},
            "ts_unix_ms": ts,
        })
    return events


def write_jsonl(events: list[dict], out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")


def run_rsync(n_files: int) -> Path:
    src = WORK_ROOT / f"rsync_src_{n_files}"
    dst = WORK_ROOT / f"rsync_dst_{n_files}"
    shutil.rmtree(dst, ignore_errors=True)
    prep_source_tree(src, n_files)
    subprocess.run(
        ["rsync", "-aH", "--delete", f"{src}/", f"{dst}/"],
        check=True, capture_output=True, timeout=60,
    )
    return dst


def run_unzip(n_entries: int) -> Path:
    zip_path = WORK_ROOT / f"archive_{n_entries}.zip"
    dst = WORK_ROOT / f"unzip_dst_{n_entries}"
    shutil.rmtree(dst, ignore_errors=True)
    prep_zip_archive(zip_path, n_entries)
    subprocess.run(
        ["unzip", "-o", "-q", str(zip_path), "-d", str(dst)],
        check=True, capture_output=True, timeout=60,
    )
    return dst


def run_git_clone(repo_url: str, name: str) -> Path:
    dst = WORK_ROOT / f"git_{name}"
    shutil.rmtree(dst, ignore_errors=True)
    subprocess.run(
        ["git", "clone", "--depth", "1", repo_url, str(dst)],
        check=True, capture_output=True, timeout=120,
    )
    return dst


def run_npm_install(name: str) -> Path:
    repo_dir = WORK_ROOT / f"git_{name}"
    if not repo_dir.exists():
        raise FileNotFoundError(f"{repo_dir} 미존재 — git_clone 먼저 실행")
    subprocess.run(
        ["npm", "install", "--silent", "--no-audit", "--no-fund"],
        cwd=str(repo_dir),
        check=True, capture_output=True, timeout=300,
    )
    return repo_dir / "node_modules"


WORKLOADS = [
    ("rsync_300",   lambda: run_rsync(300)),
    ("rsync_500",   lambda: run_rsync(500)),
    ("rsync_1000",  lambda: run_rsync(1000)),
    ("rsync_2000",  lambda: run_rsync(2000)),
    ("unzip_200",   lambda: run_unzip(200)),
    ("unzip_500",   lambda: run_unzip(500)),
    ("unzip_1000",  lambda: run_unzip(1000)),
    ("unzip_2000",  lambda: run_unzip(2000)),
    ("gitclone_express",
        lambda: run_git_clone("https://github.com/expressjs/express", "express")),
    ("npm_install_express",
        lambda: run_npm_install("express")),
]

# --reuse 모드: 워크로드 재실행 없이 캐시 dst 만 사용 (네트워크/시간 절약).
# 외부 네트워크 워크로드 (git_clone, npm_install) 는 절대 재실행 금지 정책.
LABEL_TO_DST = {
    "rsync_300":           WORK_ROOT / "rsync_dst_300",
    "rsync_500":           WORK_ROOT / "rsync_dst_500",
    "rsync_1000":          WORK_ROOT / "rsync_dst_1000",
    "rsync_2000":          WORK_ROOT / "rsync_dst_2000",
    "unzip_200":           WORK_ROOT / "unzip_dst_200",
    "unzip_500":           WORK_ROOT / "unzip_dst_500",
    "unzip_1000":          WORK_ROOT / "unzip_dst_1000",
    "unzip_2000":          WORK_ROOT / "unzip_dst_2000",
    "gitclone_express":    WORK_ROOT / "git_express",
    "npm_install_express": WORK_ROOT / "git_express" / "node_modules",
}

# gitclone_express 가 npm install 이후 호출되면 node_modules 가 동일 디렉토리에
# 적재돼 있음 — gitclone 시점의 git blob 만 잡으려면 node_modules 배제 필요.
LABEL_EXCLUDE_SUBDIRS = {
    "gitclone_express": ("node_modules",),
}

# 결정성 (Codex audit #9): --reuse + --spreads 모드에서 time.time() 대신 fixed epoch.
# legacy non-reuse 모드는 실 워크로드 시각 그대로 — file content 도 비결정적이므로
# 결정성 보장 X (이 경로는 baseline 생성 1 회용).
BASE_TS_MS = 1779_000_000_000  # 2026-05-23 ~ stable epoch
LABEL_TS_STRIDE_MS = 100_000   # label 간 격리 (10 workloads × 100k = 1M range/seed)


def parse_spreads(spec: str) -> list[float]:
    """'1,5,30' → [1.0, 5.0, 30.0]"""
    out = [float(s.strip()) for s in spec.split(",") if s.strip()]
    if not out:
        raise ValueError("spread pool empty")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--workload", default="all",
                   help="라벨 또는 'all' (10종)")
    p.add_argument("--spreads", default="",
                   help="ts spread pool in seconds, comma-sep. "
                        "예: '1,5,30'. 미지정 시 실측 elapsed 사용 (legacy 호환).")
    p.add_argument("--runs", type=int, default=1,
                   help="workload × spread 별 run 수 (default 1)")
    p.add_argument("--seed", type=int, default=None,
                   help="결정적 실행 (run_idx 시드와 결합)")
    p.add_argument("--out-suffix", default="",
                   help="파일명 접미사 — augment 모드에서 기존 *_run_01 덮어쓰기 방지")
    p.add_argument("--reuse", action="store_true",
                   help="워크로드 재실행 없이 LABEL_TO_DST 캐시만 사용 — "
                        "git/npm 같은 외부 네트워크 회피 (Option D augment 모드)")
    args = p.parse_args()

    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    NEGATIVE_DIR.mkdir(parents=True, exist_ok=True)

    selected = WORKLOADS if args.workload == "all" else [
        (l, fn) for l, fn in WORKLOADS if l == args.workload
    ]
    if not selected:
        print(f"unknown workload: {args.workload}", file=sys.stderr)
        sys.exit(2)

    spread_pool = parse_spreads(args.spreads) if args.spreads else []

    successes, skips = [], []
    for label, fn in selected:
        if args.reuse:
            dst = LABEL_TO_DST.get(label)
            if dst is None or not dst.exists():
                skips.append((label, "reuse: dst cache missing"))
                print(f"  {label}: SKIP (reuse: {dst} missing)", file=sys.stderr)
                continue
            measured_elapsed_ms = 0.0
        else:
            try:
                t0 = time.perf_counter()
                dst = fn()
                measured_elapsed_ms = (time.perf_counter() - t0) * 1000
            except (subprocess.CalledProcessError, FileNotFoundError,
                    subprocess.TimeoutExpired) as e:
                skips.append((label, f"{type(e).__name__}"))
                print(f"  {label}: SKIP ({type(e).__name__})", file=sys.stderr)
                continue

        if spread_pool:
            # spread × runs grid — same dst 디렉토리, 다른 ts 분포
            label_idx = next(
                (i for i, (l, _) in enumerate(WORKLOADS) if l == label), 0
            )
            for spread_s in spread_pool:
                spread_ms = spread_s * 1000.0
                for run_idx in range(1, args.runs + 1):
                    if args.seed is not None:
                        random.seed(args.seed + run_idx)
                    # 결정적 t_start_ms — label/spread/run 격리, time.time() 무관
                    t_start_ms = (BASE_TS_MS
                                  + label_idx * LABEL_TS_STRIDE_MS
                                  + int(spread_s * 1000) * 10
                                  + run_idx)
                    # pid 결정성: label_idx + run_idx 기반 sentinel (20000+ 대역)
                    sentinel_pid = 20000 + label_idx * 100 + run_idx
                    events = scan_to_events(
                        dst, t_start_ms, spread_ms,
                        exclude_subdirs=LABEL_EXCLUDE_SUBDIRS.get(label, ()),
                        pid=sentinel_pid,
                    )
                    if not events:
                        skips.append((f"{label}_s{spread_s:g}_run_{run_idx:02d}",
                                      "0 events"))
                        continue
                    fname = (f"{label}_s{spread_s:g}s_run_{run_idx:02d}"
                             f"{args.out_suffix}.jsonl")
                    out = NEGATIVE_DIR / fname
                    write_jsonl(events, out)
                    successes.append((label, spread_s, run_idx, len(events)))
                    print(f"  {label} spread={spread_s}s run={run_idx}: "
                          f"{len(events)} events → {out.relative_to(REPO_ROOT)}")
        else:
            # legacy: 실측 elapsed 한 번
            t_start_ms = int(time.time() * 1000)
            events = scan_to_events(
                dst, t_start_ms, measured_elapsed_ms,
                exclude_subdirs=LABEL_EXCLUDE_SUBDIRS.get(label, ()),
            )
            if not events:
                skips.append((label, "0 events scanned"))
                continue
            out = NEGATIVE_DIR / f"{label}_run_01{args.out_suffix}.jsonl"
            write_jsonl(events, out)
            successes.append((label, None, 1, len(events)))
            print(f"  {label}: {len(events)} events in {measured_elapsed_ms:.0f} ms "
                  f"→ {out.relative_to(REPO_ROOT)}")

    print()
    print(f"=== generated {len(successes)} negative JSONL files "
          f"(skipped {len(skips)}) ===")
    if skips:
        print("--- skipped ---")
        for l, r in skips:
            print(f"  {l}: {r}")


if __name__ == "__main__":
    main()
