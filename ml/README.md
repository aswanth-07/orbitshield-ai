# OrbitShield T-2 risk model

This training pipeline uses the official ESA Collision Avoidance Challenge CDM archive. It predicts the final log10 collision risk using only messages available at least two days before time of closest approach.

The first model is deliberately conservative:

- latest-risk persistence is always measured as the baseline;
- a LightGBM regressor learns the correction to the latest known risk;
- a separate class-weighted LightGBM classifier estimates whether final risk crosses the `10^-6` review threshold;
- events are split before training, and ESA demonstration event `9051` is excluded entirely.

Run from the repository root:

```powershell
.\.venv-ml\Scripts\python.exe .\ml\train_model.py
```

Generated models and metrics are written to `ml/artifacts/` and are intentionally not committed.

Export the real held-out judge replay after training:

```powershell
.\.venv-ml\Scripts\python.exe .\ml\export_validation_replay.py
```

The exporter verifies that event `9051` stayed outside every model partition,
runs the saved model, and writes a small source-labelled result to
`app/data/esa-validation-replay.json`. The frontend labels the classifier output
as an uncalibrated triage score rather than a collision probability.

Run the five-family benchmark from the repository root:

```powershell
.\.venv-ml\Scripts\python.exe .\ml\benchmark_models.py
```

The benchmark trains Logistic Regression, Random Forest, Histogram Gradient
Boosting, LightGBM and a Multi-Layer Perceptron on the same event-held-out T-2
split. Validation F2 selects thresholds and the benchmark champion. The compact
research basis is recorded in `ml/literature-survey.md`.

Export the benchmark-selected champion and the complete held-out CDM stream for
the live application:

```powershell
.\.venv-ml\Scripts\python.exe .\scripts\export_live_model.py
```

The export records the trained model hash, preprocessing medians, tree nodes,
validation threshold and all T-2 fields for event `9051`. The application sends
each arriving message to `POST /api/model/score`. A parity test compares every
TypeScript score with the originating Python estimator.

Train the public-feed model used by the main workspace:

```powershell
.\.venv-ml\Scripts\python.exe .\ml\train_public_triage.py
```

This pipeline selects the first available message inside the final two-day
window, keeps events separate across train, validation and test partitions, and
uses only time to TCA, current log10 probability, miss distance and relative
speed. It exports the 37-tree estimator and unit crosswalk to
`app/data/public-triage-model.json`. The current threshold favors recall for
analyst triage, and the UI identifies the score as non-probabilistic.
