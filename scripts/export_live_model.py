"""Export the trained HGB classifier and a complete held-out CDM stream."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ml.train_model import DELTA_COLUMNS, LATEST_COLUMNS, RESERVED_EVENT_ID


DEFAULT_ARTIFACT = ROOT / "ml" / "artifacts" / "model_benchmark" / "five_model_benchmark.joblib"
DEFAULT_ARCHIVE = Path(os.environ.get("TEMP", ".")) / "orbitshield-esa-train-data.zip"
DEFAULT_MODEL_OUTPUT = ROOT / "app" / "data" / "live-cdm-model.json"
DEFAULT_STREAM_OUTPUT = ROOT / "app" / "data" / "live-cdm-stream.json"


def finite(value: object) -> float | int | str | None:
    if isinstance(value, str):
        return value
    if pd.isna(value):
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    numeric = float(value)
    return numeric if math.isfinite(numeric) else None


def risk_slope(frame: pd.DataFrame) -> float:
    valid = frame[["time_to_tca", "risk"]].dropna()
    if len(valid) < 2:
        return 0.0
    x = valid["time_to_tca"].to_numpy(dtype=float)
    y = valid["risk"].to_numpy(dtype=float)
    denominator = len(x) * np.square(x).sum() - np.square(x.sum())
    if abs(denominator) < 1e-12:
        return 0.0
    return float((len(x) * np.multiply(x, y).sum() - x.sum() * y.sum()) / denominator)


def feature_row(
    messages: pd.DataFrame,
    feature_names: list[str],
    medians: dict[str, float],
    category_map: dict[str, int],
) -> pd.DataFrame:
    ordered = messages.sort_values("time_to_tca", ascending=True)
    latest = ordered.iloc[0]
    previous = ordered.iloc[1] if len(ordered) > 1 else None
    values: dict[str, float] = {}

    for column in LATEST_COLUMNS:
        values[f"latest_{column}"] = latest[column]
    for column in DELTA_COLUMNS:
        values[f"delta_{column}"] = latest[column] - previous[column] if previous is not None else np.nan

    values.update(
        visible_cdm_count=float(len(ordered)),
        visible_span_days=float(ordered["time_to_tca"].max() - ordered["time_to_tca"].min()),
        risk_mean=float(ordered["risk"].mean()),
        risk_std=float(ordered["risk"].std()),
        risk_min=float(ordered["risk"].min()),
        risk_max=float(ordered["risk"].max()),
        risk_range=float(ordered["risk"].max() - ordered["risk"].min()),
        risk_slope_per_day=risk_slope(ordered),
        miss_distance_min=float(ordered["miss_distance"].min()),
        max_risk_estimate_max=float(ordered["max_risk_estimate"].max()),
        latest_c_object_type=float(category_map.get(str(latest["c_object_type"]), category_map.get("UNKNOWN", 0))),
    )

    for column in ("latest_t_position_covariance_det", "latest_c_position_covariance_det"):
        raw = abs(float(values[column]))
        values[column] = math.log10(max(raw, 1e-30))
    for column in [name for name in values if "sigma_" in name]:
        raw = float(values[column])
        values[column] = math.copysign(math.log10(1 + abs(raw)), raw)
    values["latest_risk"] = min(0.0, max(-30.0, float(values["latest_risk"])))

    frame = pd.DataFrame([{name: values.get(name, np.nan) for name in feature_names}])
    return frame.replace([np.inf, -np.inf], np.nan).fillna(medians).astype(float)


def export_model(artifact_path: Path, archive_path: Path, model_output: Path, stream_output: Path) -> None:
    artifact = joblib.load(artifact_path)
    benchmark = artifact["benchmark"]
    model = artifact["models"][benchmark["championModelId"]]
    feature_names = list(artifact["feature_names"])
    medians = {name: float(artifact["medians"].get(name, 0.0)) for name in feature_names}
    category_map = {str(key): int(value) for key, value in artifact["category_map"].items()}

    trees = []
    for iteration in model._predictors:
        predictor = iteration[0]
        nodes = []
        for node in predictor.nodes:
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

    threshold = next(
        item["validation"]["threshold"]
        for item in benchmark["models"]
        if item["id"] == benchmark["championModelId"]
    )
    digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest().upper()
    model_payload = {
        "schemaVersion": 1,
        "id": "orbitshield-hgb-t2-v1",
        "name": benchmark["championModelName"],
        "generatedAt": benchmark["generatedAt"],
        "source": benchmark["source"],
        "artifactSha256": digest,
        "cutoffDays": benchmark["cutoffDays"],
        "riskThresholdLog10": benchmark["riskThresholdLog10"],
        "scoreThreshold": threshold,
        "baseline": float(model._baseline_prediction[0, 0]),
        "featureNames": feature_names,
        "medians": [medians[name] for name in feature_names],
        "categoryMap": category_map,
        "trees": trees,
        "validation": next(
            item["validation"] for item in benchmark["models"] if item["id"] == benchmark["championModelId"]
        ),
        "test": next(item["test"] for item in benchmark["models"] if item["id"] == benchmark["championModelId"]),
    }

    read_columns = sorted(set(["event_id", "c_object_type"] + LATEST_COLUMNS))
    raw = pd.read_csv(archive_path, usecols=read_columns, low_memory=False)
    event = raw[raw["event_id"] == RESERVED_EVENT_ID].copy()
    if event.empty:
        raise RuntimeError(f"Reserved event {RESERVED_EVENT_ID} is absent from {archive_path}")
    event = event.sort_values("time_to_tca", ascending=False)
    visible = event[event["time_to_tca"] >= benchmark["cutoffDays"]].copy()
    outcome = event.loc[event["time_to_tca"].idxmin()]
    message_columns = ["c_object_type"] + LATEST_COLUMNS
    messages = [{column: finite(row[column]) for column in message_columns} for _, row in visible.iterrows()]

    expected_scores = []
    for count in range(1, len(visible) + 1):
        matrix = feature_row(visible.iloc[:count], feature_names, medians, category_map)
        expected_scores.append(float(model.predict_proba(matrix)[0, 1]))

    stream_payload = {
        "schemaVersion": 1,
        "source": "ESA Collision Avoidance Challenge training archive",
        "sourceUrl": "https://zenodo.org/records/4463683",
        "preparedAt": datetime.now(timezone.utc).isoformat(),
        "eventId": RESERVED_EVENT_ID,
        "reservedFromTraining": True,
        "cutoffDays": benchmark["cutoffDays"],
        "messageIntervalMs": 650,
        "messages": messages,
        "expectedScores": expected_scores,
        "recordedOutcome": {column: finite(outcome[column]) for column in message_columns},
    }

    model_output.parent.mkdir(parents=True, exist_ok=True)
    model_output.write_text(json.dumps(model_payload, separators=(",", ":")), encoding="utf-8")
    stream_output.write_text(json.dumps(stream_payload, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "model": str(model_output),
        "stream": str(stream_output),
        "trees": len(trees),
        "messages": len(messages),
        "finalScore": expected_scores[-1],
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--model-output", type=Path, default=DEFAULT_MODEL_OUTPUT)
    parser.add_argument("--stream-output", type=Path, default=DEFAULT_STREAM_OUTPUT)
    args = parser.parse_args()
    export_model(args.artifact, args.archive, args.model_output, args.stream_output)


if __name__ == "__main__":
    main()
