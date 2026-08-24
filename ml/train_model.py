from __future__ import annotations

import argparse
import json
import math
import tempfile
import time
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    fbeta_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = Path(tempfile.gettempdir()) / "orbitshield-esa-train-data.zip"
DEFAULT_OUTPUT = ROOT / "ml" / "artifacts"
RISK_THRESHOLD = -6.0
T2_CUTOFF_DAYS = 2.0
RESERVED_EVENT_ID = 9051
SEED = 42


LATEST_COLUMNS = [
    "time_to_tca",
    "mission_id",
    "risk",
    "max_risk_estimate",
    "max_risk_scaling",
    "miss_distance",
    "relative_speed",
    "relative_position_r",
    "relative_position_t",
    "relative_position_n",
    "relative_velocity_r",
    "relative_velocity_t",
    "relative_velocity_n",
    "t_obs_available",
    "t_obs_used",
    "t_residuals_accepted",
    "t_weighted_rms",
    "t_actual_od_span",
    "t_rcs_estimate",
    "t_j2k_sma",
    "t_j2k_ecc",
    "t_j2k_inc",
    "c_obs_available",
    "c_obs_used",
    "c_residuals_accepted",
    "c_weighted_rms",
    "c_actual_od_span",
    "c_rcs_estimate",
    "c_j2k_sma",
    "c_j2k_ecc",
    "c_j2k_inc",
    "geocentric_latitude",
    "azimuth",
    "elevation",
    "mahalanobis_distance",
    "t_position_covariance_det",
    "c_position_covariance_det",
    "t_sigma_r",
    "c_sigma_r",
    "t_sigma_t",
    "c_sigma_t",
    "t_sigma_n",
    "c_sigma_n",
    "t_sigma_rdot",
    "c_sigma_rdot",
    "t_sigma_tdot",
    "c_sigma_tdot",
    "t_sigma_ndot",
    "c_sigma_ndot",
    "F10",
    "F3M",
    "SSN",
    "AP",
]

DELTA_COLUMNS = [
    "risk",
    "max_risk_estimate",
    "miss_distance",
    "relative_position_r",
    "relative_position_t",
    "relative_position_n",
    "t_sigma_r",
    "c_sigma_r",
    "t_sigma_t",
    "c_sigma_t",
    "t_sigma_n",
    "c_sigma_n",
]

READ_COLUMNS = sorted(
    set(
        ["event_id", "time_to_tca", "risk", "c_object_type"]
        + LATEST_COLUMNS
        + DELTA_COLUMNS
    )
)


def finite_float(value: float | int | np.floating | None) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return float(value)


def risk_slope(group: pd.DataFrame) -> float:
    valid = group[["time_to_tca", "risk"]].dropna()
    if len(valid) < 2:
        return 0.0
    x = valid["time_to_tca"].to_numpy(dtype=float)
    y = valid["risk"].to_numpy(dtype=float)
    denominator = len(x) * np.square(x).sum() - np.square(x.sum())
    if abs(denominator) < 1e-12:
        return 0.0
    return float((len(x) * np.multiply(x, y).sum() - x.sum() * y.sum()) / denominator)


def load_event_table(
    archive: Path,
) -> tuple[pd.DataFrame, dict[str, int], dict[str, int]]:
    if not archive.exists():
        raise FileNotFoundError(
            f"ESA archive not found at {archive}. Run scripts/prepare_phase1_data.py first."
        )

    raw = pd.read_csv(archive, usecols=READ_COLUMNS, low_memory=False)
    raw = raw.replace([np.inf, -np.inf], np.nan)

    final_rows = raw.loc[raw.groupby("event_id")["time_to_tca"].idxmin(), ["event_id", "risk"]]
    final_rows = final_rows.rename(columns={"risk": "final_risk"}).set_index("event_id")

    visible = raw[raw["time_to_tca"] >= T2_CUTOFF_DAYS].copy()
    visible = visible.sort_values(["event_id", "time_to_tca"], ascending=[True, True])
    visible["sequence_index"] = visible.groupby("event_id", sort=False).cumcount()
    latest = visible[visible["sequence_index"] == 0].set_index("event_id")
    previous = visible[visible["sequence_index"] == 1].set_index("event_id").reindex(latest.index)

    features = latest[LATEST_COLUMNS].copy()
    features.columns = [f"latest_{column}" for column in features.columns]
    features.index.name = "event_id"

    for column in DELTA_COLUMNS:
        features[f"delta_{column}"] = latest[column] - previous[column]

    grouped = visible.groupby("event_id", sort=False)
    aggregates = pd.DataFrame(index=features.index)
    aggregates["visible_cdm_count"] = grouped.size()
    aggregates["visible_span_days"] = grouped["time_to_tca"].max() - grouped["time_to_tca"].min()
    aggregates["risk_mean"] = grouped["risk"].mean()
    aggregates["risk_std"] = grouped["risk"].std()
    aggregates["risk_min"] = grouped["risk"].min()
    aggregates["risk_max"] = grouped["risk"].max()
    aggregates["risk_range"] = aggregates["risk_max"] - aggregates["risk_min"]
    aggregates["risk_slope_per_day"] = grouped.apply(risk_slope, include_groups=False)
    aggregates["miss_distance_min"] = grouped["miss_distance"].min()
    aggregates["max_risk_estimate_max"] = grouped["max_risk_estimate"].max()

    features = features.join(aggregates).join(final_rows, how="inner")
    features["latest_c_object_type"] = latest["c_object_type"].fillna("UNKNOWN").astype(str)
    categories = sorted(features["latest_c_object_type"].unique().tolist())
    category_map = {value: index for index, value in enumerate(categories)}
    features["latest_c_object_type"] = features["latest_c_object_type"].map(category_map).astype(float)

    for column in ["latest_t_position_covariance_det", "latest_c_position_covariance_det"]:
        features[column] = np.log10(features[column].abs().clip(lower=1e-30))

    sigma_columns = [column for column in features if "sigma_" in column]
    for column in sigma_columns:
        features[column] = np.sign(features[column]) * np.log10(1.0 + features[column].abs())

    features["latest_risk"] = features["latest_risk"].clip(-30.0, 0.0)
    features["final_risk"] = features["final_risk"].clip(-30.0, 0.0)
    features["target_residual"] = features["final_risk"] - features["latest_risk"]
    features["high_risk"] = (features["final_risk"] >= RISK_THRESHOLD).astype(int)

    stats = {
        "raw_rows": int(len(raw)),
        "raw_events": int(raw["event_id"].nunique()),
        "events_with_t2": int(len(features)),
        "high_risk_events": int(features["high_risk"].sum()),
    }
    return features, category_map, stats


