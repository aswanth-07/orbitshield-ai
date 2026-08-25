"""Train and export the feed-compatible two-day conjunction triage model."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, fbeta_score, precision_score, recall_score
from sklearn.utils.class_weight import compute_sample_weight

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))

from train_model import RESERVED_EVENT_ID, RISK_THRESHOLD, SEED, load_event_table, split_events


DEFAULT_ARCHIVE = Path(os.environ.get("TEMP", ".")) / "orbitshield-esa-train-data.zip"
DEFAULT_ARTIFACT = ROOT / "ml" / "artifacts" / "public_triage" / "public_triage.joblib"
DEFAULT_OUTPUT = ROOT / "app" / "data" / "public-triage-model.json"
SOURCE_COLUMNS = ["event_id", "time_to_tca", "risk", "miss_distance", "relative_speed"]
FEATURE_NAMES = ["latest_time_to_tca", "latest_risk", "latest_miss_distance", "latest_relative_speed"]
MAX_HORIZON_DAYS = 2.0


def metrics(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, float]:
    predicted = scores >= threshold
    return {
        "threshold": float(threshold),
        "f2": float(fbeta_score(labels, predicted, beta=2, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "pr_auc": float(average_precision_score(labels, scores)),
    }


def optimize_threshold(labels: np.ndarray, scores: np.ndarray) -> tuple[float, dict[str, float]]:
    candidates = np.unique(np.concatenate([np.linspace(0.01, 0.99, 197), scores]))
    best_threshold = 0.5
    best_key = (-1.0, -1.0, -1.0)
    for threshold in candidates:
        result = metrics(labels, scores, float(threshold))
        key = (result["f2"], result["recall"], result["precision"])
        if key > best_key:
            best_key = key
            best_threshold = float(threshold)
    return best_threshold, metrics(labels, scores, best_threshold)


def export_trees(model: HistGradientBoostingClassifier) -> list[list[dict[str, float | int | bool]]]:
    trees = []
    for iteration in model._predictors:
        nodes = []
        for node in iteration[0].nodes:
            nodes.append({
                "value": float(node["value"]),
                "feature": int(node["feature_idx"]),
                "threshold": float(node["num_threshold"]),
                "left": int(node["left"]),
                "right": int(node["right"]),
                "missingLeft": bool(node["missing_go_to_left"]),
                "leaf": bool(node["is_leaf"]),
            })
        trees.append(nodes)
    return trees


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the public-feed two-day triage model.")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    event_table, _, dataset_stats = load_event_table(args.archive)
    train_events, validation_events, test_events = split_events(event_table)
    raw = pd.read_csv(args.archive, usecols=SOURCE_COLUMNS, low_memory=False)
    raw = raw.replace([np.inf, -np.inf], np.nan)
    final_risk = raw.loc[raw.groupby("event_id")["time_to_tca"].idxmin(), ["event_id", "risk"]]
    final_risk = final_risk.rename(columns={"risk": "final_risk"}).set_index("event_id")

    window = raw[(raw["time_to_tca"] >= 0) & (raw["time_to_tca"] <= MAX_HORIZON_DAYS)].copy()
    boundary_rows = window.loc[window.groupby("event_id")["time_to_tca"].idxmax()].set_index("event_id")
    samples = boundary_rows.join(final_risk, how="inner")
    samples["risk"] = samples["risk"].clip(-30.0, 0.0)
    samples["high_risk"] = (samples["final_risk"] >= RISK_THRESHOLD).astype(int)
    samples = samples.rename(columns={
        "time_to_tca": "latest_time_to_tca",
        "risk": "latest_risk",
        "miss_distance": "latest_miss_distance",
        "relative_speed": "latest_relative_speed",
    })

    train = samples.loc[samples.index.intersection(train_events.index)]
    validation = samples.loc[samples.index.intersection(validation_events.index)]
    test = samples.loc[samples.index.intersection(test_events.index)]
    medians = train[FEATURE_NAMES].median(numeric_only=True).fillna(0.0)

    def matrix(frame: pd.DataFrame) -> pd.DataFrame:
        return frame[FEATURE_NAMES].replace([np.inf, -np.inf], np.nan).fillna(medians).astype(float)

    model = HistGradientBoostingClassifier(
        learning_rate=0.06,
        max_iter=260,
        max_leaf_nodes=31,
        min_samples_leaf=25,
        l2_regularization=1.0,
        early_stopping=True,
        random_state=SEED,
    )
    y_train = train["high_risk"].to_numpy(dtype=int)
    model.fit(matrix(train), y_train, sample_weight=compute_sample_weight(class_weight="balanced", y=y_train))
    validation_scores = model.predict_proba(matrix(validation))[:, 1]
    threshold, validation_metrics = optimize_threshold(validation["high_risk"].to_numpy(dtype=int), validation_scores)
    test_scores = model.predict_proba(matrix(test))[:, 1]
    test_metrics = metrics(test["high_risk"].to_numpy(dtype=int), test_scores, threshold)

    args.artifact.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "medians": medians.to_dict(), "features": FEATURE_NAMES}, args.artifact)
    digest = hashlib.sha256(args.artifact.read_bytes()).hexdigest().upper()
    payload = {
        "schemaVersion": 1,
        "id": "orbitshield-public-hgb-2d-v1",
        "name": "Two-day Public Feed HGB",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESA Collision Avoidance Challenge, feed-compatible feature subset",
        "artifactSha256": digest,
        "cutoffDays": 0.0,
        "maxHorizonDays": MAX_HORIZON_DAYS,
        "riskThresholdLog10": RISK_THRESHOLD,
        "scoreThreshold": threshold,
        "baseline": float(model._baseline_prediction[0, 0]),
        "featureNames": FEATURE_NAMES,
        "featureLabels": ["Time to TCA", "Current log10 Pc", "Miss distance", "Relative speed"],
        "medians": [float(medians[name]) for name in FEATURE_NAMES],
        "categoryMap": {},
        "trees": export_trees(model),
        "validation": validation_metrics,
        "test": test_metrics,
        "dataset": {
            **dataset_stats,
            "trainEvents": int(len(train)),
            "validationEvents": int(len(validation)),
            "testEvents": int(len(test)),
            "reservedEventExcluded": bool(RESERVED_EVENT_ID not in train.index and RESERVED_EVENT_ID not in validation.index and RESERVED_EVENT_ID not in test.index),
        },
        "crosswalk": {
            "latest_time_to_tca": "SOCRATES TCA minus current time, days",
            "latest_risk": "log10 of SOCRATES maximum probability",
            "latest_miss_distance": "SOCRATES minimum range converted to metres",
            "latest_relative_speed": "SOCRATES relative speed converted to metres per second",
        },
        "warning": "The score ranks analyst review priority. It is not a collision probability or manoeuvre command.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "trees": len(payload["trees"]),
        "threshold": threshold,
        "validation": validation_metrics,
        "test": test_metrics,
        "dataset": payload["dataset"],
    }, indent=2))


if __name__ == "__main__":
    main()
