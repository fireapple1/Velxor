#!/usr/bin/env python3
"""AC5 held-out v3 + bursty-benign negative 평가 — worker-C-timeline §7.1.

기준 (consensus-plan §AC5):
    held-out v3 (.pdf → .locked, 학습 절대 미포함) → TP ≥ 9/10
    negative (rsync/unzip/git/npm)                  → FP ≤ 1/10

honest reporting (CLAUDE.md / role-assignment.md):
- 임계값 0.5 사후 조정 금지
- v3 결과를 슬라이드/문서에 그대로 기재
- AC5c disclaimer 필수 ("synthetic PoC, not real-world malware")

실행 (repo root):
    python scripts/eval-ac5.py
    bash   scripts/eval-ac5.sh   # shell wrapper
"""
import glob
import json
import pickle
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python-engine"))

from features import FEATURE_NAMES, slice_to_windows, to_vector  # noqa: E402

WINDOW_MS = 1000
MIN_EVENTS_PER_WINDOW = 4  # train.py 와 동일 — 극저활동 window 제외
DECISION_THRESHOLD = 0.5  # 사후 조정 금지 (AC5 정책)
MODEL_PATH = ROOT / "python-engine" / "model" / "model.pkl"

with open(MODEL_PATH, "rb") as f:
    model = pickle.load(f)


def predict(path: Path):
    """파일 내 모든 1s window 분류 → max proba 가 ≥ threshold 면 ransomware.

    Option D (AC5-results v3 §2.2): 실 운영 streaming 시 fanotify 가
    1초 단위로 batch 를 보내고, 한 batch 라도 ransomware-class 면 차단.
    동일 semantics 를 평가에서 적용."""
    with open(path) as fp:
        events = [json.loads(line) for line in fp if line.strip()]
    windows = slice_to_windows(events, WINDOW_MS)
    eligible = [w for w in windows if len(w) >= MIN_EVENTS_PER_WINDOW]
    if not eligible:
        # 극저활동 file — benign 기본값
        return "benign", 0.0, len(events), 0
    probas = [
        float(model.predict_proba([to_vector(w, WINDOW_MS)])[0][1])
        for w in eligible
    ]
    max_proba = max(probas)
    verdict = "ransomware" if max_proba >= DECISION_THRESHOLD else "benign"
    return verdict, max_proba, len(events), len(eligible)


def main():
    heldout = sorted(Path(p) for p in glob.glob(str(ROOT / "datasets/heldout/v3/*.jsonl")))
    negative = sorted(Path(p) for p in glob.glob(str(ROOT / "datasets/negative/*.jsonl")))

    if not heldout:
        sys.exit("ERR: datasets/heldout/v3/*.jsonl 없음")
    if not negative:
        sys.exit("ERR: datasets/negative/*.jsonl 없음")

    tp = fn = fp = tn = 0
    rows = []

    print("=== Held-out v3 (expect ransomware) ===")
    print(f"{'file':<35} {'verdict':<11} {'max_proba':<10} "
          f"{'n_events':<9} {'n_win':<6} label")
    for path in heldout:
        verdict, proba, n_ev, n_win = predict(path)
        if verdict == "ransomware":
            tp += 1
            label = "TP"
        else:
            fn += 1
            label = "FN"
        rows.append((path.name, "v3", verdict, proba, n_ev, label))
        print(f"  {path.name:<33} {verdict:<11} {proba:.3f}      "
              f"{n_ev:<9} {n_win:<6} [{label}]")

    print()
    print("=== Negative (expect benign) ===")
    print(f"{'file':<35} {'verdict':<11} {'max_proba':<10} "
          f"{'n_events':<9} {'n_win':<6} label")
    for path in negative:
        verdict, proba, n_ev, n_win = predict(path)
        if verdict == "ransomware":
            fp += 1
            label = "FP"
        else:
            tn += 1
            label = "TN"
        rows.append((path.name, "negative", verdict, proba, n_ev, label))
        print(f"  {path.name:<33} {verdict:<11} {proba:.3f}      "
              f"{n_ev:<9} {n_win:<6} [{label}]")

    n_pos = tp + fn
    n_neg = fp + tn

    print()
    print("=== AC5 ===")
    print(f"threshold        : {DECISION_THRESHOLD}  (사후 조정 금지)")
    print(f"feature_names    : {FEATURE_NAMES}")
    print(f"TP / positive    : {tp}/{n_pos}   (require >= 9/10)")
    print(f"FN / positive    : {fn}/{n_pos}")
    print(f"FP / negative    : {fp}/{n_neg}   (require <= 1/10)")
    print(f"TN / negative    : {tn}/{n_neg}")

    tp_ok = tp / n_pos >= 0.9
    fp_ok = fp / n_neg <= 0.1
    overall = tp_ok and fp_ok
    print(f"TP rate    >= 0.9 : {'PASS' if tp_ok else 'FAIL'}")
    print(f"FP rate    <= 0.1 : {'PASS' if fp_ok else 'FAIL'}")
    print(f"AC5 overall      : {'PASS' if overall else 'FAIL'}")

    sys.exit(0 if overall else 1)


if __name__ == "__main__":
    main()
