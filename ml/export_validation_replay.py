from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from train_model import DEFAULT_ARCHIVE, RESERVED_EVENT_ID, load_event_table


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT / "ml" / "artifacts" / "orbitshield_t2_model.joblib"
DEFAULT_METRICS = ROOT / "ml" / "artifacts" / "metrics.json"
DEFAULT_OUTPUT = ROOT / "app" / "data" / "esa-validation-replay.json"
SOURCE = "https://zenodo.org/records/4463683"


def finite(value: float | np.floating) -> float:
    result = float(value)
    if not np.isfinite(result):
        raise ValueError(f"Expected a finite model value, received {result}")
    return result


def probability(log_risk: float) -> float:
    return 10.0 ** log_risk


def feature_group(name: str) -> str:
    if "risk" in name:
        return "risk-state"
    if any(token in name for token in ("miss_distance", "relative_position", "relative_velocity", "relative_speed", "mahalanobis")):
        return "geometry"
    if any(token in name for token in ("sigma_", "covariance", "obs_", "residual", "weighted_rms", "od_span")):
        return "uncertainty"
    return "context-orbit"


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the held-out OrbitShield T-2 replay.")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--metrics", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--event-id", type=int, default=RESERVED_EVENT_ID)
    args = parser.parse_args()

    if args.event_id != RESERVED_EVENT_ID:
        raise ValueError(f"The judge replay is fixed to reserved event {RESERVED_EVENT_ID}.")
    if not args.model.exists():
        raise FileNotFoundError(f"Model artifact not found: {args.model}")

    events, _, _ = load_event_table(args.archive)
    if args.event_id not in events.index:
        raise KeyError(f"Event {args.event_id} is not available at the T-2 cutoff.")

    artifact = joblib.load(args.model)
    metrics = json.loads(args.metrics.read_text(encoding="utf-8"))
    if not metrics["dataset"]["reserved_event_excluded"]:
        raise ValueError("Reserved event exclusion was not verified by the training run.")

    row = events.loc[[args.event_id]]
    feature_names = artifact["feature_names"]
    medians = pd.Series(artifact["medians"], dtype=float)
    matrix = row[feature_names].replace([np.inf, -np.inf], np.nan).fillna(medians).astype(float)

    classifier = artifact["classifier"]
    residual_model = artifact["residual_model"]
    raw_score = finite(classifier.predict_proba(matrix)[0, 1])
    residual_raw = finite(residual_model.predict(matrix)[0])
    threshold = finite(artifact["probability_threshold"])
    residual_alpha = finite(artifact["residual_alpha"])
    baseline_risk = finite(row.iloc[0]["latest_risk"])
    final_risk = finite(row.iloc[0]["final_risk"])

    contributions = classifier.booster_.predict(matrix, pred_contrib=True)[0]
    grouped = {name: 0.0 for name in ("risk-state", "geometry", "uncertainty", "context-orbit")}
    for name, value in zip(feature_names, contributions[:-1], strict=True):
        grouped[feature_group(name)] += finite(value)

    evidence = {
        "risk-state": [
            {"label": "Latest visible log10 risk", "value": baseline_risk},
            {"label": "Maximum visible log10 risk", "value": finite(row.iloc[0]["risk_max"])},
            {"label": "Latest maximum-risk estimate", "value": finite(row.iloc[0]["latest_max_risk_estimate"])},
        ],
        "geometry": [
            {"label": "Latest miss distance", "value": finite(row.iloc[0]["latest_miss_distance"]), "unit": "m"},
            {"label": "Minimum visible miss distance", "value": finite(row.iloc[0]["miss_distance_min"]), "unit": "m"},
        ],
        "uncertainty": [
            {"label": "Target observations used", "value": finite(row.iloc[0]["latest_t_obs_used"])},
            {"label": "Counterpart observations used", "value": finite(row.iloc[0]["latest_c_obs_used"])},
        ],
        "context-orbit": [
            {"label": "Visible CDMs", "value": finite(row.iloc[0]["visible_cdm_count"])},
            {"label": "Latest time to TCA", "value": finite(row.iloc[0]["latest_time_to_tca"]), "unit": "days"},
        ],
    }
    labels = {
        "risk-state": "Risk state",
        "geometry": "Close geometry",
        "uncertainty": "Uncertainty evidence",
        "context-orbit": "Orbit context",
    }
    drivers = [
        {
            "id": group,
            "label": labels[group],
            "direction": "raises-review" if contribution >= 0 else "lowers-review",
            "contributionLogOdds": contribution,
            "evidence": evidence[group],
        }
        for group, contribution in sorted(grouped.items(), key=lambda item: abs(item[1]), reverse=True)
    ]

    baseline_probability = probability(baseline_risk)
    final_probability = probability(final_risk)
    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": SOURCE,
        "eventId": args.event_id,
        "cutoffDays": finite(artifact["cutoff_days"]),
        "reservedFromTraining": True,
        "selectionDisclosure": "A held-out demonstration case selected for clear risk evolution.",
        "model": {
            "id": "orbitshield-lightgbm-t2-v1",
            "role": "secondary-triage",
            "artifactSha256": hashlib.sha256(args.model.read_bytes()).hexdigest().upper(),
            "scoreType": "uncalibrated-model-score",
            "scoreThreshold": threshold,
            "reviewRiskThresholdLog10": finite(artifact["risk_threshold"]),
        },
        "baseline": {
            "method": "latest-risk-persistence",
            "latestVisibleRisk": baseline_risk,
            "latestVisibleProbability": baseline_probability,
            "predictedFinalRisk": baseline_risk,
            "decision": "review" if baseline_risk >= artifact["risk_threshold"] else "routine",
        },
        "inference": {
            "rawScore": raw_score,
            "triage": "elevated" if raw_score >= threshold else "routine",
            "residualCorrectionRaw": residual_raw,
            "residualAlpha": residual_alpha,
            "acceptedFinalRiskForecast": baseline_risk + residual_alpha * residual_raw,
        },
        "calibration": {
            "status": "not-calibrated",
            "interval": None,
            "displayWarning": "Raw triage score, not collision probability.",
        },
        "drivers": drivers,
        "evaluation": {
            "testEvents": metrics["dataset"]["events_test"],
            "testPositiveEvents": metrics["dataset"]["test_high_risk_events"],
            "baselineF2": metrics["test"]["latest_risk_baseline"]["f2_from_risk"],
            "baselineRecall": metrics["test"]["latest_risk_baseline"]["recall_high_risk"],
            "modelF2": metrics["test"]["high_risk_classifier"]["f2"],
            "modelRecall": metrics["test"]["high_risk_classifier"]["recall"],
            "modelPrecision": metrics["test"]["high_risk_classifier"]["precision"],
            "modelPrAuc": metrics["test"]["high_risk_classifier"]["pr_auc"],
        },
        "recordedOutcome": {
            "hiddenByDefault": True,
            "finalRisk": final_risk,
            "finalProbability": final_probability,
            "finalClass": "review" if final_risk >= artifact["risk_threshold"] else "routine",
            "baselineAbsoluteErrorLog10": abs(final_risk - baseline_risk),
            "probabilityRatioToBaseline": final_probability / baseline_probability,
        },
        "limitations": [
            "The model score is not calibrated as a collision probability.",
            "The model supports triage and does not replace the persistence baseline or an analyst.",
            "The demonstration event is held out from training but selected for clear risk evolution.",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