def split_events(events: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    development = events.drop(index=RESERVED_EVENT_ID, errors="ignore")

    def strata(frame: pd.DataFrame, minimum_count: int) -> pd.Series:
        mission = frame["latest_mission_id"].fillna(-1).astype(int).astype(str)
        labels = mission + ":" + frame["high_risk"].astype(str)
        counts = labels.map(labels.value_counts())
        collapsed = labels.where(counts >= minimum_count, "rare:" + frame["high_risk"].astype(str))
        if collapsed.value_counts().min() < 2:
            return frame["high_risk"].astype(str)
        return collapsed

    train, holdout = train_test_split(
        development,
        test_size=0.30,
        random_state=SEED,
        stratify=strata(development, minimum_count=4),
    )
    validation, test = train_test_split(
        holdout,
        test_size=0.50,
        random_state=SEED,
        stratify=strata(holdout, minimum_count=2),
    )
    return train, validation, test


def regression_metrics(y_true: np.ndarray, predictions: np.ndarray) -> dict[str, float | None]:
    actual_high = y_true >= RISK_THRESHOLD
    predicted_high = predictions >= RISK_THRESHOLD
    f2 = fbeta_score(actual_high, predicted_high, beta=2, zero_division=0)
    mse_high = mean_squared_error(y_true[actual_high], predictions[actual_high]) if actual_high.any() else math.nan
    return {
        "mae_all": float(mean_absolute_error(y_true, predictions)),
        "mse_high_risk": finite_float(mse_high),
        "f2_from_risk": float(f2),
        "recall_high_risk": float(recall_score(actual_high, predicted_high, zero_division=0)),
        "precision_high_risk": float(precision_score(actual_high, predicted_high, zero_division=0)),
        "esa_loss": finite_float(mse_high / max(f2, 1e-9)),
    }


def classifier_metrics(y_true: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, float]:
    predicted = probabilities >= threshold
    return {
        "threshold": float(threshold),
        "f2": float(fbeta_score(y_true, predicted, beta=2, zero_division=0)),
        "recall": float(recall_score(y_true, predicted, zero_division=0)),
        "precision": float(precision_score(y_true, predicted, zero_division=0)),
        "pr_auc": float(average_precision_score(y_true, probabilities)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train OrbitShield's T-2 CDM risk model.")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    started = time.perf_counter()
    events, category_map, dataset_stats = load_event_table(args.archive)
    train, validation, test = split_events(events)

    target_columns = {"final_risk", "target_residual", "high_risk"}
    feature_names = [column for column in events.columns if column not in target_columns]
    medians = train[feature_names].median(numeric_only=True).fillna(0.0)

    def matrix(frame: pd.DataFrame) -> pd.DataFrame:
        return frame[feature_names].replace([np.inf, -np.inf], np.nan).fillna(medians).astype(float)

    x_train = matrix(train)
    x_validation = matrix(validation)
    x_test = matrix(test)

    residual_model = lgb.LGBMRegressor(
        objective="huber",
        n_estimators=500,
        learning_rate=0.025,
        num_leaves=24,
        max_depth=7,
        min_child_samples=35,
        subsample=0.85,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=SEED,
        verbosity=-1,
    )
    residual_weights = np.where(train["high_risk"].to_numpy() == 1, 18.0, 1.0)
    residual_model.fit(x_train, train["target_residual"], sample_weight=residual_weights)

    classifier = lgb.LGBMClassifier(
        objective="binary",
        n_estimators=400,
        learning_rate=0.025,
        num_leaves=24,
        max_depth=7,
        min_child_samples=30,
        subsample=0.85,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        class_weight="balanced",
        random_state=SEED,
        verbosity=-1,
    )
    classifier.fit(x_train, train["high_risk"])

    validation_residual = residual_model.predict(x_validation)
    alpha_candidates = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0]
    alpha_scores: dict[float, float] = {}
    for alpha in alpha_candidates:
        predictions = np.clip(
            validation["latest_risk"].to_numpy() + alpha * validation_residual,
            -30.0,
            0.0,
        )
        score = regression_metrics(validation["final_risk"].to_numpy(), predictions)["esa_loss"]
        alpha_scores[alpha] = float(score if score is not None else math.inf)
    residual_alpha = min(alpha_scores, key=alpha_scores.get)

    validation_probability = classifier.predict_proba(x_validation)[:, 1]
    threshold_candidates = np.linspace(0.01, 0.95, 95)
    probability_threshold = max(
        threshold_candidates,
        key=lambda threshold: fbeta_score(
            validation["high_risk"],
            validation_probability >= threshold,
            beta=2,
            zero_division=0,
        ),
    )

    test_baseline = test["latest_risk"].to_numpy()
    test_residual = residual_model.predict(x_test)
    test_forecast = np.clip(test_baseline + residual_alpha * test_residual, -30.0, 0.0)
    test_probability = classifier.predict_proba(x_test)[:, 1]

    elapsed = time.perf_counter() - started
    metrics = {
        "dataset": {
            **dataset_stats,
            "archive": str(args.archive),
            "events_total": int(len(events)),
            "events_train": int(len(train)),
            "events_validation": int(len(validation)),
            "events_test": int(len(test)),
            "reserved_event_id": RESERVED_EVENT_ID,
            "reserved_event_excluded": bool(RESERVED_EVENT_ID not in train.index and RESERVED_EVENT_ID not in validation.index and RESERVED_EVENT_ID not in test.index),
            "test_high_risk_events": int(test["high_risk"].sum()),
        },
        "configuration": {
            "cutoff_days": T2_CUTOFF_DAYS,
            "risk_threshold_log10": RISK_THRESHOLD,
            "feature_count": len(feature_names),
            "residual_alpha": residual_alpha,
            "classifier_probability_threshold": float(probability_threshold),
            "seed": SEED,
        },
        "validation": {
            "alpha_scores": {str(key): value for key, value in alpha_scores.items()},
            "classifier": classifier_metrics(
                validation["high_risk"].to_numpy(),
                validation_probability,
                float(probability_threshold),
            ),
        },
        "test": {
            "latest_risk_baseline": regression_metrics(test["final_risk"].to_numpy(), test_baseline),
            "residual_forecast": regression_metrics(test["final_risk"].to_numpy(), test_forecast),
            "high_risk_classifier": classifier_metrics(
                test["high_risk"].to_numpy(),
                test_probability,
                float(probability_threshold),
            ),
        },
        "training_seconds": elapsed,
    }

    args.output.mkdir(parents=True, exist_ok=True)
    residual_model.booster_.save_model(args.output / "residual_model.txt")
    classifier.booster_.save_model(args.output / "high_risk_classifier.txt")
    joblib.dump(
        {
            "residual_model": residual_model,
            "classifier": classifier,
            "feature_names": feature_names,
            "medians": medians.to_dict(),
            "category_map": category_map,
            "residual_alpha": residual_alpha,
            "probability_threshold": float(probability_threshold),
            "cutoff_days": T2_CUTOFF_DAYS,
            "risk_threshold": RISK_THRESHOLD,
        },
        args.output / "orbitshield_t2_model.joblib",
    )

    predictions = pd.DataFrame(
        {
            "event_id": test.index,
            "final_risk": test["final_risk"],
            "latest_risk_baseline": test_baseline,
            "predicted_final_risk": test_forecast,
            "high_risk_probability": test_probability,
            "actual_high_risk": test["high_risk"],
        }
    )
    predictions.to_csv(args.output / "test_predictions.csv", index=False)

    importance = pd.DataFrame(
        {
            "feature": feature_names,
            "residual_gain": residual_model.booster_.feature_importance(importance_type="gain"),
            "classifier_gain": classifier.booster_.feature_importance(importance_type="gain"),
        }
    ).sort_values(["classifier_gain", "residual_gain"], ascending=False)
    importance.to_csv(args.output / "feature_importance.csv", index=False)

    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (args.output / "preprocessing.json").write_text(
        json.dumps(
            {
                "feature_names": feature_names,
                "medians": {key: finite_float(value) or 0.0 for key, value in medians.items()},
                "category_map": category_map,
                "residual_alpha": residual_alpha,
                "probability_threshold": float(probability_threshold),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
