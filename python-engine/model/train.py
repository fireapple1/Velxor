"""v1+v2 positive + negative → LogisticRegression 학습 → model.pkl 발행.

class_weight="balanced" — 2:1 (positive 20 : negative 10) imbalance 보정
(worker-C-timeline §6.6 권장).
v3 held-out 은 학습 데이터에서 절대 제외 (AC5a 무효화 방지, §9 책임 #3).

honest reporting: 학습 후 feature coefficient 출력 → 어느 피처가 결정에
기여했는지 평가자가 검증 가능 (AC5 정책 — 임계값/가중치 사후 조정 금지).

실행 (repo root, venv 활성화 후):
    python python-engine/model/train.py
"""
import glob
import json
import pickle
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

ENGINE_DIR = Path(__file__).resolve().parent.parent
ROOT = ENGINE_DIR.parent
sys.path.insert(0, str(ENGINE_DIR))

from features import FEATURE_NAMES, slice_to_windows, to_vector  # noqa: E402

WINDOW_MS = 1000
MIN_EVENTS_PER_WINDOW = 4  # 극저활동 window 제외 (Option D)

X, y = [], []
per_file_counts = []

# positive: v1 + v2 만 (v3 held-out 절대 제외)
positive_files = sorted(
    glob.glob(str(ROOT / "datasets" / "positive" / "v[12]_*.jsonl"))
)
for path in positive_files:
    events = [json.loads(l) for l in open(path)]
    n_added = 0
    for window_events in slice_to_windows(events, WINDOW_MS):
        if len(window_events) < MIN_EVENTS_PER_WINDOW:
            continue
        X.append(to_vector(window_events, WINDOW_MS))
        y.append(1)
        n_added += 1
    per_file_counts.append((Path(path).name, "+", n_added))

negative_files = sorted(
    glob.glob(str(ROOT / "datasets" / "negative" / "*.jsonl"))
)
for path in negative_files:
    events = [json.loads(l) for l in open(path)]
    n_added = 0
    for window_events in slice_to_windows(events, WINDOW_MS):
        if len(window_events) < MIN_EVENTS_PER_WINDOW:
            continue
        X.append(to_vector(window_events, WINDOW_MS))
        y.append(0)
        n_added += 1
    per_file_counts.append((Path(path).name, "-", n_added))

if not X:
    sys.exit("ERR: 학습 샘플 없음 — datasets/positive 또는 datasets/negative 가 비어있음")

X = np.array(X)
y = np.array(y)
n_pos = int(y.sum())
n_neg = len(y) - n_pos
n_pos_files = sum(1 for _, l, _ in per_file_counts if l == "+")
n_neg_files = sum(1 for _, l, _ in per_file_counts if l == "-")
print(f"학습 샘플 (window-sliced @ {WINDOW_MS}ms, min_events={MIN_EVENTS_PER_WINDOW}):")
print(f"  positive(v1+v2): {n_pos} windows from {n_pos_files} files")
print(f"  negative       : {n_neg} windows from {n_neg_files} files")
print(f"  total          : {len(y)} samples")
print(f"features: {FEATURE_NAMES}")
print(f"X mean per feature: {np.round(X.mean(axis=0), 2)}")
print(f"X std  per feature: {np.round(X.std(axis=0), 2)}")

clf = LogisticRegression(max_iter=1000, class_weight="balanced").fit(X, y)
print(f"\nclasses_: {clf.classes_}  (== [0=benign, 1=ransomware])")
assert list(clf.classes_) == [0, 1], "class order 가 예상과 다름 — app.py predict_proba 인덱싱 깨짐"

print("\nfeature coefficients (honest reporting — 어느 피처가 결정에 기여했는가):")
for name, coef in zip(FEATURE_NAMES, clf.coef_[0]):
    print(f"  {name:<18} coef = {coef:+.6f}")
print(f"  intercept = {clf.intercept_[0]:+.4f}")

# train-set 정확도 (sanity check; overfit 우려는 §6.7 / AC5 평가에서 다룸)
acc = clf.score(X, y)
print(f"\ntrain accuracy: {acc:.4f}  (train-set fitness; held-out 평가는 AC5)")

MODEL_PATH = ENGINE_DIR / "model" / "model.pkl"
MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
with open(MODEL_PATH, "wb") as f:
    pickle.dump(clf, f)
print(f"\nsaved: {MODEL_PATH.relative_to(ROOT)}")
