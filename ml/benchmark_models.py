from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, fbeta_score, precision_score, recall_score
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

from train_model import (
    DEFAULT_ARCHIVE,
    RESERVED_EVENT_ID,
    RISK_THRESHOLD,
    SEED,
    T2_CUTOFF_DAYS,
    load_event_table,
    split_events,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ml" / "artifacts" / "model_benchmark"
DEFAULT_FIXTURE = ROOT / "app" / "data" / "model-benchmark.json"

MODEL_DETAILS = {
    "logistic-regression": {
        "name": "Logistic Regression",
        "family": "Interpretable linear baseline",
        "reason": "Tests whether the engineered CDM state separates high-risk events without nonlinear complexity.",
    },
    "random-forest": {
        "name": "Random Forest",
        "family": "Bagged decision-tree ensemble",
        "reason": "Captures nonlinear feature interactions and remains stable under mixed scales and outliers.",
    },
    "hist-gradient-boosting": {
        "name": "Histogram Gradient Boosting",
        "family": "Boosted decision-tree ensemble",
        "reason": "Provides a strong native tree-boosting comparison without sharing LightGBM's implementation.",
    },
    "lightgbm": {
        "name": "LightGBM",
        "family": "Leaf-wise gradient boosting",
        "reason": "Matches the existing explainable triage pipeline and handles sparse, nonlinear CDM features efficiently.",
    },
    "mlp": {
        "name": "Multi-Layer Perceptron",
        "family": "Feed-forward neural network",
        "reason": "Tests a neural representation of the same leakage-safe T-2 feature set.",
    },
}

LITERATURE = [
    {
        "title": "Spacecraft Collision Avoidance Challenge: design and results",
        "url": "https://arxiv.org/abs/2008.03069",
        "finding": "Defines the real CDM sequence prediction problem and documents the challenge results.",
    },
    {
        "title": "ESA Collision Avoidance Challenge data",
        "url": "https://kelvins.esa.int/collision-avoidance-challenge/data/",
        "finding": "Provides 162,634 CDMs, 13,154 events, 103 fields and the operational T-2 cutoff.",
    },
    {
        "title": "Implementation and comparison of data-based methods",
        "url": "https://conference.sdo.esoc.esa.int/proceedings/sdc8/paper/33",
        "finding": "Compares Random Forest, Gradient Boosting, MLP and LSTM approaches for conjunction data.",
    },
    {
        "title": "Bayesian machine learning for satellite collision risk",
        "url": "https://arxiv.org/abs/2311.10633",
        "finding": "Reports the strength of naive persistence and studies sequential probabilistic modelling.",
    },
]


def optimize_threshold(y_true: np.ndarray, scores: np.ndarray) -> tuple[float, dict[str, float]]:
    candidates = np.unique(
        np.concatenate(
            [
                np.linspace(0.005, 0.995, 199),
                np.quantile(scores, np.linspace(0.01, 0.99, 199)),
            ]
        )
    )
    best_threshold = 0.5
    best_key = (-1.0, -1.0, -1.0)
    for threshold in candidates:
        predicted = scores >= threshold
        key = (
            float(fbeta_score(y_true, predicted, beta=2, zero_division=0)),
            float(recall_score(y_true, predicted, zero_division=0)),
            float(precision_score(y_true, predicted, zero_division=0)),
        )
        if key > best_key:
            best_key = key
            best_threshold = float(threshold)
    return best_threshold, score_metrics(y_true, scores, best_threshold)


def score_metrics(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, float]:
    predicted = scores >= threshold
    return {
        "threshold": float(threshold),
        "f2": float(fbeta_score(y_true, predicted, beta=2, zero_division=0)),
        "recall": float(recall_score(y_true, predicted, zero_division=0)),
        "precision": float(precision_score(y_true, predicted, zero_division=0)),
        "pr_auc": float(average_precision_score(y_true, scores)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark five OrbitShield T-2 CDM model families.")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
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
    y_train = train["high_risk"].to_numpy(dtype=int)
    y_validation = validation["high_risk"].to_numpy(dtype=int)
    y_test = test["high_risk"].to_numpy(dtype=int)
    balanced_weights = compute_sample_weight(class_weight="balanced", y=y_train)

    scaler = StandardScaler()
    x_train_scaled = scaler.fit_transform(x_train)
    x_validation_scaled = scaler.transform(x_validation)
    x_test_scaled = scaler.transform(x_test)

    models: list[tuple[str, object, bool, bool]] = [
        (
            "logistic-regression",
            LogisticRegression(C=0.5, class_weight="balanced", max_iter=2_000, random_state=SEED),
            True,
            False,
        ),
        (
            "random-forest",
            RandomForestClassifier(
                n_estimators=350,
                max_depth=14,
                min_samples_leaf=2,
                max_features="sqrt",
                class_weight="balanced_subsample",
                n_jobs=-1,
                random_state=SEED,
            ),
            False,
            False,
        ),
        (
            "hist-gradient-boosting",
            HistGradientBoostingClassifier(
                learning_rate=0.06,
                max_iter=260,
                max_leaf_nodes=31,
                min_samples_leaf=25,
                l2_regularization=1.0,
                early_stopping=True,
                random_state=SEED,
            ),
            False,
            True,
        ),
        (
            "lightgbm",
            lgb.LGBMClassifier(
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
            ),
            False,
            False,
        ),
        (
            "mlp",
            MLPClassifier(
                hidden_layer_sizes=(64, 32),
                activation="relu",
                alpha=0.001,
                batch_size=128,
                learning_rate_init=0.001,
                max_iter=260,
                early_stopping=True,
                validation_fraction=0.15,
                n_iter_no_change=18,
                random_state=SEED,
            ),
            True,
            True,
        ),
    ]

    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    fitted_models: dict[str, object] = {}
    for model_id, model, scaled, use_weights in models:
        model_started = time.perf_counter()
        train_matrix = x_train_scaled if scaled else x_train
        validation_matrix = x_validation_scaled if scaled else x_validation
        test_matrix = x_test_scaled if scaled else x_test
        fit_kwargs = {"sample_weight": balanced_weights} if use_weights else {}
        model.fit(train_matrix, y_train, **fit_kwargs)
        training_seconds = time.perf_counter() - model_started
        validation_scores = model.predict_proba(validation_matrix)[:, 1]
        threshold, validation_metrics = optimize_threshold(y_validation, validation_scores)
        test_scores = model.predict_proba(test_matrix)[:, 1]
        test_metrics = score_metrics(y_test, test_scores, threshold)
        fitted_models[model_id] = model
        result = {
            "id": model_id,
            **MODEL_DETAILS[model_id],
            "training_seconds": training_seconds,
            "validation": validation_metrics,
            "test": test_metrics,
        }
        results.append(result)
        print(
            f"{MODEL_DETAILS[model_id]['name']}: "
            f"validation F2={validation_metrics['f2']:.3f}, "
            f"test PR-AUC={test_metrics['pr_auc']:.3f}, "
            f"time={training_seconds:.1f}s",
            flush=True,
        )

    champion = max(
        results,
        key=lambda result: (
            result["validation"]["f2"],
            result["validation"]["pr_auc"],
            result["validation"]["recall"],
        ),
    )
    baseline_scores = test["latest_risk"].to_numpy(dtype=float)
    baseline_metrics = {
        "threshold": RISK_THRESHOLD,
        "f2": float(fbeta_score(y_test, baseline_scores >= RISK_THRESHOLD, beta=2, zero_division=0)),
        "recall": float(recall_score(y_test, baseline_scores >= RISK_THRESHOLD, zero_division=0)),
        "precision": float(precision_score(y_test, baseline_scores >= RISK_THRESHOLD, zero_division=0)),
        "pr_auc": float(average_precision_score(y_test, baseline_scores)),
    }

    benchmark = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESA Collision Avoidance Challenge training archive",
        "cutoffDays": T2_CUTOFF_DAYS,
        "riskThresholdLog10": RISK_THRESHOLD,
        "selectionPolicy": "Champion selected only by validation F2, then validation PR-AUC and recall.",
        "dataset": {
            **dataset_stats,
            "eventsTrain": int(len(train)),
            "eventsValidation": int(len(validation)),
            "eventsTest": int(len(test)),
            "testPositiveEvents": int(y_test.sum()),
            "featureCount": len(feature_names),
            "reservedEventId": RESERVED_EVENT_ID,
            "reservedEventExcluded": bool(
                RESERVED_EVENT_ID not in train.index
                and RESERVED_EVENT_ID not in validation.index
                and RESERVED_EVENT_ID not in test.index
            ),
        },
        "persistenceBaseline": baseline_metrics,
        "models": results,
        "championModelId": champion["id"],
        "championModelName": champion["name"],
        "totalTrainingSeconds": time.perf_counter() - started,
        "literature": LITERATURE,
        "limitations": [
            "The benchmark predicts final high-risk class from ESA CDM histories available at T-2.",
            "Scores are not calibrated collision probabilities.",
            "Public SOCRATES events do not contain the complete model feature set.",
        ],
    }

    joblib.dump(
        {
            "models": fitted_models,
            "scaler": scaler,
            "feature_names": feature_names,
            "medians": medians.to_dict(),
            "category_map": category_map,
            "benchmark": benchmark,
        },
        args.output / "five_model_benchmark.joblib",
    )
    (args.output / "benchmark.json").write_text(json.dumps(benchmark, indent=2), encoding="utf-8")
    args.fixture.parent.mkdir(parents=True, exist_ok=True)
    args.fixture.write_text(json.dumps(benchmark, indent=2), encoding="utf-8")
    print(json.dumps({"champion": champion["name"], "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
